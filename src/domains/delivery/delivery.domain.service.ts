import { OfferReasonRepository } from 'src/persistence/repositories/offer-reason.repository'
import { eventText } from 'src/domains/delivery-event/event-text'
import { RIDER_DEACTIVATED_SENTENCE } from 'src/domains/courier/account-upkeep'
import { CourierWaitRules } from 'src/domains/delivery/wait-pay'
import { PartnerRepository } from 'src/persistence/repositories/partner.repository'
import {
  READY_ACTION_STATUSES,
  READY_SENTENCES,
  delayedReadyAt,
  initialReadyAt,
  pastReadyLimit,
  readyActionRefusal,
} from './ready-signals'
import type {
  DeliveryBoxSizeAssumedEvent,
  DeliveryBoxSizeChangedEvent,
  DeliveryBoxOverCapacityConfirmedEvent,
  DeliveryFoodReadyEvent,
  DeliveryReadyDelayedEvent,
} from 'src/shared-types/delivery-events'
import { boxUnitsFor, wouldOverfillBox, RIDER_BOX_UNITS } from './box'
import { OrderLeg, missingLegNumbers } from './legs'
import { STACK_CHANGED_SENTENCE } from './stack'
import { ADD_ON_NOT_AUTOMATIC_SENTENCE, isAddOnOffer } from './add-on'
import { adminLabel } from 'src/domains/partner-billing/billing-month'
import { ConflictException, BadRequestException, Injectable, Logger } from '@nestjs/common'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryWhereArgs } from './types/delivery-where-args.type'
import {
  BoxSize,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumCourierCompensationReason,
  EnumCancelledBy,
  Prisma,
} from '@prisma/types'
import { IDeliveryUpdate } from './interfaces/IDeliveryUpdate'
import { DeliveryOfferView } from './types/delivery-offer-view.type'
import { DeliveryEntity } from './entities/delivery.entity'
import { IDeliveryCreate } from './interfaces/IDeliveryCreate'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CacheService } from 'src/services/cache/cache.service'
import { addCourierToRejectedList, removeCourierFromRejectedList } from 'src/services/cache/rejected-couriers'
import {
  BOX_SIZE_LOCKED_MESSAGE,
  BoxOverCapacityException,
  CantUpdateDeliveryStatusError,
  DeliveryCantBeAcceptedException,
  OfferHasEndedException,
} from 'src/errors'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import {
  DeliveryCanceledEvent,
  DeliveryConfirmedEvent,
  DeliveryDispatchedEvent,
  DeliveryDroppedOffEvent,
  DeliveryFailedEvent,
  DeliveryPickedUpEvent,
  DeliveryRejectedEvent,
  DeliveryReassignedEvent,
  DELIVERY_ONGOING_STATUSES,
} from 'src/shared-types/index'
import { ISubmitDeliveryEvent } from '../delivery-event/interfaces/ISubmitDeliveryEvent'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'
import { ConfigDomainService } from '../config/config.domain.service'
import {
  resolveReassignmentPayout,
  formatReassignmentAwardFailure,
  ReassignmentAwardLogContext,
  ReassignmentFailureStage,
} from './utils/reassignment-payout.util'
import { ICourierTap } from './interfaces/ICourierTap'
import { describeErrorForLog, errorSummaryForLog } from 'src/utils/errorForLog'

// Spec 0021 (AC-4): how a rider's arrival was made, as the end of its event message. Row 23's waiting
// pay starts from the arrival, so members must be able to read which kind each one was (value 1).
// A message, not a column: there is then no field to count one rider's taps by (value 5).
export function arrivalHow(detected?: boolean): string {
  return detected === true ? ' (detected by the app)' : ' (tapped by the rider)'
}

// Spec 0054: the same, as the code an event message carries (server.enum.arrivalHow in the translations).
export function arrivalCode(detected?: boolean): 'DETECTED' | 'TAPPED' {
  return detected === true ? 'DETECTED' : 'TAPPED'
}

// A restaurant row always has its own usual prep time; this covers a test delivery with no partner.
const DEFAULT_USUAL_PREP_MINUTES = 15

// Spec 0043: the admin who acted, as much as a record needs to name them (adminLabel).
export type AdminRef = { id: string; email: string | null; username: string | null }

// Row 167: a restaurant's new size as part of its edit: the extra conditions for the edit's conditional write, and
// the fields it writes. `BoxSize` is the Prisma enum, so `data` can go into the write as it is.
export type BoxSizeChange = {
  where: { matchedCourierId: null; courierId: null; boxSize: BoxSize }
  data: { boxSize: BoxSize; boxUnits: number; boxSizeAssumed: false }
}

@Injectable()
export class DeliveryDomainService {
  private readonly logger = new Logger(DeliveryDomainService.name)
  constructor(
    private deliveryRepository: DeliveryRepository,
    private eventEmitter: EventEmitter2,
    private cacheService: CacheService,
    private deliveryEventService: DeliveryEventService,
    private courierRepository: CourierRepository,
    private courierCompensationRepository: CourierCompensationRepository,
    private configDomainService: ConfigDomainService,
    private partnerRepository: PartnerRepository,
    // Spec 0044 (decision 12.6): last and optional for TypeScript only; Nest always injects it.
    private offerReasonRepository?: OfferReasonRepository
  ) {}

  async getById(deliveryId: string, otherFilters?: DeliveryWhereArgs) {
    const delivery = await this.deliveryRepository.findById(deliveryId, otherFilters)

    return delivery
  }

  async getByIdOrThrow(deliveryId: string, otherFilters?: DeliveryWhereArgs) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId, otherFilters)

    return delivery
  }

  async getByIdOrThrowWithQuote(deliveryId: string) {
    return this.deliveryRepository.findByIdOrThrowWithQuote(deliveryId)
  }

  async getByIdOrThrowWithLocation(deliveryId: string, otherFilters?: DeliveryWhereArgs) {
    const delivery = await this.deliveryRepository.findByIdOrThrowWithLocations(deliveryId, otherFilters)

    return delivery
  }

  async getByDeliveryQuoteId(deliveryQuoteId: string) {
    const delivery = await this.deliveryRepository.findByDeliveryQuoteId(deliveryQuoteId)

    return delivery
  }

  async getMany(args: DeliveryWhereArgs, page?: number, perPage?: number) {
    const deliveries = await this.deliveryRepository.findManyPaginated(args, page, perPage)

    return deliveries
  }

  // The admin Offer column (spec 0002, AC-11), for many deliveries in two queries. Only deliveries
  // still looking for a rider get anything: an open offer gets its rider's name, a delivery nobody
  // is offered gets the start of its wait. Keyed by delivery id; every delivery gets an entry.
  async getOfferViews(
    deliveries: Pick<DeliveryEntity, 'id' | 'status' | 'courierId' | 'matchedCourierId'>[]
  ): Promise<Map<string, DeliveryOfferView>> {
    const looking = deliveries.filter((d) => d.status === EnumDeliveryStatus.ASSIGNING_COURIER && !d.courierId)
    const offered = looking.filter((d) => d.matchedCourierId)
    const waiting = looking.filter((d) => !d.matchedCourierId)

    const names = await this.courierRepository.findNamesByIds(offered.map((d) => d.matchedCourierId as string))
    const waitingSince = await this.deliveryRepository.findLatestNoCourierAvailableAt(waiting.map((d) => d.id))

    const views = new Map<string, DeliveryOfferView>()
    for (const delivery of deliveries) {
      const isLooking = delivery.status === EnumDeliveryStatus.ASSIGNING_COURIER && !delivery.courierId
      views.set(delivery.id, {
        matchedCourierName:
          isLooking && delivery.matchedCourierId ? names.get(delivery.matchedCourierId) ?? null : null,
        waitingForCourierSince: isLooking && !delivery.matchedCourierId ? waitingSince.get(delivery.id) ?? null : null,
      })
    }
    return views
  }

  async getManyWithIncludes(args: DeliveryWhereArgs, page?: number, perPage?: number) {
    const deliveries = await this.deliveryRepository.findManyPaginated(args, page, perPage)

    return deliveries
  }

  async update(deliveryId: string, input: IDeliveryUpdate) {
    const delivery = await this.deliveryRepository.update(deliveryId, input)

    return delivery
  }

  // Row 161: the repository's conditional write (spec 0002's race rule), for a caller outside this domain that
  // decided from what it read: writes `input` only if the delivery still matches `where`, and says whether it did.
  async updateIfMatches(
    deliveryId: string,
    where: Prisma.DeliveryWhereInput,
    input: IDeliveryUpdate
  ): Promise<boolean> {
    return this.deliveryRepository.updateIfMatches(deliveryId, where, input)
  }

  // Spec 0033: what the rider's job card needs from the co-op's settings.
  async getCourierWaitRules(): Promise<CourierWaitRules> {
    const config = this.configDomainService.instanceConfig
    return {
      leaveMinutes: await config.getWaitLimitMinutes(),
      freeMinutes: await config.getWaitPayFreeMinutes(),
      payOn: (await config.getWaitPayEnabled()) && (await config.getWaitPayCentsPerMinute()) > 0,
      splitAnswerMinutes: await config.getSplitAnswerMinutes(),
    }
  }

  // Spec 0044 (AC-8): why each offer of this delivery went to its rider, oldest first.
  // Spec 0046 (AC-6): every leg of a restaurant's order, by leg number. Empty for no reference.
  async getOrderLegsOf(partnerId: string, orderReference: string | null | undefined): Promise<OrderLeg[]> {
    if (!orderReference) return []
    return this.deliveryRepository.findOrderLegs(partnerId, orderReference)
  }

  // Spec 0046 (AC-6, cross check 5): this delivery's order, its legs and the leg numbers never created.
  async getOrderLegs(delivery: DeliveryEntity): Promise<{ legs: OrderLeg[]; missingLegNumbers: number[] }> {
    if (delivery.legCount == null || !delivery.partnerId) return { legs: [], missingLegNumbers: [] }
    const legs = await this.getOrderLegsOf(delivery.partnerId, delivery.orderReference)
    return { legs, missingLegNumbers: missingLegNumbers(delivery.legCount, legs) }
  }

  async getOfferReasons(deliveryId: string) {
    return this.offerReasonRepository ? this.offerReasonRepository.findByDeliveryId(deliveryId) : []
  }

  // Spec 0033: what the restaurant was charged for keeping riders waiting on this delivery.
  async getWaitCharges(deliveryId: string) {
    return this.deliveryRepository.findWaitCharges(deliveryId)
  }

  async create(input: IDeliveryCreate) {
    // Every order gets a ready time (spec 0023, AC-1): the restaurant's pick, or its usual prep time.
    // `pickupReadyAt` keeps its own meaning; `readyAt` is the promise the restaurant can move later.
    const now = new Date()
    const partner = input.partnerId ? await this.partnerRepository.findById(input.partnerId) : null
    const pickupReadyAt = input.pickupReadyAt ? new Date(input.pickupReadyAt) : null
    // Spec 0029, AC-2: busy mode adds its minutes to every new order, picked time or usual one.
    const busyExtraMinutes = partner?.busyExtraMinutes ?? 0
    const readyAt = new Date(
      initialReadyAt(pickupReadyAt, partner?.usualPrepMinutes ?? DEFAULT_USUAL_PREP_MINUTES, now).getTime() +
        busyExtraMinutes * 60_000
    )
    // Spec 0043 (AC-1, AC-3): the size the restaurant picked, or the co-op's default size when none
    // was sent (recorded below as assumed). The units are copied from the setting now, so a later
    // change of the setting never alters this delivery.
    const { boxSize: sentBoxSize, ...rest } = input
    const instanceConfig = this.configDomainService.instanceConfig
    const boxSize = sentBoxSize ?? (await instanceConfig.getBoxDefaultSize())
    const boxUnits = boxUnitsFor(boxSize, {
      boxUnitsSmall: await instanceConfig.getBoxUnitsSmall(),
      boxUnitsMedium: await instanceConfig.getBoxUnitsMedium(),
      boxUnitsLarge: await instanceConfig.getBoxUnitsLarge(),
    })
    const boxSizeAssumed = !sentBoxSize
    // Spec 0033 (decision 23.6): the first promise is kept apart, so a later "+10" cannot erase a wait.
    const delivery = await this.deliveryRepository.create({
      ...rest,
      readyAt,
      promisedReadyAt: readyAt,
      boxSize,
      boxUnits,
      boxSizeAssumed,
    })

    // Spec 0043 (AC-3): before CREATED sends it into matching, so the record shows the size matching
    // used was assumed. No status change, never through processDeliveryEvent.
    if (boxSizeAssumed) {
      const assumedEvent: DeliveryBoxSizeAssumedEvent = {
        deliveryId: delivery.id,
        type: EnumDeliveryEventType.BOX_SIZE_ASSUMED,
        actor: EnumEventActor.SYSTEM,
        source: EnumDeliveryEventSource.OPENCOURIER,
        ...eventText('BOX_SIZE_ASSUMED', { size: boxSize, units: boxUnits }),
      }
      // Review fix: a failed insert must not stop the order. Before this guard it threw before CREATED,
      // and the delivery stayed in CREATED, never offered. The columns still say it was assumed.
      try {
        await this.deliveryEventService.recordBoxEvent(assumedEvent, delivery.status)
      } catch (error) {
        this.logger.error(`Could not record BOX_SIZE_ASSUMED for delivery ${delivery.id}: ${errorSummaryForLog(error)}`)
      }
    }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.CREATED,
      actor: EnumEventActor.PARTNER,
      source: EnumDeliveryEventSource.PARTNER_APP,
      ...(busyExtraMinutes > 0
        ? eventText('CREATED_BUSY', {
            deliveryId: delivery.id,
            partnerId: input.partnerId ?? null,
            readyAt: readyAt.toISOString(),
            busyMinutes: busyExtraMinutes,
          })
        : eventText('CREATED', { deliveryId: delivery.id, partnerId: input.partnerId ?? null, readyAt: readyAt.toISOString() })),
    })

    return delivery
  }

  // Spec 0043 (AC-3, cross check 4) and row 167: what a restaurant's new size means for its edit. Refused while a
  // rider has been offered or holds the order (an open offer has already shown the size). The units are copied
  // again from the setting in force, and the size is no longer assumed. Nothing is written here: the partner edit
  // adds `where` and `data` to its own one conditional write, so the size lands with the rest of the edit or not
  // at all. `where` also keeps a size from changing under an offer that goes out at the same moment.
  async boxSizeChangeFor(delivery: DeliveryEntity, newSize: BoxSize): Promise<BoxSizeChange> {
    if (delivery.matchedCourierId !== null || delivery.courierId !== null) {
      throw new ConflictException(BOX_SIZE_LOCKED_MESSAGE)
    }
    const instanceConfig = this.configDomainService.instanceConfig
    const boxUnits = boxUnitsFor(newSize, {
      boxUnitsSmall: await instanceConfig.getBoxUnitsSmall(),
      boxUnitsMedium: await instanceConfig.getBoxUnitsMedium(),
      boxUnitsLarge: await instanceConfig.getBoxUnitsLarge(),
    })
    return {
      // `null` is a real condition in Prisma ("is null"); only `undefined` would drop it. boxSize is never null.
      where: { matchedCourierId: null, courierId: null, boxSize: delivery.boxSize },
      data: { boxSize: newSize, boxUnits, boxSizeAssumed: false },
    }
  }

  // Row 167 (value 1): the size change on the record, written only after the edit's write has landed.
  async recordBoxSizeChanged(delivery: DeliveryEntity, change: BoxSizeChange): Promise<void> {
    const changedEvent: DeliveryBoxSizeChangedEvent = {
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.BOX_SIZE_CHANGED,
      actor: EnumEventActor.PARTNER,
      source: EnumDeliveryEventSource.PARTNER_APP,
      ...eventText('BOX_SIZE_CHANGED_BY_RESTAURANT', {
        fromSize: delivery.boxSize,
        fromUnits: delivery.boxUnits,
        toSize: change.data.boxSize,
        toUnits: change.data.boxUnits,
      }),
    }
    await this.deliveryEventService.recordBoxEvent(changedEvent, delivery.status)
  }

  // Spec 0023 (AC-3, AC-5): the restaurant moves the ready time later by 5, 10 or 15 minutes. One
  // conditional write on what was read, so a delay never lands after food ready or after pickup, and
  // two taps on the same time add once (the second sees the time changed).
  async delayReady(deliveryId: string, minutes: number, expectedReadyAt: Date | null): Promise<DeliveryEntity> {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    this.refuseReadyAction(delivery, true)
    if ((delivery.readyAt?.getTime() ?? null) !== (expectedReadyAt?.getTime() ?? null)) {
      throw new ConflictException(READY_SENTENCES.changed)
    }
    const now = new Date()
    const next = delayedReadyAt(delivery.readyAt, now, minutes)
    if (pastReadyLimit(next, delivery.createdAt)) {
      throw new ConflictException(READY_SENTENCES.tooLate)
    }
    const written = await this.deliveryRepository.updateIfMatches(
      deliveryId,
      { readyAt: delivery.readyAt, foodReadyAt: null, status: { in: READY_ACTION_STATUSES } },
      { readyAt: next }
    )
    if (!written) {
      // Something changed between the read and the write: say what, from a fresh read.
      this.refuseReadyAction(await this.deliveryRepository.findByIdOrThrow(deliveryId), true)
      throw new ConflictException(READY_SENTENCES.changed)
    }
    const delayed: DeliveryReadyDelayedEvent = {
      deliveryId,
      type: EnumDeliveryEventType.READY_DELAYED,
      actor: EnumEventActor.PARTNER,
      source: EnumDeliveryEventSource.PARTNER_APP,
      ...eventText('READY_DELAYED', { minutes, readyAt: next.toISOString() }),
    }
    await this.deliveryEventService.recordReadyEvent(delayed, delivery.status)
    const updated = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    await this.deliveryEventService.notifyReadyUpdated(updated, minutes)
    return updated
  }

  // Spec 0023 (AC-4): the restaurant marks the food ready, once. A repeat (or a tap that lost a race to
  // another) answers the delivery as it is, with no second event.
  async markFoodReady(deliveryId: string): Promise<DeliveryEntity> {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    if (delivery.foodReadyAt) return delivery
    this.refuseReadyAction(delivery, false)
    const now = new Date()
    const written = await this.deliveryRepository.updateIfMatches(
      deliveryId,
      { foodReadyAt: null, status: { in: READY_ACTION_STATUSES } },
      { foodReadyAt: now }
    )
    if (!written) {
      const again = await this.deliveryRepository.findByIdOrThrow(deliveryId)
      if (again.foodReadyAt) return again
      this.refuseReadyAction(again, false)
      throw new ConflictException(READY_SENTENCES.changed)
    }
    const ready: DeliveryFoodReadyEvent = {
      deliveryId,
      type: EnumDeliveryEventType.FOOD_READY,
      actor: EnumEventActor.PARTNER,
      source: EnumDeliveryEventSource.PARTNER_APP,
      ...eventText('FOOD_READY', { at: now.toISOString() }),
    }
    await this.deliveryEventService.recordReadyEvent(ready, delivery.status)
    const updated = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    await this.deliveryEventService.notifyReadyUpdated(updated, null)
    // Spec 0031, AC-7: a held delivery goes out now. Only one still waiting with nobody offered. The
    // restaurant's tap is already saved, so a failure here must not answer it with an error. Spec 0033
    // (AC-7): an order a rider left is held with Timed offers off too, so it goes out here as well.
    if (
      updated.status === EnumDeliveryStatus.ASSIGNING_COURIER &&
      !updated.matchedCourierId &&
      !updated.courierId &&
      (updated.undispatchedAt !== null ||
        (await this.configDomainService.instanceConfig.getOfferTimingEnabled()))
    ) {
      try {
        await this.deliveryEventService.offerOrWait(deliveryId)
      } catch (error) {
        this.logger.error(`Offering delivery ${deliveryId} after food ready failed: ${errorSummaryForLog(error)}`)
      }
    }
    return updated
  }

  // Throws the fixed 409 sentence when a ready action may not run on this delivery (AC-3, AC-4).
  // `foodReadyRefuses`: a delay is refused once the food is ready; food ready itself is not.
  private refuseReadyAction(delivery: DeliveryEntity, foodReadyRefuses: boolean): void {
    if (foodReadyRefuses && delivery.foodReadyAt) {
      throw new ConflictException(READY_SENTENCES.alreadyReady)
    }
    const refusal = readyActionRefusal(delivery.status)
    if (refusal) throw new ConflictException(refusal)
  }

  // Spec 0002, AC-5: an accept that reaches the server before the offer ends wins; one that arrives
  // after (expired, moved on, cancelled) gets 409 "This offer has ended" and changes nothing.
  // `automatic`: the rider's phone accepted on its own (auto accept, spec 0020). It only marks the
  // event's message; it is not stored anywhere a rider could be counted by (value 5).
  // `alone` (spec 0048, decision 80.5): an admin accepting one order of an open pair on the rider's behalf
  // accepts that order only; the other stays offered to the same rider as a single offer (the release rule
  // in saveDeliveryEvent runs on its ACCEPTED). Only the rider accepts a pair, after seeing both.
  async acceptDelivery(deliveryId: string, courierId: string, automatic = false, alone = false) {
    // No rider takes work during a heat or storm stop (spec 0014; row 29 review): an offer that
    // slipped past the stop's start cannot be accepted.
    await this.deliveryEventService.refuseIfDispatchStopped()
    // Spec 0051: a deactivated rider takes no work (checked again after the take, below).
    await this.deliveryEventService.refuseIfCourierDeactivated(courierId)
    // A rider in an active SOS takes no job, not even an offer that was already on their screen at
    // the hold: a mis-tap or the phone's auto accept would give a rider in danger work (decision
    // 73.10). The offer is left to expire as usual (spec 0022, AC-7). This is a check before the
    // write: an SOS that starts in the same few milliseconds is not caught, and the rider can still
    // hand the job back.
    await this.deliveryEventService.refuseIfCourierInSos(courierId)
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    if (delivery.status !== EnumDeliveryStatus.ASSIGNING_COURIER || delivery.matchedCourierId !== courierId) {
      this.logger.log(
        `Courier ${courierId} answered delivery ${deliveryId} too late: status ${delivery.status}, offered to ${delivery.matchedCourierId}`
      )
      throw new OfferHasEndedException()
    }

    // Spec 0048 (AC-5): an offer of two orders together is accepted as a pair, by either delivery.
    // Decision 128.0 (AC-8 as amended): the phone's auto accept takes a pair like a single order. The box
    // limit (spec 0043) and the cap of two were already checked when the pair was offered, so it always fits.
    if (delivery.offerGroupId && !alone) {
      return this.acceptStack(delivery, courierId, automatic)
    }
    // Row 81 (AC-8): one more order on the way is never accepted by the phone on its own either: the rider
    // must see what it adds to the job they are on. The rider's own accept goes through as a single one.
    if (automatic && isAddOnOffer(delivery)) throw new ConflictException(ADD_ON_NOT_AUTOMATIC_SENTENCE)

    // Take the offer in one conditional update. The expiry job and the offline hook only end an
    // offer nobody has taken (courierId null), so once this succeeds neither can touch it, and if
    // either got there first this matches nothing.
    const taken = await this.deliveryRepository.updateIfMatches(
      deliveryId,
      {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt: delivery.offeredAt,
        courierId: null,
      },
      { courierId, offerExpiresAt: null }
    )
    if (!taken) {
      throw new OfferHasEndedException()
    }

    // A stop that began between the first check and the claim, or (spec 0051, row 108 review) a
    // deactivation that committed meanwhile: give the offer back and refuse. The stop's minute sweep
    // catches what slips past even this (agy review of row 29).
    try {
      await this.deliveryEventService.refuseIfDispatchStopped()
      if (await this.deliveryEventService.isCourierDeactivatedAfterTake(courierId)) {
        throw new ConflictException(RIDER_DEACTIVATED_SENTENCE)
      }
    } catch (error) {
      await this.deliveryRepository.updateIfMatches(
        deliveryId,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        // Review fix (row 81): an add on given back loses its stop list through the job, as on a decline.
        { courierId: null, matchedCourierId: null, offeredAt: null, offerExpiresAt: null, stopSequence: Prisma.DbNull }
      )
      throw error
    }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.ACCEPTED,
      actor: EnumEventActor.COURIER,
      courierId: courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      ...eventText(automatic ? 'ACCEPTED_AUTOMATICALLY' : 'ACCEPTED', { courierId, deliveryId: delivery.id }),
    })

    // processDeliveryEvent never throws; it records a failure instead. If the accept did not take,
    // give the offer back exactly as it was, deadline included, so it is not stuck half taken.
    const afterAccept = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    if (afterAccept.status === EnumDeliveryStatus.ASSIGNING_COURIER && afterAccept.courierId === courierId) {
      const givenBack = await this.deliveryRepository.updateIfMatches(
        deliveryId,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        { courierId: null, offerExpiresAt: delivery.offerExpiresAt, acceptedAt: null, handBackUntil: null }
      )
      // A deadline given back needs a timer behind it: the original expiry job may have run while
      // the offer was taken and done nothing (it only ends an offer nobody has taken).
      if (givenBack && delivery.offeredAt && delivery.offerExpiresAt) {
        await this.deliveryEventService.rearmOfferExpiry(
          deliveryId,
          courierId,
          delivery.offeredAt,
          delivery.offerExpiresAt
        )
      }
      // The request log no longer prints 404 answers (row 121), and this one is not an ordinary miss: the
      // rider won the offer but the server could not record the accept. One warning keeps it traceable.
      this.logger.warn(`Accept by courier ${courierId} on delivery ${deliveryId} did not take; offer given back`)
      throw new DeliveryCantBeAcceptedException(`Delivery ${deliveryId} could not be accepted, please try again`)
    }

    return delivery
  }

  // Spec 0048 (AC-5, cross check 8): accepting a stack. Both deliveries are taken in one conditional write
  // (still offered to this rider by this offer, nobody has taken them, exactly two rows), else 409 and
  // nothing changes. Then the same checks as a single accept, and an ACCEPTED event for each, the tapped
  // one first. If the first ACCEPTED does not take, both offers are given back as they were. If only the
  // second does not, the first stands and the minute sweep completes the second (completeTakenAccepts).
  // Each delivery keeps its own pay, fixed at the offer from its own quote (AC-9).
  // `automatic` (decision 128.0): the phone's auto accept took the pair; both ACCEPTED messages say so,
  // the only place it is recorded (value 5), exactly as for a single order.
  private async acceptStack(delivery: DeliveryEntity, courierId: string, automatic = false) {
    const groupId = delivery.offerGroupId as string
    const taken = await this.deliveryRepository.takeOfferGroup(groupId, courierId, delivery.offeredAt)
    if (!taken) {
      this.logger.log(`Courier ${courierId} answered stack ${groupId} after it changed; nothing accepted`)
      throw new ConflictException(STACK_CHANGED_SENTENCE)
    }
    // Decision 128.6: the other delivery is read after the take, from the rows the take wrote, so an order
    // that joined or left the group between an earlier read and the take can never be left taken but
    // without its ACCEPTED event.
    const members = await this.deliveryRepository.findTakenGroupMembers(groupId, courierId, delivery.offeredAt)
    const partner = members.find((member) => member.id !== delivery.id)
    const both = partner ? [delivery, partner] : [delivery]

    // As for a single accept: a stop or a deactivation that landed between the first checks and the take
    // ends both offers and refuses.
    try {
      await this.deliveryEventService.refuseIfDispatchStopped()
      if (await this.deliveryEventService.isCourierDeactivatedAfterTake(courierId)) {
        throw new ConflictException(RIDER_DEACTIVATED_SENTENCE)
      }
    } catch (error) {
      for (const member of both) {
        await this.deliveryRepository.updateIfMatches(
          member.id,
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
          { courierId: null, matchedCourierId: null, offeredAt: null, offerExpiresAt: null, offerGroupId: null, stopSequence: Prisma.DbNull }
        )
      }
      throw error
    }

    const acceptOne = async (member: DeliveryEntity, other: DeliveryEntity | undefined) => {
      await this.deliveryEventService.processDeliveryEvent({
        deliveryId: member.id,
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
        ...(other
          ? eventText(automatic ? 'ACCEPTED_TOGETHER_AUTOMATICALLY' : 'ACCEPTED_TOGETHER', {
              courierId,
              deliveryId: member.id,
              otherDeliveryId: other.id,
            })
          : eventText(automatic ? 'ACCEPTED_AUTOMATICALLY' : 'ACCEPTED', { courierId, deliveryId: member.id })),
      })
      const after = await this.deliveryRepository.findByIdOrThrow(member.id)
      return !(after.status === EnumDeliveryStatus.ASSIGNING_COURIER && after.courierId === courierId)
    }

    if (!(await acceptOne(delivery, partner))) {
      // Give both back exactly as they were, deadlines included, with a timer behind each (as a single
      // accept does), so neither is stuck half taken. Both were offered together with one deadline, so the
      // tapped delivery's (read before the take, which clears it) is the partner's too.
      const { offeredAt, offerExpiresAt } = delivery
      for (const member of both) {
        const givenBack = await this.deliveryRepository.updateIfMatches(
          member.id,
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
          { courierId: null, offerExpiresAt, acceptedAt: null, handBackUntil: null }
        )
        if (givenBack && offeredAt && offerExpiresAt) {
          await this.deliveryEventService.rearmOfferExpiry(member.id, courierId, offeredAt, offerExpiresAt)
        }
      }
      this.logger.warn(`Accept by courier ${courierId} on stack ${groupId} did not take; offers given back`)
      throw new DeliveryCantBeAcceptedException(`Delivery ${delivery.id} could not be accepted, please try again`)
    }

    if (partner && !(await acceptOne(partner, delivery))) {
      this.logger.warn(
        `Second accept of stack ${groupId} (delivery ${partner.id}) did not take; the minute sweep completes it`
      )
    }
    return delivery
  }

  // Spec 0002, AC-5: same rule as accept. A decline after the offer ended gets 409 and changes nothing.
  async rejectDelivery(deliveryId: string, courierId: string) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    if (delivery.status !== EnumDeliveryStatus.ASSIGNING_COURIER || delivery.matchedCourierId !== courierId) {
      this.logger.log(
        `Courier ${courierId} answered delivery ${deliveryId} too late: status ${delivery.status}, offered to ${delivery.matchedCourierId}`
      )
      throw new OfferHasEndedException()
    }

    // Spec 0048 (AC-5): declining either delivery of a stack ends both.
    if (delivery.offerGroupId) {
      await this.deliveryEventService.declineStack(delivery, courierId)
      return delivery
    }

    // Put the courier on this delivery's skip list BEFORE the offer is cleared, so a matcher running
    // in between (a rider coming Online, a retry) cannot offer it straight back to them. True only
    // when this call added them, so a failed decline below takes back only its own entry. A failed
    // write is logged, not thrown: the decline must still go through.
    let addedToSkipList = false
    try {
      addedToSkipList = await this.addCourierToRejectedList(deliveryId, courierId)
    } catch (error) {
      this.logger.error(
        `Could not add courier ${courierId} to the skip list of ${deliveryId}: ${errorSummaryForLog(error)}`
      )
    }

    // End the offer in one conditional update (all three offer fields are cleared together), so a
    // decline and the expiry job racing for the same offer cannot both act on it.
    let declined: boolean
    try {
      declined = await this.deliveryRepository.updateIfMatches(
        deliveryId,
        {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: courierId,
          offeredAt: delivery.offeredAt,
          courierId: null,
        },
        // Row 81: a declined add on also loses its stop list through the rider's job (null on any other single).
        { matchedCourierId: null, offeredAt: null, offerExpiresAt: null, stopSequence: Prisma.DbNull }
      )
    } catch (error) {
      if (addedToSkipList) await this.undoOwnSkipListEntry(deliveryId, courierId)
      throw error
    }
    if (!declined) {
      if (addedToSkipList) await this.undoOwnSkipListEntry(deliveryId, courierId)
      throw new OfferHasEndedException()
    }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.REJECTED,
      actor: EnumEventActor.COURIER,
      courierId: courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      ...eventText('REJECTED', { courierId, deliveryId: delivery.id }),
    })

    return delivery
  }

  // Spec 0015: what the restaurant was charged for this delivery's cancellation, if anything.
  async getPartnerCharge(deliveryId: string) {
    return this.deliveryRepository.findPartnerCharge(deliveryId)
  }

  // `cancelledBy` is who asked (spec 0015): the restaurant itself, or its customer through it.
  async cancelDelivery(deliveryId: string, requestedBy?: EnumCancelledBy | null) {
    // `??`, not a default parameter, so a null can never travel on as "nobody said" (row 32 review).
    const cancelledBy = requestedBy ?? EnumCancelledBy.RESTAURANT
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    const canceledEvent: DeliveryCanceledEvent = {
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.CANCELED,
      actor: EnumEventActor.PARTNER,
      source: EnumDeliveryEventSource.PARTNER_APP,
      cancelledBy,
      ...eventText('CANCELED_BY_PARTNER', { deliveryId: delivery.id, partnerId: delivery.partnerId, cancelledBy }),
    }
    await this.deliveryEventService.processDeliveryEvent(canceledEvent)

    // Read again: the restaurant's answer shows the status the cancel left, not the one before it
    // (agy review; upstream returned the read from before the event).
    return this.deliveryRepository.findByIdOrThrow(deliveryId)
  }

  // `detected` (spec 0021): true when the rider's app noticed the arrival by itself; anything else
  // (false or not sent) is a tap. It only marks the message, which is how members tell them apart.
  async courierArrivedAtDropOff(deliveryId: string, tap?: ICourierTap, detected?: boolean) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    const occurredAt = tap ? await this.deliveryEventService.occurredAtForCourierTap(delivery, tap) : undefined

    // if (delivery.status !== EnumDeliveryStatus.PICKED_UP) {
    //   throw new CantUpdateDeliveryStatusError(`Delivery ${deliveryId} can not be marked as arrived at dropoff location, delivery hasn't been picked up. On status ${delivery.status}`)
    // }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.ARRIVED_AT_DROPOFF_LOCATION,
      actor: EnumEventActor.COURIER,
      courierId: delivery.courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      ...(occurredAt ? { occurredAt } : {}),
      ...eventText('ARRIVED_AT_DROPOFF', { deliveryId: delivery.id, courierId: delivery.courierId, how: arrivalCode(detected) }),
    })

    // Read again after the event, so the rider's app can see whether the step moved the delivery
    // (an event with no legal transition is dropped silently; spec 0009, AC-6).
    return this.deliveryRepository.findByIdOrThrow(deliveryId)
  }

  async markAsDelivered(deliveryId: string, deliveredData: any, tap?: ICourierTap) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    const occurredAt = tap ? await this.deliveryEventService.occurredAtForCourierTap(delivery, tap) : undefined

    // TODO
    // if (delivery.status !== EnumDeliveryStatus.PICKED_UP) {
    //   throw new CantUpdateDeliveryStatusError(
    //     `Delivery ${deliveryId} can not be marked as delivered, it hasn't been picked up. On status ${delivery.status}`
    //   )
    // }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.DROPPED_OFF,
      actor: EnumEventActor.COURIER,
      courierId: delivery.courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      ...(occurredAt ? { occurredAt } : {}),
      ...eventText('MARKED_DELIVERED', { deliveryId: delivery.id, courierId: delivery.courierId }),
      deliveredData,
    })

    // Read again after the event, so the rider's app can see whether the step moved the delivery
    // (an event with no legal transition is dropped silently; spec 0009, AC-6).
    return this.deliveryRepository.findByIdOrThrow(deliveryId)
  }

  async markAsDispatched(deliveryId: string, tap?: ICourierTap) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    if (delivery.status !== EnumDeliveryStatus.ACCEPTED) {
      throw new CantUpdateDeliveryStatusError(
        `Delivery ${deliveryId} can not be marked as dispatched. On status ${delivery.status}`
      )
    }
    const occurredAt = tap ? await this.deliveryEventService.occurredAtForCourierTap(delivery, tap) : undefined

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.DISPATCHED,
      actor: EnumEventActor.COURIER,
      courierId: delivery.courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      ...(occurredAt ? { occurredAt } : {}),
      ...eventText('MARKED_DISPATCHED', { deliveryId: delivery.id, courierId: delivery.courierId }),
    })

    // Read again after the event, so the rider's app can see whether the step moved the delivery
    // (an event with no legal transition is dropped silently; spec 0009, AC-6).
    return this.deliveryRepository.findByIdOrThrow(deliveryId)
  }

  // `detected`: see courierArrivedAtDropOff.
  async courierArrivedAtPickup(deliveryId: string, tap?: ICourierTap, detected?: boolean) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    const occurredAt = tap ? await this.deliveryEventService.occurredAtForCourierTap(delivery, tap) : undefined

    // if (delivery.status !== EnumDeliveryStatus.DISPATCHED) {
    //   throw new CantUpdateDeliveryStatusError(`Delivery ${deliveryId} can not be marked as arrived at pickup location, delivery isn't on dispatched status. On status ${delivery.status}`)
    // }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
      actor: EnumEventActor.COURIER,
      courierId: delivery.courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      ...(occurredAt ? { occurredAt } : {}),
      ...eventText('ARRIVED_AT_PICKUP', { deliveryId: delivery.id, courierId: delivery.courierId, how: arrivalCode(detected) }),
    })

    // Read again after the event, so the rider's app can see whether the step moved the delivery
    // (an event with no legal transition is dropped silently; spec 0009, AC-6).
    return this.deliveryRepository.findByIdOrThrow(deliveryId)
  }

  async markAsPickedUp(deliveryId: string, tap?: ICourierTap) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    const occurredAt = tap ? await this.deliveryEventService.occurredAtForCourierTap(delivery, tap) : undefined

    // TODO
    // if (delivery.status !== EnumDeliveryStatus.DISPATCHED) {
    //   throw new CantUpdateDeliveryStatusError(
    //     `Delivery ${deliveryId} can not be marked as picked up, it hasn't been dispatched. On status ${delivery.status}`
    //   )
    // }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.PICKED_UP,
      actor: EnumEventActor.COURIER,
      courierId: delivery.courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      ...(occurredAt ? { occurredAt } : {}),
      ...eventText('MARKED_PICKED_UP', { deliveryId: delivery.id, courierId: delivery.courierId }),
    })

    return this.deliveryRepository.findByIdOrThrow(deliveryId)
  }

  async markAsOnTheWay(deliveryId: string) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    if (delivery.status !== EnumDeliveryStatus.PICKED_UP) {
      throw new CantUpdateDeliveryStatusError(
        `Delivery ${deliveryId} can not be marked as on the way, it hasn't been picked up. On status ${delivery.status}`
      )
    }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.ON_THE_WAY,
      actor: EnumEventActor.COURIER,
      courierId: delivery.courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      ...eventText('MARKED_ON_THE_WAY', { deliveryId: delivery.id, courierId: delivery.courierId }),
    })

    return delivery
  }

  async updateDeliveryStatus(deliveryId: string, status: EnumDeliveryStatus) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    const updatedDelivery = await this.deliveryRepository.update(delivery.id, {
      status,
    })

    return updatedDelivery
  }

  // Row 144: the co-op's skip time (offerSkipMinutes) in seconds, the unit the skip list's Redis key expires in.
  private async offerSkipSeconds(): Promise<number> {
    return (await this.configDomainService.instanceConfig.getOfferSkipMinutes()) * 60
  }

  // Review of row 144: the undo of a failed decline's own skip entry is cleanup, so it never throws. Without
  // this, a settings read or Redis failure here would replace the decline's real error (say, the database
  // being down). If it fails, the rider sits out this one delivery for the co-op's skip time.
  private async undoOwnSkipListEntry(deliveryId: string, courierId: string): Promise<void> {
    try {
      await this.removeCourierFromRejectedList(deliveryId, courierId)
    } catch (error) {
      this.logger.error(
        `Could not take courier ${courierId} back off the skip list of ${deliveryId}: ${errorSummaryForLog(error)}`
      )
    }
  }

  // Returns true only when this call is what put the courier on the list. The caller needs
  // that: an entry left over from an earlier genuine rejection is not ours to remove.
  // The list itself lives in src/services/cache/rejected-couriers.ts, shared with the offer expiry.
  async addCourierToRejectedList(deliveryId: string, courierId: string): Promise<boolean> {
    return addCourierToRejectedList(this.cacheService, deliveryId, courierId, await this.offerSkipSeconds())
  }

  // Mirror of addCourierToRejectedList: drops one courier from this delivery's exclusion list
  // and leaves everyone else on it. Only used to undo an entry this service added moments
  // earlier for a reassignment that then did not happen.
  async removeCourierFromRejectedList(deliveryId: string, courierId: string): Promise<void> {
    return removeCourierFromRejectedList(this.cacheService, deliveryId, courierId)
  }

  // `box`: spec 0043 (AC-6). The admin's confirm to put the new rider past a full box, and who they are.
  async reassignDelivery(
    deliveryId: string,
    newCourierId: string,
    payoutPolicy?: string,
    message?: string,
    box: { confirmOverCapacity?: boolean; admin?: AdminRef } = {}
  ) {
    // A heat or storm stop binds admins too (spec 0014, AC-4): restart dispatch first.
    await this.deliveryEventService.refuseIfDispatchStopped()
    // Never reassign to a rider in an active SOS (spec 0022, AC-7). The rider it is taken from may be
    // in one: that is an admin's call, and nothing about their job changes on its own.
    await this.deliveryEventService.refuseIfCourierDeactivated(newCourierId)
    await this.deliveryEventService.refuseIfCourierInSos(newCourierId)
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    if (!DELIVERY_ONGOING_STATUSES.includes(delivery.status)) {
      throw new CantUpdateDeliveryStatusError(
        `Delivery ${deliveryId} is in status ${delivery.status} and cannot be reassigned`
      )
    }

    const droppedCourierId = delivery.courierId
    if (!droppedCourierId) {
      throw new CantUpdateDeliveryStatusError(
        `Delivery ${deliveryId} has no assigned courier to reassign from`
      )
    }

    if (newCourierId === droppedCourierId) {
      throw new BadRequestException('Delivery is already assigned to this courier')
    }

    await this.courierRepository.findByIdOrThrow(newCourierId)

    // Spec 0046 (AC-4): never a second leg of one order to the same rider at once, whatever the box says.
    await this.deliveryEventService.refuseIfCourierHoldsSiblingLeg(newCourierId, deliveryId)
    // Spec 0048 (cross check 10): never a third delivery for one rider, confirm or not.
    await this.deliveryEventService.refuseIfCourierHoldsTwo(newCourierId, deliveryId)

    // Spec 0043 (AC-6, cross check 1): before the award is written, so a refused move leaves nothing.
    const overCapacityHeldUnits = await this.refuseBoxOverCapacityUnlessConfirmed(
      newCourierId,
      delivery.boxUnits,
      box.confirmOverCapacity
    )

    const menu = await this.configDomainService.instanceConfig.getReassignmentPayoutPolicies()
    const defaultPolicy = await this.configDomainService.instanceConfig.getReassignmentPayoutDefaultPolicy()

    const { policy, amount } = resolveReassignmentPayout(
      menu,
      defaultPolicy,
      payoutPolicy,
      delivery.totalCompensation
    )
    const currencyCode = delivery.currencyCode

    const awardMessage =
      `Admin reassigned delivery from courier ${droppedCourierId} to courier ${newCourierId}; ` +
      `payout policy ${policy} awards ${amount} ${currencyCode} (cents) to the dropped courier` +
      (message ? `: ${message}` : '')

    // Every failure path below logs these same five fields, so a lost award can be
    // recreated from the log alone.
    const logContext = { deliveryId, droppedCourierId, amount, currencyCode, policy }

    // The award is written before the event on purpose. If this write fails, nothing has
    // happened yet — the delivery is untouched and the admin can retry. Writing it after
    // the event is what made a failed award unrecoverable: once the status is
    // ASSIGNING_COURIER the state machine has no REASSIGNED transition back out.
    let compensationId: string
    try {
      const compensation = await this.courierCompensationRepository.create({
        amount,
        currencyCode,
        reason: EnumCourierCompensationReason.REASSIGNMENT,
        policy,
        message: awardMessage,
        courierId: droppedCourierId,
        deliveryId,
      })
      compensationId = compensation.id
    } catch (error) {
      this.logger.error(
        formatReassignmentAwardFailure({ ...logContext, compensationId: null, stage: 'AWARD_WRITE_FAILED' }),
        describeErrorForLog(error).stack
      )
      throw error
    }

    // True only if this call is what excluded the dropped courier — see addCourierToRejectedList.
    let droppedCourierWasExcludedByUs = false
    try {
      droppedCourierWasExcludedByUs = await this.addCourierToRejectedList(deliveryId, droppedCourierId)
    } catch (error) {
      // false: the rejected-list write is the thing that failed, so there is no entry of ours to undo.
      await this.rollbackReassignmentAward(compensationId, 'REASSIGNMENT_DID_NOT_TAKE_EFFECT', logContext, false)
      throw error
    }

    // Names this award, so a second reassign between the same two riders is never read as this one. In
    // English this is `${awardMessage} (award ${compensationId})`, word for word (spec 0054).
    const reassignedText = message
      ? eventText('REASSIGNED_WITH_NOTE', {
          droppedCourierId,
          newCourierId,
          policy,
          amount,
          currency: currencyCode,
          note: message,
          awardId: compensationId,
        })
      : eventText('REASSIGNED', { droppedCourierId, newCourierId, policy, amount, currency: currencyCode, awardId: compensationId })
    const eventMessage = reassignedText.message
    const reassignedEvent: DeliveryReassignedEvent = {
      deliveryId,
      type: EnumDeliveryEventType.REASSIGNED,
      actor: EnumEventActor.ADMIN,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId: newCourierId,
      // Spec 0035 (AC-20): the rider it is taken from, so a wait is paid to whoever actually waited.
      droppedCourierId,
      // Spec 0044 (AC-6): named in the new offer's reason.
      adminUserId: box.admin?.id ?? null,
      ...reassignedText,
    }

    let reloadedDelivery
    try {
      await this.deliveryEventService.processDeliveryEvent(reassignedEvent)
      reloadedDelivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    } catch (error) {
      // We cannot tell whether the reassignment landed, so keep the award (binding value 4:
      // protect courier income) and log loudly enough for a human to settle it.
      //
      // Known tradeoff, recorded so it stays a decision and not an accident: this is the ONE
      // failure path that is not idempotent. CourierCompensation has no unique constraint on
      // (courierId, deliveryId, reason) and the earnings query sums every row, so an admin who
      // retries after this error can end up with two REASSIGNMENT rows for the same drop. We
      // accept the risk of paying a courier twice over the risk of not paying them at all; the
      // REASSIGNMENT_OUTCOME_UNKNOWN log line tells a human which delivery to check.
      this.logger.error(
        formatReassignmentAwardFailure({ ...logContext, compensationId, stage: 'REASSIGNMENT_OUTCOME_UNKNOWN' }),
        describeErrorForLog(error).stack
      )
      throw error
    }

    // Spec 0035 (AC-23): the award stands only if this very REASSIGNED row was saved as successful.
    // Read from the trail, not the reloaded delivery, which an accept or a later reassign can change
    // in the moment between the two, undoing an award that was really earned.
    let tookEffect: boolean
    try {
      tookEffect = await this.deliveryEventService.hasSuccessfulReassignedWithMessage(deliveryId, eventMessage)
    } catch (error) {
      // Could not tell: keep the award (binding value 4), and log it the way the failure above does.
      this.logger.error(
        formatReassignmentAwardFailure({ ...logContext, compensationId, stage: 'REASSIGNMENT_OUTCOME_UNKNOWN' }),
        describeErrorForLog(error).stack
      )
      throw error
    }

    // No row, but the rider is off the delivery: the move was written and its event row was lost. The
    // rider really lost the order, so the award stands (binding value 4), for a human to check.
    if (!tookEffect && reloadedDelivery.courierId !== droppedCourierId) {
      this.logger.error(
        formatReassignmentAwardFailure({ ...logContext, compensationId, stage: 'REASSIGNMENT_OUTCOME_UNKNOWN' })
      )
      if (overCapacityHeldUnits !== null) {
        await this.recordBoxOverCapacityConfirmed(
          deliveryId,
          newCourierId,
          overCapacityHeldUnits,
          delivery.boxUnits,
          box.admin
        )
      }
      return reloadedDelivery
    }

    if (!tookEffect) {
      // The event was silently dropped (no legal transition) or the pipeline swallowed an
      // error. The dropped courier still has the delivery, so the award must not stand.
      await this.rollbackReassignmentAward(
        compensationId,
        'REASSIGNMENT_DID_NOT_TAKE_EFFECT',
        logContext,
        droppedCourierWasExcludedByUs
      )

      throw new CantUpdateDeliveryStatusError(
        `Reassignment of delivery ${deliveryId} did not take effect; the compensation award was rolled back`
      )
    }

    if (overCapacityHeldUnits !== null) {
      await this.recordBoxOverCapacityConfirmed(
        deliveryId,
        newCourierId,
        overCapacityHeldUnits,
        delivery.boxUnits,
        box.admin
      )
    }
    return reloadedDelivery
  }

  // Spec 0043 (AC-6): null when the order fits in the rider's box. Past a full box, a 409 with the
  // rider's held units and the order's units, unless the admin confirmed; then the held units, so the
  // caller records the override once its write has succeeded. A read before the write, like
  // refuseIfCourierInSos: an admin's assignment takes no lock on the rider (decision 9.4).
  private async refuseBoxOverCapacityUnlessConfirmed(
    courierId: string,
    deliveryUnits: number,
    confirmOverCapacity: boolean | undefined
  ): Promise<number | null> {
    const heldUnits = await this.courierRepository.heldBoxUnits(courierId)
    if (!wouldOverfillBox(heldUnits, deliveryUnits)) return null
    if (confirmOverCapacity !== true) throw new BoxOverCapacityException(heldUnits, deliveryUnits)
    return heldUnits
  }

  // Spec 0043 (AC-6, cross check 1): the admin's confirmed override, on the record with their name,
  // written after the assignment itself succeeded. No status change; the status is read again.
  private async recordBoxOverCapacityConfirmed(
    deliveryId: string,
    courierId: string,
    heldUnits: number,
    deliveryUnits: number,
    admin: AdminRef | undefined
  ): Promise<void> {
    const current = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    const units = { deliveryUnits, heldUnits, boxUnits: RIDER_BOX_UNITS, totalUnits: heldUnits + deliveryUnits }
    const overEvent: DeliveryBoxOverCapacityConfirmedEvent = {
      deliveryId,
      type: EnumDeliveryEventType.BOX_OVER_CAPACITY_CONFIRMED,
      actor: EnumEventActor.ADMIN,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId,
      ...(admin
        ? eventText('BOX_OVER_CAPACITY_CONFIRMED', { admin: adminLabel(admin), ...units })
        : eventText('BOX_OVER_CAPACITY_CONFIRMED_UNNAMED', units)),
    }
    await this.deliveryEventService.recordBoxEvent(overEvent, current.status)
  }

  // Unwinds a reassignment attempt that did not happen: removes the award row, and — when we
  // are the ones who added it — takes the dropped courier back off this delivery's rejected
  // list, since they never actually lost the delivery.
  // Deliberately never throws: the caller's own error is the one the admin should see, and a
  // failed cleanup must not hide it. Each failed cleanup is logged under its own stage so the
  // leftover is findable.
  // Omit constructs a type with all properties of ReassignmentAwardLogContext except
  // compensationId and stage.
  private async rollbackReassignmentAward(
    compensationId: string,
    stage: ReassignmentFailureStage,
    logContext: Omit<ReassignmentAwardLogContext, 'compensationId' | 'stage'>,
    undoRejectedListEntry: boolean
  ): Promise<void> {
    this.logger.error(formatReassignmentAwardFailure({ ...logContext, compensationId, stage }))

    try {
      await this.courierCompensationRepository.deleteById(compensationId)
    } catch (deleteError) {
      this.logger.error(
        formatReassignmentAwardFailure({ ...logContext, compensationId, stage: 'AWARD_ROLLBACK_FAILED' }),
        describeErrorForLog(deleteError).stack
      )
    }

    if (!undoRejectedListEntry) return

    try {
      await this.removeCourierFromRejectedList(logContext.deliveryId, logContext.droppedCourierId)
    } catch (cacheError) {
      this.logger.error(
        formatReassignmentAwardFailure({
          ...logContext,
          compensationId,
          stage: 'REJECTED_LIST_ROLLBACK_FAILED',
        }),
        describeErrorForLog(cacheError).stack
      )
    }
  }

  // `admin`: who submitted it, named on a box over capacity record (spec 0043, AC-6).
  async submitDeliveryEvent(event: ISubmitDeliveryEvent, message?: string, admin?: AdminRef) {
    const actor = EnumEventActor.ADMIN
    // Spec 0054 (cross check 5): an admin's own words go on the record untranslated, as a note.
    const adminNote = message ? eventText('ADMIN_NOTE', { note: message }) : {}

    // Who cancelled belongs only to a cancellation (spec 0015): anywhere else it is a mistake.
    if (event.cancelledBy !== undefined && event.eventType !== EnumDeliveryEventType.CANCELED) {
      throw new BadRequestException('cancelledBy can only be sent with eventType CANCELED')
    }

    switch (event.eventType) {
      case EnumDeliveryEventType.REASSIGNED:
        throw new BadRequestException('Use POST /api/admin/v1/deliveries/:id/reassign to reassign a delivery')
      case EnumDeliveryEventType.CONFIRMED:
        const confirmedEvent: DeliveryConfirmedEvent = {
          deliveryId: event.deliveryId,
          type: EnumDeliveryEventType.CONFIRMED,
          actor,
          source: EnumDeliveryEventSource.OPENCOURIER,
          ...adminNote,
        }
        await this.deliveryEventService.processDeliveryEvent(confirmedEvent)
        break
      case EnumDeliveryEventType.ACCEPTED: {
        if (!event.courierId) {
          throw new BadRequestException('courierId is required when submitting ACCEPTED to assign a courier')
        }
        // An admin gives nothing to a rider in an active SOS (spec 0022, AC-7), whether it is a new
        // hand offer or accepting the offer already out to them on their behalf.
        await this.deliveryEventService.refuseIfCourierDeactivated(event.courierId)
        await this.deliveryEventService.refuseIfCourierInSos(event.courierId)
        const delivery = await this.getByIdOrThrow(event.deliveryId)
        if (
          delivery.status === EnumDeliveryStatus.ASSIGNING_COURIER &&
          delivery.matchedCourierId === event.courierId
        ) {
          // Spec 0048 (decision 80.5): this order alone, even when it is one of a pair offered together.
          await this.acceptDelivery(event.deliveryId, event.courierId, false, true)
        } else {
          // Spec 0043 (AC-6, cross check 1): a hand offer that would put the rider past a full box
          // answers 409 with the numbers, unless the admin confirmed it. Accepting the offer already
          // out to the rider (above) adds nothing to their box: an open offer is already counted.
          // The check before the write answers at once; the write itself checks again under a lock on
          // the rider (review fix), and its numbers are the ones recorded.
          // Spec 0046 (AC-4): a second leg of one order to the same rider is refused first, confirm or not.
          await this.deliveryEventService.refuseIfCourierHoldsSiblingLeg(event.courierId, event.deliveryId)
          // Spec 0048 (cross check 10): a third delivery is refused before the box question, since no confirm passes it.
          await this.deliveryEventService.refuseIfCourierHoldsTwo(event.courierId, event.deliveryId)
          await this.refuseBoxOverCapacityUnlessConfirmed(event.courierId, delivery.boxUnits, event.confirmOverCapacity)
          const atWrite = await this.deliveryEventService.offerDeliveryToCourierAsAdmin(
            event.deliveryId,
            event.courierId,
            message,
            event.confirmOverCapacity === true,
            admin?.id ?? null
          )
          if (wouldOverfillBox(atWrite.heldUnits, atWrite.deliveryUnits)) {
            await this.recordBoxOverCapacityConfirmed(
              event.deliveryId,
              event.courierId,
              atWrite.heldUnits,
              atWrite.deliveryUnits,
              admin
            )
          }
        }
        break
      }
      case EnumDeliveryEventType.DISPATCHED:
        const dispatchedEvent: DeliveryDispatchedEvent = {
          deliveryId: event.deliveryId,
          type: EnumDeliveryEventType.DISPATCHED,
          actor,
          ...adminNote,
          source: EnumDeliveryEventSource.OPENCOURIER,
        }
        await this.deliveryEventService.processDeliveryEvent(dispatchedEvent)
        break
      case EnumDeliveryEventType.REJECTED:
        const rejectedEvent: DeliveryRejectedEvent = {
          deliveryId: event.deliveryId,
          type: EnumDeliveryEventType.REJECTED,
          actor,
          source: EnumDeliveryEventSource.OPENCOURIER,
          ...adminNote,
        }
        await this.deliveryEventService.processDeliveryEvent(rejectedEvent)
        break
      case EnumDeliveryEventType.PICKED_UP:
        const pickedUpEvent: DeliveryPickedUpEvent = {
          deliveryId: event.deliveryId,
          type: EnumDeliveryEventType.PICKED_UP,
          actor,
          ...adminNote,
          source: EnumDeliveryEventSource.OPENCOURIER,
        }
        await this.deliveryEventService.processDeliveryEvent(pickedUpEvent)
        break
      case EnumDeliveryEventType.CANCELED:
        const canceledEvent: DeliveryCanceledEvent = {
          deliveryId: event.deliveryId,
          type: EnumDeliveryEventType.CANCELED,
          actor,
          source: EnumDeliveryEventSource.OPENCOURIER,
          // An admin acting on the co-op's own decision unless they say the restaurant or customer asked.
          cancelledBy: event.cancelledBy ?? EnumCancelledBy.COOP,
          ...eventText('CANCELED_BY_ADMIN', { cancelledBy: event.cancelledBy ?? EnumCancelledBy.COOP }),
        }
        await this.deliveryEventService.processDeliveryEvent(canceledEvent)
        break
      case EnumDeliveryEventType.DROPPED_OFF:
        const droppedOffEvent: DeliveryDroppedOffEvent = {
          deliveryId: event.deliveryId,
          type: EnumDeliveryEventType.DROPPED_OFF,
          actor,
          source: EnumDeliveryEventSource.OPENCOURIER,
          ...adminNote,
          deliveredData: {},
        }
        await this.deliveryEventService.processDeliveryEvent(droppedOffEvent)
        break
      case EnumDeliveryEventType.FAILED:
        const failedEvent: DeliveryFailedEvent = {
          deliveryId: event.deliveryId,
          type: EnumDeliveryEventType.FAILED,
          actor,
          source: EnumDeliveryEventSource.OPENCOURIER,
          ...adminNote,
        }
        await this.deliveryEventService.processDeliveryEvent(failedEvent)
        break
      default:
        this.logger.log('Unknown status')
        break
    }

    return this.getByIdOrThrow(event.deliveryId)
  }
}
