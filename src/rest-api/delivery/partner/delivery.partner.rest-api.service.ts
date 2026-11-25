import {
  PARTNER_EDIT_SENTENCES,
  partnerEditRefusal,
  riderVisibleEdits,
  tipAfterPartnerEdit,
} from 'src/domains/delivery/partner-edit'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common'
import { eventText } from 'src/domains/delivery-event/event-text'
import {
  LEG_LABELS_LOCKED_SENTENCE,
  LEG_REFERENCE_REQUIRED_SENTENCE,
  legLabelsProblem,
  legTakenSentence,
  siblingConflictSentence,
} from 'src/domains/delivery/legs'
import { isUniqueConstraintError } from 'src/prisma.util'
import { ProductReportDomainService, ProductReportInput } from 'src/domains/product-report/product-report.domain.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { partnerAvailabilitySentence } from 'src/domains/partner/partner-availability'
import { refusalBody } from 'src/localization/coded-sentence'
import {
  EnumProductReportSource,
  EnumCancelledBy,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'
import { haversineDistanceInMetres } from 'src/core/utils/distance'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { partnerHistoryWhere, refuseIfNotVisibleToPartner } from './partner-history'
import { DispatchStopRepository } from 'src/persistence/repositories/dispatch-stop.repository'
import { stoppedSentence } from 'src/domains/dispatch-stop/dispatch-stop-time'
import { DeliveryQuoteDomainService } from 'src/domains/delivery-quote/delivery-quote.domain.service'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import {
  DeliveryForQuoteAlreadyExistsException,
  DeliveryLocationDoesntMatchQuoteException,
  DeliveryNotFoundException,
  NotFoundException,
  QuoteHasExpiredException,
} from 'src/errors'
import { DeliveryCreatePartnerInput } from './queries/delivery-create.partner.input'
import { LocationDomainService } from 'src/domains/location/location.domain.service'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { describeError } from 'src/utils/errorForLog'
import { EnumDeliverableAction, EnumUndeliverableAction } from '@prisma/types'
import { JsonValue } from 'src/shared-types/index'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { DeliveryUpdatePartnerInput } from './queries/delivery-update.partner.input'
import { QuoteToDeliveryConversionService } from 'src/services/quote-to-delivery-conversion/quote-to-delivery-conversion.service'

// An optional text a restaurant sends (spec 0016's floor and doorbell): trimmed, and empty stored as none.
function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

// Row 166: the Location row an edit's point move made, kept across its tries. `id` is null until a try makes one;
// `copiedFrom` is the drop off row whose address it copied; `used` turns true when a write pointing the delivery at
// it lands.
type MadePoint = { id: string | null; copiedFrom: string | null; used: boolean }

// Row 161: how many times an edit is tried when the order changes between its read and its write. A second try
// covers a rider's accept landing mid edit; a third loss in a row means the order is changing too fast to edit.
const PARTNER_EDIT_ATTEMPTS = 3

@Injectable()
export class DeliveryPartnerRestApiService {
  private readonly logger = new Logger(DeliveryPartnerRestApiService.name)
  constructor(
    private deliveryQuoteDomainService: DeliveryQuoteDomainService,
    private deliveryDomainService: DeliveryDomainService,
    private partnerDomainService: PartnerDomainService,
    private locationDomainService: LocationDomainService,
    private courierDomainService: CourierDomainService,
    private quoteToDeliveryConversionService: QuoteToDeliveryConversionService,
    private dispatchStopRepository: DispatchStopRepository,
    private configDomainService: ConfigDomainService,
    private deliveryEventService: DeliveryEventService,
    private productReportDomainService: ProductReportDomainService
  ) {}

  // Spec 0017: the restaurant's deliveries within the co-op's period, or still open, and the period
  // itself, which the page shows ("your orders from the last 30 days").
  async getManyByPartnerId(partnerId: string, page?: number, perPage?: number) {
    const historyDays = await this.configDomainService.instanceConfig.getRestaurantHistoryDays()
    const deliveries = await this.deliveryDomainService.getMany(
      partnerHistoryWhere(partnerId, historyDays, new Date()),
      page,
      perPage
    )

    return { ...deliveries, historyDays }
  }

  // Spec 0017 (AC-3): every route that takes a delivery id. Ownership first, so another restaurant's
  // delivery is a plain 404 and the period sentence never reveals it; then the period. The rule itself is
  // refuseIfNotVisibleToPartner (partner-history.ts), shared with the complaint filing (spec 0052).
  private async assertVisibleToPartner(
    delivery: { partnerId: string | null; createdAt: Date; status: EnumDeliveryStatus } | null,
    partnerId: string
  ): Promise<void> {
    if (!delivery || delivery.partnerId !== partnerId) {
      throw new DeliveryNotFoundException('Delivery not found')
    }
    const historyDays = await this.configDomainService.instanceConfig.getRestaurantHistoryDays()
    refuseIfNotVisibleToPartner(delivery, partnerId, historyDays, new Date())
  }

  async getByIdWithRelations(deliveryId: string, partnerId: string) {
    const delivery = await this.deliveryDomainService.getById(deliveryId)
    await this.assertVisibleToPartner(delivery, partnerId)
    if (!delivery) {
      throw new DeliveryNotFoundException('Delivery not found')
    }

    const locations = await this.locationDomainService.getByIds([delivery.pickupLocationId, delivery.dropoffLocationId])

    const pickupLocation = locations.find((location) => location.id === delivery.pickupLocationId)
    const dropoffLocation = locations.find((location) => location.id === delivery.dropoffLocationId)

    const courierWithSettings = delivery.courierId
      ? await this.courierDomainService.getByIdWithSettings(delivery.courierId)
      : null

    return {
      delivery,
      courierWithSettings,
      pickupLocation,
      dropoffLocation,
    }
  }

  // Spec 0046 (AC-3, AC-6, cross check 4): the legs of the order this delivery is a leg of, each with its
  // locations (a Retry rebuilds a missing leg from them), and the leg numbers never sent. The delivery itself
  // goes through the usual visibility check; its siblings share its restaurant by definition. A single
  // delivery has no legs.
  async getOrderLegsWithRelations(deliveryId: string, partnerId: string) {
    const own = await this.getByIdWithRelations(deliveryId, partnerId)
    const { legs, missingLegNumbers } = await this.deliveryDomainService.getOrderLegs(own.delivery)
    const withRelations = await Promise.all(
      legs.map((leg) => (leg.id === deliveryId ? own : this.getByIdWithRelations(leg.id, partnerId)))
    )
    return { legs: withRelations, missingLegNumbers }
  }

  async create(partnerId: string, input: DeliveryCreatePartnerInput) {
    const partner = await this.partnerDomainService.getById(partnerId)

    if (!partner) {
      throw new NotFoundException('Partner not found')
    }

    // Spec 0029, AC-4: a paused or disabled restaurant places no order, whatever the dispatch stop says.
    const now = new Date()
    const refusal = partnerAvailabilitySentence(partner, now)
    if (refusal) throw new ConflictException(refusalBody(HttpStatus.CONFLICT, refusal))

    // Spec 0014, AC-6: refused before anything is created, so a quote taken before a stop cannot
    // place an order during it.
    const stop = await this.dispatchStopRepository.findOn(now)
    if (stop) {
      throw new ServiceUnavailableException(
        refusalBody(HttpStatus.SERVICE_UNAVAILABLE, stoppedSentence('RESTAURANT', stop, now))
      )
    }

    // Spec 0046 (AC-1, key invariants): the leg labels, checked before anything is read or created. One
    // without the other or out of range is 400; a leg that disagrees with the legs already sent is 409.
    const legProblem = legLabelsProblem(input)
    if (legProblem) throw new BadRequestException(legProblem)
    const leg = input.legNumber != null && input.legCount != null ? { legNumber: input.legNumber, legCount: input.legCount } : null
    if (leg && !input.orderReference.trim()) {
      // Row 10 review: the reference is what ties the legs together; an empty one would tie nothing.
      throw new BadRequestException(LEG_REFERENCE_REQUIRED_SENTENCE)
    }
    if (leg) {
      const siblings = await this.deliveryDomainService.getOrderLegsOf(partnerId, input.orderReference)
      const conflict = siblingConflictSentence(leg, siblings)
      if (conflict) throw new ConflictException(refusalBody(HttpStatus.CONFLICT, conflict))
    }

    const deliveryQuote = await this.deliveryQuoteDomainService.getByIdOrThrow(input.quoteId)
    // check if the quote has expired
    if (!deliveryQuote.expiresAt || deliveryQuote.expiresAt < new Date()) {
      throw new QuoteHasExpiredException('Delivery quote has expired')
    }

    const deliveryForQuote = await this.deliveryDomainService.getByDeliveryQuoteId(input.quoteId)
    if (deliveryForQuote) {
      throw new DeliveryForQuoteAlreadyExistsException('Delivery for quote already exists')
    }

    const deliveryQuoteLocations = await this.locationDomainService.getByIds([
      deliveryQuote.pickupLocationId,
      deliveryQuote.dropoffLocationId,
    ])
    const quotePickupLocation = deliveryQuoteLocations.find(
      (location) => location.id === deliveryQuote.pickupLocationId
    )
    const quoteDropoffLocation = deliveryQuoteLocations.find(
      (location) => location.id === deliveryQuote.dropoffLocationId
    )
    if (!quotePickupLocation || !quoteDropoffLocation) {
      throw new NotFoundException('Delivery quote locations not found')
    }

    const isValidPickupLocationDrift = await this.quoteToDeliveryConversionService.isValidDeliveryLocationDrift({
      fromLocation: {
        latitude: quotePickupLocation.latitude,
        longitude: quotePickupLocation.longitude,
      },
      toLocation: {
        latitude: input.pickupLatitude,
        longitude: input.pickupLongitude,
      },
    })
    if (!isValidPickupLocationDrift) {
      throw new DeliveryLocationDoesntMatchQuoteException("Delivery pickup location doesn't match quote location")
    }

    const isValidDropoffLocationDrift = await this.quoteToDeliveryConversionService.isValidDeliveryLocationDrift({
      fromLocation: {
        latitude: quoteDropoffLocation.latitude,
        longitude: quoteDropoffLocation.longitude,
      },
      toLocation: {
        latitude: input.dropoffLatitude,
        longitude: input.dropoffLongitude,
      },
    })
    if (!isValidDropoffLocationDrift) {
      throw new DeliveryLocationDoesntMatchQuoteException("Delivery dropoff location doesn't match quote location")
    }

    const pickupLocation = await this.locationDomainService.findOrCreate({
      ...input.pickupAddress,
      latitude: input.pickupLatitude,
      longitude: input.pickupLongitude,
    })
    const dropoffLocation = await this.locationDomainService.findOrCreate({
      ...input.dropoffAddress,
      latitude: input.dropoffLatitude,
      longitude: input.dropoffLongitude,
    })

    const delivery = await this.createUnlessLegTaken(leg, {
      pickupName: input.pickupName,
      pickupLocationId: pickupLocation.id,
      pickupPhoneNumber: input.pickupPhoneNumber,
      pickupBusinessName: input.pickupBusinessName,
      pickupNotes: input.pickupNotes,
      pickupVerification: input.pickupVerification as any as JsonValue,
      pickupReadyAt: input.pickupReadyAt,
      pickupDeadlineAt: input.pickupDeadlineAt,

      dropoffName: input.dropoffName,
      dropoffLocationId: dropoffLocation.id,
      dropoffPhoneNumber: input.dropoffPhoneNumber,
      dropoffBusinessName: input.dropoffBusinessName,
      dropoffNotes: input.dropoffNotes,
      dropoffReadyAt: input.dropoffReadyAt,
      dropoffEta: deliveryQuote.dropoffEta,
      dropoffDeadlineAt: input.dropoffDeadlineAt,
      dropoffSellerNotes: input.dropoffSellerNotes,
      dropoffFloor: optionalText(input.dropoffFloor),
      dropoffDoorbell: optionalText(input.dropoffDoorbell),
      dropoffVerification: input.dropoffVerification as any as JsonValue,

      deliverableAction: input.deliverableAction as EnumDeliverableAction,
      undeliverableAction: input.undeliverableAction as EnumUndeliverableAction,

      orderItems: input.orderItems as any as JsonValue,
      orderReference: input.orderReference,
      orderTotalValue: input.orderTotalValue,

      requiresDropoffSignature: input.requiresDropoffSignature,
      requiresId: input.requiresId,

      currencyCode: deliveryQuote.currency,
      idempotencyKey: input.idempotencyKey,

      externalStoreId: input.externalStoreId,
      returnVerification: input.returnVerification as any as JsonValue,
      externalId: input.externalId,

      totalCost: deliveryQuote.quote,

      tips: input.tip,

      partnerId: partnerId,
      deliveryQuoteId: deliveryQuote.id,

      // Spec 0043 (AC-3): the restaurant's size, or none (create then uses the default, marked assumed).
      boxSize: input.boxSize ?? null,

      // Spec 0046 (AC-1): "leg 1 of 2", or both null for a single delivery.
      legNumber: leg?.legNumber ?? null,
      legCount: leg?.legCount ?? null,
    })

    return delivery
  }

  // Spec 0046 (cross check 1): two creates of the same leg racing past the sibling check both reach the
  // insert; the unique index on (partnerId, orderReference, legNumber) lets one through and the other
  // gets this 409, not the generic unique constraint answer. Any other error goes on unchanged.
  private async createUnlessLegTaken(
    leg: { legNumber: number; legCount: number } | null,
    data: Parameters<DeliveryDomainService['create']>[0]
  ) {
    try {
      return await this.deliveryDomainService.create(data)
    } catch (error) {
      const target = (error as { meta?: { target?: unknown } }).meta?.target
      const onLegIndex = Array.isArray(target) ? target.includes('legNumber') : String(target ?? '').includes('legNumber')
      if (leg && error instanceof Error && isUniqueConstraintError(error) && onLegIndex) {
        throw new ConflictException(refusalBody(HttpStatus.CONFLICT, legTakenSentence(leg.legNumber, leg.legCount)))
      }
      throw error
    }
  }

  // Row 161: the edit decides from what it read: the status (row 152's refusals and the tip rule), the tip (row
  // 160's event) and the drop off point (the move and its event), plus, with a new size, that no rider is offered or
  // holding it and the size (row 167). It then writes only if all of those are still what it read. If another write landed in between (a rider's accept, a second edit of the same order), the
  // delivery's fields, its size among them (row 167), are not written; the edit reads the order again and decides
  // again. So the answer is the one for the order as it is now: row 152's refusal for the new status, or the edit
  // with a held order's tip kept.
  async update(deliveryId: string, partnerId: string, input: DeliveryUpdatePartnerInput) {
    // Row 166: a point move makes one Location row for the whole edit, reused by every try, and removed at the end
    // unless a landed write points the delivery at it. So a lost race leaves no address row pointing at nothing.
    const madePoint: MadePoint = { id: null, copiedFrom: null, used: false }
    try {
      for (let attempt = 1; attempt <= PARTNER_EDIT_ATTEMPTS; attempt++) {
        const delivery = await this.deliveryDomainService.getByIdOrThrow(deliveryId)
        await this.assertVisibleToPartner(delivery, partnerId)
        const updated = await this.tryPartnerEdit(delivery, input, madePoint)
        if (updated) return updated
      }
      // The order changed under the edit every time. Stop and ask the restaurant to look again, rather than loop.
      throw new ConflictException(PARTNER_EDIT_SENTENCES.changed)
    } finally {
      // `finally` runs on every way out: the saved delivery returned, a refusal thrown, or any other error.
      if (madePoint.id && !madePoint.used) await this.removeUnusedPoint(madePoint.id)
    }
  }

  // Row 166: removing the unused row is tidying, so its failure is logged and never changes the restaurant's answer.
  // A row something else came to use in the meantime (a quote for the same address and pin) is left, and logged.
  private async removeUnusedPoint(locationId: string) {
    try {
      const removed = await this.locationDomainService.deleteIfUnused(locationId)
      if (!removed) this.logger.log(`Drop off point ${locationId} is in use by another record, so it stays`)
    } catch (error) {
      this.logger.warn(`Could not remove the unused drop off point ${locationId}: ${describeError(error)}`)
    }
  }

  // One try of the restaurant's edit, decided from `delivery` as read. Answers the delivery as saved, or null
  // when the order changed before the write (then its fields and events are not written; see `update`).
  private async tryPartnerEdit(delivery: DeliveryEntity, input: DeliveryUpdatePartnerInput, madePoint: MadePoint) {
    // Row 152: an ended order is never changed. First, so a refusal leaves nothing behind in this try.
    const endedRefusal = partnerEditRefusal(delivery, false)
    if (endedRefusal) throw new ConflictException(endedRefusal)

    // Spec 0046 (cross check 2): the reference that ties a leg to its order cannot change on a leg. First,
    // so a refusal leaves nothing behind in this try (row 10 review: a moved point had already made its Location row).
    if (delivery.legCount != null && input.orderReference !== delivery.orderReference) {
      throw new ConflictException(LEG_LABELS_LOCKED_SENTENCE)
    }

    const dropoffLocation = await this.locationDomainService.getById(delivery.dropoffLocationId)
    if (!dropoffLocation) {
      throw new NotFoundException('Delivery locations not found')
    }

    // Row 102 (agy review): how far a restaurant may move the point is measured from the point the fee
    // was worked out on, the quote's, and only when the point really moves. Measured from the last
    // edit instead, many small moves would walk the door far from what the rider is paid for.
    const pointMoved =
      dropoffLocation.latitude !== input.dropoffLatitude || dropoffLocation.longitude !== input.dropoffLongitude
    // Row 152: once a rider holds the order its drop off point stays where they accepted it. Before any
    // write, like the checks above.
    const heldRefusal = partnerEditRefusal(delivery, pointMoved)
    if (heldRefusal) throw new ConflictException(heldRefusal)
    if (pointMoved) {
      const quote = await this.deliveryQuoteDomainService.getByIdOrThrow(delivery.deliveryQuoteId)
      const quotedDropoff = await this.locationDomainService.getById(quote.dropoffLocationId)
      if (!quotedDropoff) {
        throw new NotFoundException('Delivery locations not found')
      }
      const isValidDropoffLocationDrift = await this.quoteToDeliveryConversionService.isValidDeliveryLocationDrift({
        fromLocation: {
          latitude: quotedDropoff.latitude,
          longitude: quotedDropoff.longitude,
        },
        toLocation: {
          latitude: input.dropoffLatitude,
          longitude: input.dropoffLongitude,
        },
      })
      if (!isValidDropoffLocationDrift) {
        throw new DeliveryLocationDoesntMatchQuoteException("Delivery dropoff location doesn't match quote location")
      }
    }

    // Spec 0043 (AC-3, cross check 4) and row 167: a new size is decided here, after the update's own checks and
    // before anything is made, so a refused size leaves nothing behind in this try. It is not written here: its
    // fields join the one conditional write below, so the size lands with the edit or not at all. The same size, or
    // none, changes nothing; a JSON null is read as none (review fix: it reached Prisma and answered 500).
    const sizeChange =
      input.boxSize != null && input.boxSize !== delivery.boxSize
        ? await this.deliveryDomainService.boxSizeChangeFor(delivery, input.boxSize)
        : null

    // Row 102: a Location row is shared (`findOrCreate` reuses one for the same address and point),
    // so moving it in place would move every other delivery and quote on it too. A moved point gets a
    // row of its own: the old address with the new coordinates. An unmoved point changes nothing.
    // Row 166: made once per edit. A later try reuses it while the order still has the drop off row it was copied
    // from: the input's point is the same in every try, so the row it would make is the same row. If that row was
    // replaced in between (another restaurant edit moved the point), the copy may be stale: remove it, make anew.
    if (pointMoved && madePoint.id && madePoint.copiedFrom !== delivery.dropoffLocationId) {
      await this.removeUnusedPoint(madePoint.id)
      madePoint.id = null
    }
    if (pointMoved && !madePoint.id) {
      madePoint.copiedFrom = delivery.dropoffLocationId
      madePoint.id = (
        await this.locationDomainService.create({
          addressLine1: dropoffLocation.addressLine1,
          addressLine2: dropoffLocation.addressLine2,
          city: dropoffLocation.city,
          state: dropoffLocation.state,
          street: dropoffLocation.street,
          zipCode: dropoffLocation.zipCode,
          countryCode: dropoffLocation.countryCode,
          stateCode: dropoffLocation.stateCode,
          houseNumber: dropoffLocation.houseNumber,
          formattedAddress: dropoffLocation.formattedAddress,
          latitude: input.dropoffLatitude,
          longitude: input.dropoffLongitude,
        })
      ).id
    }
    const dropoffLocationId = pointMoved && madePoint.id ? madePoint.id : delivery.dropoffLocationId

    // Row 152 review: a held order's tip (rider pay) is not changed by an edit.
    const newTips = tipAfterPartnerEdit(delivery, delivery.tips, input.tipByCustomer)

    // Row 161: a conditional write on what the decisions above were made from. The database checks and writes in
    // one step, so an accept (or another edit) that lands after the read makes this write nothing. Status, tips and
    // point are non null columns; never put a value here that can be undefined, or Prisma drops that condition
    // silently.
    const written = await this.deliveryDomainService.updateIfMatches(
      delivery.id,
      // Row 167: with a new size, also still no rider offered or holding (`null` here is a real "is null" condition,
      // on purpose), and the size as read.
      {
        status: delivery.status,
        tips: delivery.tips,
        dropoffLocationId: delivery.dropoffLocationId,
        // Row 164 (Fable review, minor 1): the rider as read, so the notice below goes to the rider who holds the
        // order now; a reassignment in between makes this try lose and read again. `null` means "no rider" here.
        courierId: delivery.courierId,
        ...sizeChange?.where,
      },
      {
        ...sizeChange?.data,
        dropoffLocationId,
        // Spec 0053 (row 82 review): the newest move wins. A restaurant's move after a rider's clears the
        // rider's corrected point, so the notes and the route both follow the restaurant's new point.
        // `dropoffPointCorrectedAt` stays: it is spec 0016's "already moved once" mark, not a point.
        ...(pointMoved ? { dropoffCorrectedLatitude: null, dropoffCorrectedLongitude: null } : {}),
        pickupNotes: input.pickupNotes,
        pickupVerification: input.pickupVerification as any as JsonValue,
        pickupReadyAt: input.pickupReadyAt,
        pickupDeadlineAt: input.pickupDeadlineAt,

        dropoffNotes: input.dropoffNotes,
        dropoffReadyAt: input.dropoffReadyAt,
        dropoffDeadlineAt: input.dropoffDeadlineAt,
        dropoffVerification: input.dropoffVerification as any as JsonValue,

        orderReference: input.orderReference,

        tips: newTips,
      }
    )
    if (!written) return null
    // Row 166: the delivery now points at the row this edit made, so it stays.
    if (pointMoved) madePoint.used = true

    // Row 160 (value 1): the tip is rider pay, so a change is on the record, with both amounts. An edit that
    // leaves it as it was writes nothing. No status change, so never through processDeliveryEvent.
    if (newTips !== delivery.tips) {
      await this.deliveryEventService.recordTipChangedEvent(
        {
          deliveryId: delivery.id,
          type: EnumDeliveryEventType.TIP_CHANGED,
          actor: EnumEventActor.PARTNER,
          source: EnumDeliveryEventSource.PARTNER_APP,
          ...eventText('TIP_CHANGED_BY_RESTAURANT', {
            oldTip: delivery.tips,
            newTip: newTips,
            currency: delivery.currencyCode,
          }),
        },
        delivery.status
      )
    }

    // Row 167 (value 1): the size is capacity the matcher reads, so its change is on the record, once it has landed.
    if (sizeChange) {
      await this.deliveryDomainService.recordBoxSizeChanged(delivery, sizeChange)
    }

    // Row 102 (agy review, value 1): the point feeds the matcher and the rider's route, so a move is
    // on the record, like a rider's own. No status changes, so it never goes through
    // processDeliveryEvent. The fee stays on the quote and does not move with it.
    if (pointMoved) {
      const oldPoint = `${dropoffLocation.latitude.toFixed(5)}, ${dropoffLocation.longitude.toFixed(5)}`
      const newPoint = `${input.dropoffLatitude.toFixed(5)}, ${input.dropoffLongitude.toFixed(5)}`
      const metres = Math.round(
        haversineDistanceInMetres(
          dropoffLocation.latitude,
          dropoffLocation.longitude,
          input.dropoffLatitude,
          input.dropoffLongitude
        )
      )
      await this.deliveryEventService.recordDropoffPointCorrectedEvent(
        {
          deliveryId: delivery.id,
          type: EnumDeliveryEventType.DROPOFF_POINT_CORRECTED,
          actor: EnumEventActor.PARTNER,
          source: EnumDeliveryEventSource.PARTNER_APP,
          ...eventText('DROPOFF_MOVED_BY_RESTAURANT', { metres, from: oldPoint, to: newPoint }),
        },
        delivery.status
      )
    }

    // Row 164: a rider holding the order is told at once that its notes or times changed. Decided from the order as
    // read, which the landed write proved is still how it was; nothing is sent before a rider holds it.
    await this.deliveryEventService.notifyJobEdited(delivery, riderVisibleEdits(delivery, input))

    // A conditional write answers a count, not the row, so the saved delivery is read back.
    return this.deliveryDomainService.getByIdOrThrow(delivery.id)
  }

  // Spec 0032, AC-3: the restaurant's report, once the order is delivered.
  async reportProduct(deliveryId: string, partner: PartnerEntity, input: ProductReportInput) {
    const delivery = await this.deliveryDomainService.getById(deliveryId)
    await this.assertVisibleToPartner(delivery, partner.id)
    if (!delivery) {
      throw new DeliveryNotFoundException('Delivery not found')
    }
    this.productReportDomainService.refuseUnlessPartnerMayReport(delivery.status)
    if (!partner.userId) throw new ForbiddenException('This restaurant has no sign in.')
    return this.productReportDomainService.report(delivery, EnumProductReportSource.PARTNER, partner.userId, input)
  }

  // `?? RESTAURANT`, not a default parameter: a default applies to undefined only, never to null.
  async cancel(deliveryId: string, partnerId: string, cancelledBy?: EnumCancelledBy | null) {
    const delivery = await this.deliveryDomainService.getByIdOrThrow(deliveryId)
    await this.assertVisibleToPartner(delivery, partnerId)

    const updatedDelivery = await this.deliveryDomainService.cancelDelivery(
      deliveryId,
      cancelledBy ?? EnumCancelledBy.RESTAURANT
    )

    return updatedDelivery
  }

  // Spec 0023 (AC-3, AC-5): only the delivery's own restaurant, within its history period.
  async delayReady(deliveryId: string, partnerId: string, minutes: number, expectedReadyAt: Date | null) {
    const delivery = await this.deliveryDomainService.getByIdOrThrow(deliveryId)
    await this.assertVisibleToPartner(delivery, partnerId)
    return this.deliveryDomainService.delayReady(deliveryId, minutes, expectedReadyAt)
  }

  async markFoodReady(deliveryId: string, partnerId: string) {
    const delivery = await this.deliveryDomainService.getByIdOrThrow(deliveryId)
    await this.assertVisibleToPartner(delivery, partnerId)
    return this.deliveryDomainService.markFoodReady(deliveryId)
  }
}
