import { BadRequestException, ConflictException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { refusalBody } from 'src/localization/coded-sentence'
import { eventPart, eventText } from 'src/domains/delivery-event/event-text'
import { EventPart } from 'src/shared-types/event-messages'
import {
  BoxSize,
  EnumCancelledBy,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumPartnerChargeReason,
  EnumQuoteSource,
  EnumSplitRequestStatus,
  Prisma,
  SplitRequest,
} from '@prisma/types'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { BOX_SIZE_WORDS, RIDER_BOX_UNITS, boxUnitsFor } from 'src/domains/delivery/box'
import { MAX_LEG_COUNT } from 'src/domains/delivery/legs'
import {
  SPLIT_SENTENCES,
  SplitLeg,
  cleanLegs,
  legNumbersAfterSplit,
  orderReferenceForSplit,
  splitLeaveFrom,
  splitLegsProblem,
} from 'src/domains/split/split'
import { DeliveryNotFoundException, NotFoundException } from 'src/errors'
import { heldBoxUnitsSql } from 'src/persistence/repositories/courier.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { SplitRequestForQueue, SplitRequestRepository } from 'src/persistence/repositories/split-request.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { isUniqueConstraintError } from 'src/prisma.util'
import { PrismaService } from 'src/services/prisma/prisma.service'
import type {
  DeliveryBoxSizeChangedEvent,
  DeliveryCanceledEvent,
  DeliveryPartnerChargedForSplitEvent,
  DeliverySplitClosedEvent,
  DeliverySplitConfirmedEvent,
  DeliverySplitRefusedEvent,
  DeliverySplitRequestedEvent,
} from 'src/shared-types/delivery-events'

type Admin = { id: string; email?: string | null }

// A leg the confirm created, for the steps that run after the transaction commits.
type CreatedLeg = { id: string; legNumber: number; boxSize: BoxSize; chargeCents: number; currencyCode: string; charged: boolean }

// Spec 0047 (row 11): split at pickup, the one human exception queue. A rider at the restaurant flags an
// order that does not fit one box and proposes the legs; an admin confirms (perhaps changed) or refuses.
// On a confirm the rider keeps leg 1, the backend creates the other legs (the declared exception to Path A,
// logged in memory.md's ledger), charges the restaurant each new leg's rider pay, and pays the rider's wait.
// Every answer claims the request with a write conditional on OPEN, so there is one winner (AC-9).
@Injectable()
export class SplitRequestService {
  private readonly logger = new Logger(SplitRequestService.name)

  constructor(
    private readonly splitRequestRepository: SplitRequestRepository,
    private readonly deliveryRepository: DeliveryRepository,
    private readonly deliveryEventService: DeliveryEventService,
    private readonly configDomainService: ConfigDomainService,
    private readonly prisma: PrismaService
  ) {}

  // --- The rider's side ---------------------------------------------------------------------

  // AC-1. Not theirs is 404; not at the restaurant, or a request already open, is 409.
  async request(courierId: string, deliveryId: string, legs: unknown): Promise<SplitRequest> {
    const delivery = await this.deliveryRepository.findById(deliveryId)
    if (!delivery || delivery.courierId !== courierId) throw new DeliveryNotFoundException('Delivery not found')
    if (delivery.status !== EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION) {
      throw new ConflictException(SPLIT_SENTENCES.notAtPickup)
    }
    const problem = splitLegsProblem(legs)
    if (problem) throw new BadRequestException(problem)
    const proposed = cleanLegs(legs as SplitLeg[])
    // Row 11 review: a flag that no answer could confirm is refused now, not left for dispatch to find.
    // The order's other legs are not read here: the smallest split (2) already passes the limit only when
    // this delivery is a leg of a full order; confirm checks the exact numbers again.
    if (delivery.legCount !== null && delivery.legCount + proposed.length - 1 > MAX_LEG_COUNT) {
      throw new ConflictException(SPLIT_SENTENCES.tooManyLegs)
    }

    const created = await this.splitRequestRepository.createOpen({ deliveryId, courierId, proposedLegs: proposed })
    if (!created) throw new ConflictException(SPLIT_SENTENCES.alreadyOpen)

    const event: DeliverySplitRequestedEvent = {
      deliveryId,
      type: EnumDeliveryEventType.SPLIT_REQUESTED,
      actor: EnumEventActor.COURIER,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId,
      ...eventText('SPLIT_REQUESTED', { count: proposed.length, sizes: boxParts(proposed), splitId: created.id }),
    }
    await this.deliveryEventService.recordSplitEvent(event, delivery.status)
    return created
  }

  // AC-8. Leaving after the limit: the request closes as LEFT, the split wait is paid (and charged: the
  // restaurant picked a size that did not fit), and the delivery is cancelled as the restaurant's, through
  // spec 0015's path, so the rider's cancellation award and the restaurant's charge apply as there.
  async leave(courierId: string, deliveryId: string, now = new Date()): Promise<void> {
    const delivery = await this.deliveryRepository.findById(deliveryId)
    if (!delivery || delivery.courierId !== courierId) throw new DeliveryNotFoundException('Delivery not found')
    const open = await this.splitRequestRepository.findOpenForDelivery(deliveryId)
    if (!open || open.courierId !== courierId) throw new ConflictException(SPLIT_SENTENCES.noOpenRequest)
    // Row 11 review: only from the restaurant. Once the order moved on (a pickup posted by an admin), the
    // request is voided by that step, and leaving would cancel an order already on its way.
    if (delivery.status !== EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION) {
      throw new ConflictException(SPLIT_SENTENCES.notAtPickup)
    }
    const minutes = await this.configDomainService.instanceConfig.getSplitAnswerMinutes()
    if (now < splitLeaveFrom(open.createdAt, minutes)) {
      const tooSoon = { code: 'SPLIT_LEAVE_TOO_SOON', params: { minutes }, message: SPLIT_SENTENCES.tooSoon(minutes) }
      throw new ConflictException(refusalBody(HttpStatus.CONFLICT, tooSoon))
    }

    const closed = await this.splitRequestRepository.closeIfOpen(open.id, {
      status: EnumSplitRequestStatus.LEFT,
      answeredAt: now,
      waitOwedAt: await this.deliveryEventService.splitWaitOwedAt(open.createdAt, now),
    })
    if (!closed) throw new ConflictException(SPLIT_SENTENCES.notOpen)

    const closedEvent: DeliverySplitClosedEvent = {
      deliveryId,
      type: EnumDeliveryEventType.SPLIT_CLOSED,
      actor: EnumEventActor.COURIER,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId,
      ...eventText('SPLIT_LEFT', { minutes, splitId: open.id }),
    }
    // Row 11 review: each step after the close runs on its own, so a failed record never keeps the rider
    // from leaving; the wait has its stamp and the sweep.
    await this.afterClose(`record the leave of split ${open.id}`, () =>
      this.deliveryEventService.recordSplitEvent(closedEvent, delivery.status)
    )
    await this.deliveryEventService.settleSplitWait(open.id)

    const cancel: DeliveryCanceledEvent = {
      deliveryId,
      type: EnumDeliveryEventType.CANCELED,
      actor: EnumEventActor.SYSTEM,
      source: EnumDeliveryEventSource.OPENCOURIER,
      cancelledBy: EnumCancelledBy.RESTAURANT,
      ...eventText('SPLIT_LEFT_CANCELLED', {}),
    }
    await this.deliveryEventService.processDeliveryEvent(cancel)
  }

  // Cross check 6: while a split request is open, the rider's Picked up and spec 0033's leave wait are 409.
  async refuseIfSplitOpen(deliveryId: string, sentence: string): Promise<void> {
    if (await this.splitRequestRepository.findOpenForDelivery(deliveryId)) throw new ConflictException(sentence)
  }

  // --- The admin's side ---------------------------------------------------------------------

  async listOpen(): Promise<SplitRequestForQueue[]> {
    return this.splitRequestRepository.findOpenForQueue()
  }

  async countOpen(): Promise<number> {
    return this.splitRequestRepository.countOpen()
  }

  // The co-op's answer limit, for the admin queue's leave time (row 11 review).
  async answerMinutes(): Promise<number> {
    return this.configDomainService.instanceConfig.getSplitAnswerMinutes()
  }

  // AC-7. The request closes; the rider carries the order as is. The wait is paid by the co-op, and the
  // restaurant is not charged for it (cross check 1).
  async refuse(admin: Admin, requestId: string, note: string | null, now = new Date()): Promise<void> {
    const request = await this.splitRequestRepository.findById(requestId)
    if (!request) throw new NotFoundException('Split request not found')
    const adminNote = note?.trim() ? note.trim().slice(0, 300) : null
    const closed = await this.splitRequestRepository.closeIfOpen(request.id, {
      status: EnumSplitRequestStatus.REFUSED,
      answeredAt: now,
      answeredByUserId: admin.id,
      adminNote,
      waitOwedAt: await this.deliveryEventService.splitWaitOwedAt(request.createdAt, now),
    })
    if (!closed) throw new ConflictException(SPLIT_SENTENCES.notOpen)

    const delivery = await this.deliveryRepository.findByIdOrThrow(request.deliveryId)
    const event: DeliverySplitRefusedEvent = {
      deliveryId: request.deliveryId,
      type: EnumDeliveryEventType.SPLIT_REFUSED,
      actor: EnumEventActor.ADMIN,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId: request.courierId,
      // The admin by id; their sentence goes to the rider only, never into the record's message.
      ...eventText('SPLIT_REFUSED', { adminId: admin.id, splitId: request.id }),
    }
    await this.afterClose(`record the refusal of split ${request.id}`, () =>
      this.deliveryEventService.recordSplitEvent(event, delivery.status)
    )
    await this.deliveryEventService.settleSplitWait(request.id)
    await this.afterClose(`tell the rider about split ${request.id}`, () =>
      this.deliveryEventService.notifySplitDecided(request.courierId, {
        deliveryId: request.deliveryId,
        outcome: 'REFUSED',
        adminNote,
        legNumber: null,
        legCount: null,
        boxSize: null,
      })
    )
  }

  // AC-5, AC-6, cross checks 4, 5, 7, 8, 9, 10. The claim, the kept leg's labels and size, every new leg with
  // its copied quote, and each new leg's restaurant charge are one transaction: either all of it happens or
  // none of it. The events, the split wait and matching run after the commit; the sweep finishes a leg left
  // in CREATED if this process stops between.
  async confirm(admin: Admin, requestId: string, legsInput: unknown | undefined, now = new Date()): Promise<void> {
    const request = await this.splitRequestRepository.findById(requestId)
    if (!request) throw new NotFoundException('Split request not found')
    if (request.status !== EnumSplitRequestStatus.OPEN) throw new ConflictException(SPLIT_SENTENCES.notOpen)

    const legsSource = legsInput === undefined ? request.proposedLegs : legsInput
    const problem = splitLegsProblem(legsSource)
    if (problem) throw new BadRequestException(problem)
    const legs = cleanLegs(legsSource as SplitLeg[])

    const delivery = await this.deliveryRepository.findByIdOrThrow(request.deliveryId)
    const quote = await this.prisma.deliveryQuote.findUniqueOrThrow({ where: { id: delivery.deliveryQuoteId } })
    const reference = orderReferenceForSplit(delivery.orderReference, delivery.deliveryQuoteId, delivery.legCount !== null)
    const siblings =
      delivery.legCount !== null && delivery.partnerId
        ? await this.prisma.delivery.findMany({
            where: { partnerId: delivery.partnerId, orderReference: delivery.orderReference, legCount: { not: null } },
            select: { id: true, legNumber: true },
          })
        : []
    const numbers = legNumbersAfterSplit(
      { legNumber: delivery.legNumber, legCount: delivery.legCount },
      siblings.map((sibling) => sibling.legNumber ?? 0),
      legs.length
    )
    if (!numbers) throw new ConflictException(SPLIT_SENTENCES.tooManyLegs)

    const config = this.configDomainService.instanceConfig
    const units = {
      boxUnitsSmall: await config.getBoxUnitsSmall(),
      boxUnitsMedium: await config.getBoxUnitsMedium(),
      boxUnitsLarge: await config.getBoxUnitsLarge(),
    }
    const quoteExpiresAt = new Date(now.getTime() + (await config.getQuoteExpirationMinutes()) * 60_000)
    // Cross check 4: the rider pay of each new leg is the original quote's, the same distance.
    const legPay = quote.baseFee + quote.distanceFee
    // splitLegsProblem guarantees 2 to 4 legs; the first is the one the rider keeps.
    const keptSize = legs[0]?.boxSize ?? delivery.boxSize
    const waitOwedAt = await this.deliveryEventService.splitWaitOwedAt(request.createdAt, now)

    // Row 11 review: two splits of one order's legs at once can both pick the same next leg number; the
    // order's unique (restaurant, reference, leg number) key lets one in, and the other is told to look again.
    const created: CreatedLeg[] = await this.prisma
      .$transaction(async (tx) => {
      const claimed = await this.splitRequestRepository.closeIfOpen(
        request.id,
        {
          status: EnumSplitRequestStatus.CONFIRMED,
          answeredAt: now,
          answeredByUserId: admin.id,
          finalLegs: legs as unknown as Prisma.InputJsonValue,
          waitOwedAt,
        },
        tx
      )
      if (!claimed) throw new ConflictException(SPLIT_SENTENCES.notOpen)

      // The siblings of a leg that is split again take the new total first (cross check 8).
      if (siblings.length > 0) {
        await tx.delivery.updateMany({
          where: { id: { in: siblings.map((sibling) => sibling.id) } },
          data: { legCount: numbers.legCount },
        })
      }
      // The kept leg, still at the restaurant with the same rider, or nothing happens (cross check 9).
      const kept = await tx.delivery.updateMany({
        where: {
          id: delivery.id,
          status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          courierId: request.courierId,
        },
        data: {
          boxSize: keptSize,
          boxUnits: boxUnitsFor(keptSize, units),
          boxSizeAssumed: false,
          legNumber: numbers.keptNumber,
          legCount: numbers.legCount,
          orderReference: reference,
        },
      })
      if (kept.count !== 1) throw new ConflictException(SPLIT_SENTENCES.deliveryChanged)
      // Cross check 9: the kept size is the stated exception to spec 0043's "no size change once offered",
      // so the rider's box is checked again with it, inside the same transaction. The rider's other orders
      // count as spec 0043 counts them (heldBoxUnitsSql, which already includes this one at its new size).
      if (keptSize !== delivery.boxSize) {
        const rows = await tx.$queryRaw<Array<{ held: number }>>(
          Prisma.sql`SELECT (${heldBoxUnitsSql(Prisma.sql`${request.courierId}`)}) AS "held"`
        )
        const held = rows[0]?.held ?? 0
        if (held > RIDER_BOX_UNITS) throw new ConflictException(SPLIT_SENTENCES.keptSizeOverfills(BOX_SIZE_WORDS[keptSize], held))
      }

      const legsMade: CreatedLeg[] = []
      for (let index = 1; index < legs.length; index++) {
        const legNumber = numbers.newNumbers[index - 1]
        const boxSize = legs[index]?.boxSize
        if (legNumber === undefined || boxSize === undefined) continue
        // Cross check 4: the same distance and rider pay; the customer pays nothing more (price 0, fee 0).
        const legQuote = await tx.deliveryQuote.create({
          data: {
            source: EnumQuoteSource.SPLIT,
            quote: 0,
            quoteRangeFrom: 0,
            quoteRangeTo: 0,
            feePercentage: 0,
            baseFee: quote.baseFee,
            distanceFee: quote.distanceFee,
            currency: quote.currency,
            duration: quote.duration,
            distance: quote.distance,
            distanceUnit: quote.distanceUnit,
            pickupPhoneNumber: quote.pickupPhoneNumber,
            pickupName: quote.pickupName,
            dropoffPhoneNumber: quote.dropoffPhoneNumber,
            dropoffName: quote.dropoffName,
            expiresAt: quoteExpiresAt,
            pickupLocationId: quote.pickupLocationId,
            dropoffLocationId: quote.dropoffLocationId,
            partnerId: quote.partnerId,
          },
        })
        // Cross check 10: pickup, drop off, customer, notes and items copied; the food is there now, so ready
        // and promised are the confirm time; no tips, no idempotency key, no order total (it is leg 1's).
        const leg = await tx.delivery.create({
          data: {
            pickupName: delivery.pickupName,
            pickupPhoneNumber: delivery.pickupPhoneNumber,
            pickupBusinessName: delivery.pickupBusinessName,
            pickupNotes: delivery.pickupNotes,
            pickupLocationId: delivery.pickupLocationId,
            pickupReadyAt: now,
            dropoffName: delivery.dropoffName,
            dropoffPhoneNumber: delivery.dropoffPhoneNumber,
            dropoffBusinessName: delivery.dropoffBusinessName,
            dropoffNotes: delivery.dropoffNotes,
            dropoffSellerNotes: delivery.dropoffSellerNotes,
            dropoffEta: delivery.dropoffEta,
            dropoffFloor: delivery.dropoffFloor,
            dropoffDoorbell: delivery.dropoffDoorbell,
            dropoffLocationId: delivery.dropoffLocationId,
            deliverableAction: delivery.deliverableAction,
            undeliverableAction: delivery.undeliverableAction,
            requiresDropoffSignature: delivery.requiresDropoffSignature,
            requiresId: delivery.requiresId,
            orderItems: (delivery.orderItems ?? undefined) as Prisma.InputJsonValue | undefined,
            // Row 11 review (cross check 10): the customer's notes, the order's type lists, the
            // verification steps and the deadlines come with the order too.
            customerNotes: delivery.customerNotes,
            deliveryTypes: delivery.deliveryTypes,
            pickupTypes: delivery.pickupTypes,
            pickupVerification: (delivery.pickupVerification ?? undefined) as Prisma.InputJsonValue | undefined,
            dropoffVerification: (delivery.dropoffVerification ?? undefined) as Prisma.InputJsonValue | undefined,
            pickupDeadlineAt: delivery.pickupDeadlineAt,
            dropoffDeadlineAt: delivery.dropoffDeadlineAt,
            dropoffReadyAt: delivery.dropoffReadyAt,
            orderReference: reference,
            legNumber,
            legCount: numbers.legCount,
            currencyCode: delivery.currencyCode,
            partnerId: delivery.partnerId,
            deliveryQuoteId: legQuote.id,
            tips: 0,
            readyAt: now,
            promisedReadyAt: now,
            foodReadyAt: now,
            boxSize,
            boxUnits: boxUnitsFor(boxSize, units),
            boxSizeAssumed: false,
          },
          select: { id: true },
        })
        // AC-6, cross check 13: the restaurant pays the new leg's rider pay; with no restaurant, nobody.
        if (delivery.partnerId) {
          await tx.partnerCharge.create({
            data: {
              partnerId: delivery.partnerId,
              deliveryId: leg.id,
              amount: legPay,
              currencyCode: delivery.currencyCode,
              reason: EnumPartnerChargeReason.SPLIT_LEG,
              splitLegOf: leg.id,
            },
          })
        }
        legsMade.push({
          id: leg.id,
          legNumber,
          boxSize,
          chargeCents: legPay,
          currencyCode: delivery.currencyCode,
          charged: Boolean(delivery.partnerId),
        })
      }
      return legsMade
    })
      .catch((error: unknown) => {
        if (error instanceof Error && isUniqueConstraintError(error)) {
          throw new ConflictException(SPLIT_SENTENCES.deliveryChanged)
        }
        throw error
      })

    // After the commit: the record, the rider's wait, the new legs into matching, the rider's answer.
    const confirmed: DeliverySplitConfirmedEvent = {
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.SPLIT_CONFIRMED,
      actor: EnumEventActor.ADMIN,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId: request.courierId,
      ...eventText('SPLIT_CONFIRMED', {
        adminId: admin.id,
        splitId: request.id,
        count: legs.length,
        sizes: boxParts(legs),
        legNumber: numbers.keptNumber,
        legCount: numbers.legCount,
        // Ids, the same in every language: one text, as the English record had it.
        newLegIds: created.map((leg) => leg.id).join(', '),
      }),
    }
    // Row 11 review: each step after the commit runs on its own, so one failure never skips the rest. The
    // wait has its stamp and the sweep; the legs have the sweep (cross check 7).
    await this.afterClose(`record the confirm of split ${request.id}`, () =>
      this.deliveryEventService.recordSplitEvent(confirmed, delivery.status)
    )
    if (keptSize !== delivery.boxSize) {
      // Cross check 9: the stated exception to spec 0043's "no size change once offered".
      const sizeEvent: DeliveryBoxSizeChangedEvent = {
        deliveryId: delivery.id,
        type: EnumDeliveryEventType.BOX_SIZE_CHANGED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        ...eventText('BOX_SIZE_SET_BY_SPLIT', { adminId: admin.id, size: keptSize, wasSize: delivery.boxSize }),
      }
      await this.afterClose(`record the size change of split ${request.id}`, () =>
        this.deliveryEventService.recordBoxEvent(sizeEvent, delivery.status)
      )
    }
    if (!delivery.partnerId) {
      this.logger.warn(`Delivery ${delivery.id} has no restaurant: its split legs are not charged to anyone`)
    }
    await this.deliveryEventService.settleSplitWait(request.id)
    for (const leg of created) await this.startLeg(leg, admin, request.id)
    await this.afterClose(`tell the rider about split ${request.id}`, () =>
      this.deliveryEventService.notifySplitDecided(request.courierId, {
        deliveryId: delivery.id,
        outcome: 'CONFIRMED',
        adminNote: null,
        legNumber: numbers.keptNumber,
        legCount: numbers.legCount,
        boxSize: keptSize,
      })
    )
  }

  // A step after the answer is already committed: logged on failure, never thrown, so the steps after it
  // still run (row 11 review).
  private async afterClose(what: string, step: () => Promise<unknown>): Promise<void> {
    try {
      await step()
    } catch (error) {
      this.logger.error(`SPLIT_AFTER_CLOSE_FAILED could not ${what}: ${error}`)
    }
  }

  // A new leg's charge event and its CREATED, which sends it into matching. Never throws: the leg exists,
  // and the sweep starts any leg still in CREATED a minute later.
  // Whether the leg was started (its CREATED written), so the sweep counts starts, not rows found.
  private async startLeg(leg: CreatedLeg, admin: Admin | null, requestId: string): Promise<boolean> {
    try {
      if (leg.charged) {
        const charged: DeliveryPartnerChargedForSplitEvent = {
          deliveryId: leg.id,
          type: EnumDeliveryEventType.PARTNER_CHARGED_FOR_SPLIT,
          actor: EnumEventActor.SYSTEM,
          source: EnumDeliveryEventSource.OPENCOURIER,
          ...eventText('PARTNER_CHARGED_FOR_SPLIT', { amount: leg.chargeCents, currency: leg.currencyCode, splitId: requestId }),
        }
        await this.deliveryEventService.recordSplitEvent(charged, EnumDeliveryStatus.CREATED)
      }
      await this.deliveryEventService.processDeliveryEvent({
        deliveryId: leg.id,
        type: EnumDeliveryEventType.CREATED,
        actor: admin ? EnumEventActor.ADMIN : EnumEventActor.SYSTEM,
        source: EnumDeliveryEventSource.OPENCOURIER,
        ...(admin
          ? eventText('SPLIT_LEG_CREATED_BY_ADMIN', {
              legNumber: leg.legNumber,
              splitId: requestId,
              adminId: admin.id,
              size: leg.boxSize,
            })
          : eventText('SPLIT_LEG_CREATED', { legNumber: leg.legNumber, splitId: requestId, size: leg.boxSize })),
      })
      return true
    } catch (error) {
      this.logger.error(`SPLIT_LEG_START_FAILED leg ${leg.id} of split ${requestId}: ${error}`)
      return false
    }
  }

  // Cross check 7: the sweep's step. Split legs still in CREATED a minute after they were made (the process
  // stopped between the commit and their CREATED) are started now. The charge event is written once only.
  async startUnstartedLegs(now = new Date()): Promise<number> {
    const rows = await this.prisma.delivery.findMany({
      where: {
        status: EnumDeliveryStatus.CREATED,
        createdAt: { lt: new Date(now.getTime() - 60_000), gt: new Date(now.getTime() - 24 * 3600_000) },
        // `delivery` is the Delivery's relation to its DeliveryQuote (the schema's old name for it): the
        // quote's source marks a leg a split made.
        delivery: { source: EnumQuoteSource.SPLIT },
      },
      select: { id: true, legNumber: true, boxSize: true, currencyCode: true },
      take: 50,
    })
    let started = 0
    for (const row of rows) {
      const charge = await this.prisma.partnerCharge.findUnique({ where: { splitLegOf: row.id } })
      const chargeEvent = await this.prisma.deliveryEvent.findFirst({
        where: { deliveryId: row.id, type: EnumDeliveryEventType.PARTNER_CHARGED_FOR_SPLIT },
        select: { id: true },
      })
      const ok = await this.startLeg(
        {
          id: row.id,
          legNumber: row.legNumber ?? 0,
          boxSize: row.boxSize,
          chargeCents: charge?.amount ?? 0,
          currencyCode: row.currencyCode,
          charged: Boolean(charge) && !chargeEvent,
        },
        null,
        'sweep'
      )
      if (ok) started++
    }
    return started
  }
}

// Spec 0054: the boxes of a split as parts of an event message (`{{sizes, list}}`): "Small and Large" in
// English, as legsText wrote them, and each app's own words for the sizes.
function boxParts(legs: { boxSize: BoxSize }[]): EventPart[] {
  return legs.map((leg) => eventPart('BOX', { size: leg.boxSize }))
}
