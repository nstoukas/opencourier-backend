import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { ConfigService } from '@nestjs/config'
import {
  EnumCourierStatus,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  Prisma,
} from '@prisma/types'
import {
  DeliveryConfirmedEvent,
  DeliveryEvent,
  DeliveryNoCourierAvailableEvent,
  DeliveryOfferedEvent,
  DeliveryOfferExpiredEvent,
  OfferEndedReason,
  STATE_MACHINE,
} from 'src/shared-types/index'
import { NEST_DELIVERY_EVENT_NAME } from './delivery-event.type'
import {
  CantUpdateDeliveryStatusError,
  DeliveryNotFoundException,
  DeliveryOfferAlreadyMatchedException,
  InconsistentDataError,
} from '../../errors'
import { OFFER_EXPIRY_GRACE_SECONDS, PICKUP_ORDER_FORCED_FULFILL_DELAY_MINUTES } from '../../constants'
import { isRecordNotFoundError } from '../../prisma.util'
import { WebsocketDispatcher } from '../websocket/models/WebsocketDispatcher'
import { TaskBusScheduler } from '../taskBus/models/TaskBusScheduler'
import { TaskBusService } from '../taskBus/taskBus.service'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { PartnerWebhookService } from '../partner-webhooks/partner-webhooks.service'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryMatchingService } from '../delivery-matching/delivery-matching.service'
import { DeliveryCalculationService } from '../delivery-calculation/delivery-calculation.service'
import { DeliveryCourierDto } from 'src/rest-api/delivery/courier/dtos/delivery.courier.dto'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { CacheService } from '../cache/cache.service'
import { addCourierToRejectedList } from '../cache/rejected-couriers'

interface ForcePickupFulfillmentPayload {
  deliveryId: string
}

// Spec 0002 jobs. They run on the existing BullMQ `messageBus` queue, so they survive a restart.
// The payload of an offer-expiry job names the exact offer it was made for, so a job left over
// from an offer that was answered, re-offered or cancelled finds nothing to end.
interface OfferExpiryJobPayload {
  deliveryId: string
  courierId: string
  offeredAt: string // ISO time; jobs are stored as JSON, which has no Date
}

interface NoCourierRetryJobPayload {
  deliveryId: string
}

// Job ids use '-', never ':' (BullMQ refuses ':' in custom ids).
const offerExpiryJobId = (deliveryId: string, offeredAt: Date) => `offer-expiry-${deliveryId}-${offeredAt.getTime()}`
const noCourierRetryJobIdPrefix = (deliveryId: string) => `no-courier-retry-${deliveryId}-`

// The only events that start a round of matching. OFFERED and NO_COURIER_AVAILABLE are recorded
// by this service itself inside the ASSIGNING_COURIER case, so recording them never matches again.
const MATCHING_TRIGGERS: EnumDeliveryEventType[] = [
  EnumDeliveryEventType.CREATED,
  EnumDeliveryEventType.REJECTED,
  EnumDeliveryEventType.OFFER_EXPIRED,
]

// What one try at offering a delivery came to. NOT_WAITING: someone else offered or took it first.
type OfferStepResult = 'OFFERED' | 'NO_COURIER' | 'NOT_WAITING'

@Injectable()
export class DeliveryEventService {
  private readonly logger = new Logger(DeliveryEventService.name)

  constructor(
    private readonly configService: ConfigService,
    // private readonly deliveryService: DeliveryService,
    private readonly websocketDispatcher: WebsocketDispatcher,
    private readonly courierRepository: CourierRepository,
    private readonly deliveryRepository: DeliveryRepository,
    // private readonly deliverySchedulerService: DeliverySchedulerService,
    private readonly deliveryEventRepository: DeliveryEventRepository,
    private readonly taskScheduler: TaskBusScheduler,
    private readonly taskBusService: TaskBusService,
    private readonly partnerWebhookService: PartnerWebhookService,
    private readonly deliveryMatchingService: DeliveryMatchingService,
    private readonly deliveryCalculationService: DeliveryCalculationService,
    private readonly bullMQService: BullMQService,
    private readonly configDomainService: ConfigDomainService,
    private readonly cacheService: CacheService
  ) {
    // When a delayed job comes due, BullMQProcessor hands it to the task bus by name, which calls
    // the handler registered here. Arrow functions keep `this` pointing at this service.
    this.taskBusService.registerTaskHandler<OfferExpiryJobPayload>('offer-expiry', (payload) =>
      this.handleOfferExpiryJob(payload)
    )
    this.taskBusService.registerTaskHandler<NoCourierRetryJobPayload>('no-courier-retry', (payload) =>
      this.handleNoCourierRetryJob(payload)
    )

    // this.taskBusService.registerTaskHandler(
    //   'schedule-force-pickup-fulfillment',
    //   (payload: ForcePickupFulfillmentPayload) => {
    //     return this.processForcePickupFulfillment(payload.deliveryId)
    //   }
    // )
  }

  async processDeliveryEvent(originalEvent: DeliveryEvent): Promise<void> {
    this.logger.log(`Processing order event: ${JSON.stringify(originalEvent)}`)
    const deliveryEvent = { ...originalEvent }
    const deliveryId = deliveryEvent.deliveryId

    let currentStatus: EnumDeliveryStatus | undefined
    let newStatus: EnumDeliveryStatus | undefined

    try {
      let dbDelivery: DeliveryEntity | null
      try {
        dbDelivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)
      } catch (error) {
        if (error instanceof Error && isRecordNotFoundError(error)) {
          throw new InconsistentDataError(`Delivery with ID ${deliveryId} does not exist`)
        }
        throw error
      }

      currentStatus = dbDelivery.status
      newStatus = STATE_MACHINE[currentStatus].on[deliveryEvent.type]

      if (!newStatus) {
        this.logger.warn(
          `No transition exists for delivery ${deliveryId} from status ${currentStatus} via event ${deliveryEvent.type}`
        )
        return
      }

      if (deliveryEvent.type === EnumDeliveryEventType.REASSIGNED) {
        const newCourierId = deliveryEvent.courierId
        if (!newCourierId) throw new NotFoundException('Courier ID is required for reassignment')
        const droppedCourierId = dbDelivery.courierId // capture BEFORE clearing
        const newCourier = await this.courierRepository.findByIdOrThrow(newCourierId)

        // Drop the old rider, offer to the new one. The new rider must still accept.
        // An admin's offer has no deadline (spec 0002, AC-3): offerExpiresAt stays null.
        await this.deliveryRepository.update(deliveryId, {
          courierId: null,
          matchedCourierId: newCourierId,
          offeredAt: new Date(),
          offerExpiresAt: null,
        })

        // Recompute amounts for the new matched courier (same as the ASSIGNING_COURIER case).
        const deliveryAmounts = await this.deliveryCalculationService.calculateDeliveryAmountsForMatchedCourier({
          deliveryId,
        })
        const { totalCost, totalCompensation, fee, feePercentage } = deliveryAmounts
        await this.updateDeliveryAmounts(deliveryId, totalCost, totalCompensation, fee, feePercentage)

        // Sets status via the state machine result, saves the DeliveryEvent, notifies partner.
        const updatedDelivery = await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus)

        // The delivery no longer carries the dropped rider's id, so notifyCourier inside
        // updateDeliveryAndSendNotifications did not reach them — tell them explicitly.
        if (droppedCourierId) {
          await this.notifyCourier(droppedCourierId, updatedDelivery, newStatus, currentStatus, deliveryEvent)
        }
        await this.saveOfferedEvent(deliveryId, newCourierId, EnumEventActor.ADMIN, null)
        await this.websocketDispatcher.sendOfferToCourier(newCourier.userId, new DeliveryCourierDto(updatedDelivery))
        return
      }

      switch (newStatus) {
        case EnumDeliveryStatus.CREATED: {
          this.logger.log(`Delivery ${deliveryEvent.deliveryId} was created by: ${deliveryEvent.actor}`)

          break
        }
        case EnumDeliveryStatus.ASSIGNING_COURIER: {
          if (!MATCHING_TRIGGERS.includes(deliveryEvent.type)) {
            // OFFERED and NO_COURIER_AVAILABLE are written by this service inside this case, never
            // processed as events. One arriving here would start matching from its own record.
            this.logger.warn(
              `${deliveryEvent.type} is recorded by DeliveryEventService itself, not processed; ignored for delivery ${deliveryId}`
            )
            break
          }

          // A delivery already offered or taken cannot be matched again. Refused before anything is
          // saved, so the catch below records this event as failed (as it did before spec 0002).
          if (dbDelivery.matchedCourierId || dbDelivery.courierId) {
            throw new DeliveryOfferAlreadyMatchedException(
              `Delivery ${deliveryId} is already offered to ${dbDelivery.matchedCourierId ?? dbDelivery.courierId}`
            )
          }

          if (deliveryEvent.type === EnumDeliveryEventType.REJECTED) {
            this.logger.log(`Delivery ${deliveryEvent.deliveryId} was rejected by: ${deliveryEvent.courierId}`)
          }

          // The triggering event (CREATED, REJECTED, OFFER_EXPIRED) is saved first, whatever matching
          // finds. Before spec 0002 a decline that found nobody free was never saved at all.
          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus)

          await this.offerOrWait(deliveryId)
          break
        }
        case EnumDeliveryStatus.ACCEPTED: {
          this.logger.log(`Delivery ${deliveryEvent.deliveryId} was accepted by: ${deliveryEvent.actor}`)

          const courierId = deliveryEvent.courierId
          if (!courierId) {
            throw new NotFoundException('Courier ID is required for dispatching')
          }

          // The accepted offer no longer has a deadline. offeredAt stays as the record of when it went out.
          await this.deliveryRepository.update(deliveryId, { courierId, offerExpiresAt: null })

          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus)

          const courier = await this.courierRepository.findByIdOrThrow(courierId)

          if (courier.status === EnumCourierStatus.LAST_CALL) {
            await this.courierRepository.updateById(courierId, {
              status: EnumCourierStatus.OFFLINE,
            })
            // An Offline rider holds no offers (spec 0002, AC-6): any other open one moves on.
            await this.endOpenOffersForCourier(courierId)
          }
          break
        }
        case EnumDeliveryStatus.DISPATCHED: {
          this.logger.log(`Delivery ${deliveryEvent.deliveryId} was dispatched by: ${deliveryEvent.actor}`)

          const courierId = dbDelivery.courierId
          if (!courierId) {
            throw new NotFoundException('Courier ID is required for dispatching')
          }

          await this.deliveryRepository.update(deliveryId, { courierId })

          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus)
          break
        }
        case EnumDeliveryStatus.ON_THE_WAY: {
          this.logger.log(`Delivery ${deliveryEvent.deliveryId} was marked as on the way  by: ${deliveryEvent.actor}`)

          const courierId = dbDelivery.courierId
          if (!courierId) {
            throw new NotFoundException('Courier ID is required for dispatching')
          }

          await this.deliveryRepository.update(deliveryId, { courierId })

          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus)
          break
        }
        case EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION:
          this.logger.log(
            `Delivery ${deliveryEvent.deliveryId}, courier has arrived at pickup location: ${deliveryEvent.actor}`
          )

          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus)
          break
        case EnumDeliveryStatus.PICKED_UP:
          this.logger.log(`Delivery ${deliveryEvent.deliveryId} was picked up by: ${deliveryEvent.actor}`)

          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus, {
            pickupReadyAt: new Date(),
          })
          break
        case EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION:
          this.logger.log(
            `Delivery ${deliveryEvent.deliveryId}, courier has arrived at dropoff location: ${deliveryEvent.actor}`
          )

          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus)
          break
        case EnumDeliveryStatus.DROPPED_OFF:
          this.logger.log(`Delivery ${deliveryEvent.deliveryId} was dropped off by: ${deliveryEvent.actor}`)

          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus, {
            dropoffReadyAt: new Date(),
          })
          // The rider is free again: offer them (or anyone) a delivery that is waiting (spec 0002, AC-7).
          await this.matchWaitingDeliveries()
          break
        case EnumDeliveryStatus.FAILED: {
          this.logger.log(`Delivery ${deliveryEvent.deliveryId} has failed with reason: ${deliveryEvent.message}`)

          await this.endDelivery(dbDelivery, deliveryEvent, newStatus, currentStatus)
          break
        }
        case EnumDeliveryStatus.CANCELED: {
          this.logger.log(`Delivery ${deliveryEvent.deliveryId} was canceled by: ${deliveryEvent.actor}`)

          await this.endDelivery(dbDelivery, deliveryEvent, newStatus, currentStatus)
          break
        }
        default:
          this.logger.warn(`Received an unsupported order status event ${deliveryEvent}`)
      }
    } catch (error) {
      this.logger.error(
        `Delivery status transition failed for event ${JSON.stringify(deliveryEvent)}:  ${error}`,
        (error as Error).stack
      )
      await this.saveDeliveryEvent(deliveryEvent, {
        transitionSuccessful: false,
        oldStatus: currentStatus, // the status the Delivery was in when the attempt failed
        newStatus, // the status the state machine said the attempt was heading for
        message: (error as Error).message,
      })
    }
  }

  async offerDeliveryToCourierAsAdmin(deliveryId: string, courierId: string, message?: string): Promise<void> {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    if (!delivery.partnerId) {
      throw new DeliveryNotFoundException(`Delivery ${deliveryId} not found`)
    }

    if (delivery.courierId) {
      throw new CantUpdateDeliveryStatusError(`Delivery ${deliveryId} already has an assigned courier`)
    }

    if (
      delivery.status !== EnumDeliveryStatus.CREATED &&
      delivery.status !== EnumDeliveryStatus.ASSIGNING_COURIER
    ) {
      throw new CantUpdateDeliveryStatusError(
        `Delivery ${deliveryId} cannot be assigned manually from status ${delivery.status}`
      )
    }

    const courier = await this.courierRepository.findByIdOrThrow(courierId)
    const oldStatus = delivery.status
    const previousOffer = {
      matchedCourierId: delivery.matchedCourierId,
      offeredAt: delivery.offeredAt,
      offerExpiresAt: delivery.offerExpiresAt,
    }

    // Amounts first, then the offer, so a failed calculation leaves no offer behind.
    const deliveryAmounts = await this.deliveryCalculationService.calculateDeliveryAmountsForMatchedCourier({
      deliveryId,
      courierId,
    })
    const { totalCost, totalCompensation, fee, feePercentage } = deliveryAmounts

    // An admin's offer never expires (spec 0002, AC-3), whatever the setting: offerExpiresAt null.
    await this.deliveryRepository.update(deliveryId, {
      matchedCourierId: courierId,
      offeredAt: new Date(),
      offerExpiresAt: null,
      totalCost,
      totalCompensation,
      fee,
      feePercentage,
    })

    try {
      const updatedDelivery = await this.updateDeliveryStatus(deliveryId, EnumDeliveryStatus.ASSIGNING_COURIER)

      const auditEvent: DeliveryConfirmedEvent = {
        deliveryId,
        type: EnumDeliveryEventType.CONFIRMED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        message: message
          ? `Admin offered delivery to courier ${courierId}: ${message}`
          : `Admin offered delivery to courier ${courierId}`,
      }

      await this.saveDeliveryEvent(auditEvent, {
        transitionSuccessful: true,
        oldStatus,
        newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      })
      await this.saveOfferedEvent(deliveryId, courierId, EnumEventActor.ADMIN, null)
      // The delivery is no longer waiting, so its backstop retry is not needed.
      await this.removeNoCourierRetry(deliveryId)

      if (updatedDelivery.partnerId) {
        await this.notifyPartner(
          updatedDelivery.partnerId,
          EnumDeliveryStatus.ASSIGNING_COURIER,
          oldStatus,
          auditEvent
        )
      }

      await this.websocketDispatcher.sendOfferToCourier(courier.userId, new DeliveryCourierDto(updatedDelivery))
    } catch (error) {
      await this.deliveryRepository.update(deliveryId, previousOffer)
      throw error
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Offers that end on their own (spec 0002)
  // ---------------------------------------------------------------------------------------------

  // Called by both controllers that change a rider's status (the rider's own PATCH courier/status
  // and the admin courier update), after the new status is saved. Offline ends the rider's open
  // offers; any other status means they may take work, so waiting deliveries are matched again.
  async handleCourierStatusChanged(courierId: string, status: EnumCourierStatus): Promise<void> {
    if (status === EnumCourierStatus.OFFLINE) {
      await this.endOpenOffersForCourier(courierId)
    } else {
      await this.matchWaitingDeliveries()
    }
  }

  // A rider went Offline (or logged out): every offer they still hold ends at once and moves on to
  // the next rider, automatic and admin offers alike, whether expiry is on or off (AC-6).
  // Called from the controllers, not from CourierDomainService.updateStatus, because this service
  // already depends on the courier domain through matching and the reverse would be a cycle.
  // Never throws: the rider's status change has already happened and must not be reported as failed.
  async endOpenOffersForCourier(courierId: string): Promise<void> {
    let openOffers: DeliveryEntity[]
    try {
      openOffers = await this.deliveryRepository.findOpenOffersForCourier(courierId)
    } catch (error) {
      this.logger.error(`Could not look up open offers of courier ${courierId}: ${error}`, (error as Error).stack)
      return
    }

    for (const delivery of openOffers) {
      try {
        await this.endOffer({
          deliveryId: delivery.id,
          courierId,
          offeredAt: delivery.offeredAt,
          reason: 'OFFLINE',
          message: 'Rider went offline',
        })
      } catch (error) {
        this.logger.error(`Could not end offer of delivery ${delivery.id}: ${error}`, (error as Error).stack)
      }
    }
  }

  // A rider became free (went Online, or finished a delivery): offer the longest waiting delivery
  // that someone can take (AC-7, flow 5). One rider coming free frees one moped, so the loop stops
  // at the first offer that goes out; the other waiting deliveries keep their backstop retries.
  // Never throws, for the same reason as above.
  async matchWaitingDeliveries(): Promise<void> {
    let waitingIds: string[]
    try {
      waitingIds = await this.deliveryRepository.findIdsWaitingForCourierOldestFirst()
    } catch (error) {
      this.logger.error(`Could not look up deliveries waiting for a rider: ${error}`, (error as Error).stack)
      return
    }

    for (const deliveryId of waitingIds) {
      let result: OfferStepResult
      try {
        result = await this.offerToNextCourier(deliveryId)
      } catch (error) {
        this.logger.error(`Offering waiting delivery ${deliveryId} failed: ${error}`, (error as Error).stack)
        continue
      }
      // One offer per rider coming free (scope row 61 review): without this stop the same rider was
      // offered every waiting delivery in a row. The busy rule in the matcher now also counts an open
      // offer, so this is a second belt for two matchers running at once.
      if (result === 'OFFERED') break
      // Nobody for this one most likely means nobody for the rest. Not certain (a newer delivery may
      // sit near a rider the 20 km rule kept from this one), but every waiting delivery has its own
      // backstop retry pending, which finds that rider within noCourierRetrySeconds.
      if (result === 'NO_COURIER') break
    }
  }

  // The offer-expiry job (flow 2). Ends the offer only if it is still the very offer the job was
  // made for and its deadline has passed; any other state means it was answered, re-offered or
  // cancelled first, and the job does nothing (AC-5).
  async handleOfferExpiryJob(payload: OfferExpiryJobPayload): Promise<void> {
    const offeredAt = new Date(payload.offeredAt)
    if (Number.isNaN(offeredAt.getTime())) {
      this.logger.warn(`offer-expiry job with a bad offeredAt ignored: ${JSON.stringify(payload)}`)
      return
    }

    const delivery = await this.deliveryRepository.findById(payload.deliveryId)
    if (!delivery?.offeredAt || !delivery.offerExpiresAt) {
      return
    }

    // The deadline this offer was given, which is not necessarily today's setting.
    const seconds = Math.round((delivery.offerExpiresAt.getTime() - delivery.offeredAt.getTime()) / 1000)

    await this.endOffer({
      deliveryId: payload.deliveryId,
      courierId: payload.courierId,
      offeredAt,
      reason: 'EXPIRED',
      message: `Offer expired after ${seconds} s`,
    })
  }

  // The backstop retry for a delivery nobody could take (flow 6). Riders leaving a skip list free
  // up on no event of their own, so this timer is what finds them.
  async handleNoCourierRetryJob(payload: NoCourierRetryJobPayload): Promise<void> {
    const delivery = await this.deliveryRepository.findById(payload.deliveryId)
    if (
      !delivery ||
      delivery.status !== EnumDeliveryStatus.ASSIGNING_COURIER ||
      delivery.matchedCourierId ||
      delivery.courierId
    ) {
      // Offered, taken or ended meanwhile: the chain of retries stops here.
      return
    }

    let result: OfferStepResult
    try {
      result = await this.offerToNextCourier(payload.deliveryId)
    } catch (error) {
      this.logger.error(`Retrying delivery ${payload.deliveryId} failed: ${error}`, (error as Error).stack)
      result = 'NO_COURIER'
    }

    // Still nobody: try again later. No new event, it is the same waiting spell.
    if (result === 'NO_COURIER') {
      await this.scheduleNoCourierRetry(payload.deliveryId)
    }
  }

  // Ends one open offer with OFFER_EXPIRED (the deadline passed, or the rider went offline). The
  // conditional update is the race rule: it clears the offer only if the delivery is still offered
  // to this rider, by this very offer, and nobody has taken it. Returns whether it ended the offer.
  private async endOffer(args: {
    deliveryId: string
    courierId: string
    offeredAt: Date | null
    reason: OfferEndedReason
    message: string
  }): Promise<boolean> {
    const { deliveryId, courierId, reason, message } = args

    const stillThisOffer: Prisma.DeliveryWhereInput = {
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      matchedCourierId: courierId,
      offeredAt: args.offeredAt,
      courierId: null,
    }
    if (reason === 'EXPIRED') {
      // Only an offer that has a deadline, and only once it has passed. An admin offer (no deadline)
      // can therefore never be ended by a job, stray or not (AC-3).
      stillThisOffer.offerExpiresAt = { lte: new Date() }
    }

    const ended = await this.deliveryRepository.updateIfMatches(deliveryId, stillThisOffer, {
      matchedCourierId: null,
      offeredAt: null,
      offerExpiresAt: null,
    })
    if (!ended) {
      this.logger.log(`Offer of delivery ${deliveryId} to courier ${courierId} had already changed; nothing ended`)
      return false
    }

    // Skipped for this delivery like a decline (the same 20 min list). Nothing else about the rider
    // changes: no count, no status change (value 5). A failed write here must not stop the
    // delivery moving on, so it is logged and the rider may simply be offered it again.
    try {
      await addCourierToRejectedList(this.cacheService, deliveryId, courierId)
    } catch (error) {
      this.logger.error(`Could not add courier ${courierId} to the skip list of ${deliveryId}: ${error}`)
    }

    // Tell the rider first, so their screen drops the offer before matching takes its time.
    const courier = await this.courierRepository.findById(courierId)
    if (courier) {
      await this.websocketDispatcher.sendOfferEnded(courier.userId, { deliveryId, reason })
    }

    const expiredEvent: DeliveryOfferExpiredEvent = {
      deliveryId,
      type: EnumDeliveryEventType.OFFER_EXPIRED,
      actor: EnumEventActor.SYSTEM,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId,
      message,
    }
    // Saves OFFER_EXPIRED and offers the delivery to the next rider, like a decline.
    await this.processDeliveryEvent(expiredEvent)
    return true
  }

  // After a triggering event: offer to the next rider, or record that nobody is free and set the
  // backstop timer.
  private async offerOrWait(deliveryId: string): Promise<void> {
    let result: OfferStepResult
    try {
      result = await this.offerToNextCourier(deliveryId)
    } catch (error) {
      // The triggering event is already saved, so this is not a failed transition. Try again
      // later rather than leave the delivery with nobody looking at it.
      this.logger.error(`Offering delivery ${deliveryId} failed: ${error}`, (error as Error).stack)
      await this.scheduleNoCourierRetry(deliveryId)
      return
    }

    if (result === 'NO_COURIER') {
      await this.recordNoCourierAvailable(deliveryId)
    }
  }

  // The one "offer to the next rider" step, shared by the ASSIGNING_COURIER case, the backstop
  // retry and a rider becoming free. Amounts are worked out first; only when they succeed is the
  // offer written, in one conditional update with its start time and deadline, so a failure can
  // never leave an offer with no timer behind (flow 1).
  private async offerToNextCourier(deliveryId: string): Promise<OfferStepResult> {
    const match = await this.deliveryMatchingService.findCourierForDelivery(deliveryId)
    if (!match) {
      this.logger.log(`No courier found for delivery ${deliveryId}`)
      return 'NO_COURIER'
    }
    const { courier } = match

    const { totalCost, totalCompensation, fee, feePercentage } =
      await this.deliveryCalculationService.calculateDeliveryAmountsForMatchedCourier({
        deliveryId,
        courierId: courier.id,
      })

    // Settings are read now, so a change later never moves a deadline already given (AC-10).
    const expiryEnabled = await this.configDomainService.instanceConfig.getOfferExpiryEnabled()
    const expirySeconds = expiryEnabled ? await this.configDomainService.instanceConfig.getOfferExpirySeconds() : null
    const offeredAt = new Date()
    const offerExpiresAt = expirySeconds !== null ? new Date(offeredAt.getTime() + expirySeconds * 1000) : null

    // Written only if the delivery is still waiting with nobody offered: a second matcher running
    // at the same moment (a retry and a rider coming Online, say) cannot offer it twice.
    const claimed = await this.deliveryRepository.updateIfMatches(
      deliveryId,
      { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: null, courierId: null },
      { matchedCourierId: courier.id, offeredAt, offerExpiresAt, totalCost, totalCompensation, fee, feePercentage }
    )
    if (!claimed) {
      this.logger.log(`Delivery ${deliveryId} was offered or taken meanwhile; not offering it to ${courier.id}`)
      return 'NOT_WAITING'
    }

    this.logger.log(`Delivery ${deliveryId} is being offered to courier: ${courier.id}`)
    await this.saveOfferedEvent(deliveryId, courier.id, EnumEventActor.SYSTEM, offerExpiresAt)

    if (expirySeconds !== null) {
      await this.scheduleOfferExpiry(deliveryId, courier.id, offeredAt, expirySeconds)
    }
    await this.removeNoCourierRetry(deliveryId)

    const updatedDelivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    this.logger.log(`Sending offer to courier: ${courier.id}`)
    await this.websocketDispatcher.sendOfferToCourier(courier.userId, new DeliveryCourierDto(updatedDelivery))
    return 'OFFERED'
  }

  // Matching found nobody (flow 4): one NO_COURIER_AVAILABLE per waiting spell, then the backstop.
  // A spell starts when nobody is found and ends when an offer goes out, so a new
  // NO_COURIER_AVAILABLE is written unless the newer of the two is already NO_COURIER_AVAILABLE.
  private async recordNoCourierAvailable(deliveryId: string): Promise<void> {
    const latest = await this.deliveryEventRepository.findLatestOfTypes(deliveryId, [
      EnumDeliveryEventType.OFFERED,
      EnumDeliveryEventType.NO_COURIER_AVAILABLE,
    ])

    if (latest?.type !== EnumDeliveryEventType.NO_COURIER_AVAILABLE) {
      const noCourierEvent: DeliveryNoCourierAvailableEvent = {
        deliveryId,
        type: EnumDeliveryEventType.NO_COURIER_AVAILABLE,
        actor: EnumEventActor.SYSTEM,
        source: EnumDeliveryEventSource.OPENCOURIER,
        message: 'No rider free; the delivery waits and is matched again when one is',
      }
      await this.saveDeliveryEvent(noCourierEvent, {
        transitionSuccessful: true,
        oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
        newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      })
    }

    await this.scheduleNoCourierRetry(deliveryId)
  }

  // One OFFERED row per offer (AC-2): who was offered, by whom (SYSTEM or ADMIN), and the deadline.
  private async saveOfferedEvent(
    deliveryId: string,
    courierId: string,
    actor: EnumEventActor,
    offerExpiresAt: Date | null
  ): Promise<void> {
    const offeredEvent: DeliveryOfferedEvent = {
      deliveryId,
      type: EnumDeliveryEventType.OFFERED,
      actor,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId,
      message: offerExpiresAt
        ? `Offered to courier ${courierId}, answer by ${offerExpiresAt.toISOString()}`
        : `Offered to courier ${courierId}, no deadline`,
    }
    await this.saveDeliveryEvent(offeredEvent, {
      transitionSuccessful: true,
      oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
    })
  }

  // CANCELED or FAILED (flow 7): an open offer ends with the status change and the backstop goes.
  // A pending offer-expiry job finds the status changed and does nothing. If a rider was working the
  // delivery, they are free again.
  private async endDelivery(
    dbDelivery: DeliveryEntity,
    deliveryEvent: DeliveryEvent,
    newStatus: EnumDeliveryStatus,
    oldStatus: EnumDeliveryStatus
  ): Promise<void> {
    const clearOffer =
      oldStatus === EnumDeliveryStatus.ASSIGNING_COURIER
        ? { matchedCourierId: null, offeredAt: null, offerExpiresAt: null }
        : {}

    await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, oldStatus, clearOffer)
    await this.removeNoCourierRetry(dbDelivery.id)

    if (dbDelivery.courierId) {
      await this.matchWaitingDeliveries()
    }
  }

  // Timer helpers. A failure to talk to Redis is logged, never thrown: it must not undo an offer
  // or a status change that already happened. Without its timer an offer rings on like expiry off.
  private async scheduleOfferExpiry(deliveryId: string, courierId: string, offeredAt: Date, seconds: number) {
    try {
      await this.bullMQService.addJob<OfferExpiryJobPayload>(
        'offer-expiry',
        { deliveryId, courierId, offeredAt: offeredAt.toISOString() },
        { delay: (seconds + OFFER_EXPIRY_GRACE_SECONDS) * 1000, jobId: offerExpiryJobId(deliveryId, offeredAt) }
      )
    } catch (error) {
      this.logger.error(`Could not set the expiry timer of delivery ${deliveryId}: ${error}`)
    }
  }

  // Remove, then add: at most one backstop is pending per delivery, whatever triggered it. The id
  // carries the time because BullMQ ignores an add whose id still exists, and the job that calls
  // this from its own handler still exists while it runs.
  private async scheduleNoCourierRetry(deliveryId: string) {
    try {
      const seconds = await this.configDomainService.instanceConfig.getNoCourierRetrySeconds()
      await this.bullMQService.removeDelayedJobsWithIdPrefix(noCourierRetryJobIdPrefix(deliveryId))
      await this.bullMQService.addJob<NoCourierRetryJobPayload>(
        'no-courier-retry',
        { deliveryId },
        { delay: seconds * 1000, jobId: `${noCourierRetryJobIdPrefix(deliveryId)}${Date.now()}` }
      )
    } catch (error) {
      this.logger.error(`Could not set the retry timer of delivery ${deliveryId}: ${error}`)
    }
  }

  private async removeNoCourierRetry(deliveryId: string) {
    try {
      await this.bullMQService.removeDelayedJobsWithIdPrefix(noCourierRetryJobIdPrefix(deliveryId))
    } catch (error) {
      this.logger.error(`Could not remove the retry timer of delivery ${deliveryId}: ${error}`)
    }
  }

  @OnEvent(NEST_DELIVERY_EVENT_NAME)
  private async handleDeliveryUpdateEvent(event: DeliveryEvent) {
    await this.processDeliveryEvent(event)
  }

  private async updateDeliveryAndSendNotifications(
    deliveryEvent: DeliveryEvent,
    newStatus: EnumDeliveryStatus,
    oldStatus: EnumDeliveryStatus,
    additionalDeliveryData: Omit<Prisma.DeliveryUncheckedUpdateInput, 'status'> = {}
  ) {
    const updatedDelivery = await this.updateDeliveryStatus(
      deliveryEvent.deliveryId,
      newStatus,
      additionalDeliveryData
    )

    await this.saveDeliveryEvent(deliveryEvent, {
      transitionSuccessful: true,
      oldStatus,
      newStatus,
    })

    if (updatedDelivery.partnerId) {
      await this.notifyPartner(updatedDelivery.partnerId, newStatus, oldStatus, deliveryEvent)
    }

    if (updatedDelivery.courierId) {
      await this.notifyCourier(updatedDelivery.courierId, updatedDelivery, newStatus, oldStatus, deliveryEvent)
    }

    return updatedDelivery
  }

  private async updateDeliveryAmounts(
    deliveryId: string,
    totalCost: number,
    totalCompensation: number,
    fee: number,
    feePercentage: number
  ) {
    await this.deliveryRepository.update(deliveryId, {
      totalCost,
      totalCompensation,
      fee,
      feePercentage,
    })
  }

  private async notifyPartner(
    userId: string,
    newStatus: EnumDeliveryStatus,
    oldStatus: EnumDeliveryStatus,
    event: DeliveryEvent
  ) {
    try {
      await this.partnerWebhookService.sendDeliveryUpdatePartnerWebhook({
        deliveryId: event.deliveryId,
        oldStatus: oldStatus,
        status: newStatus,
        event: event,
      })
    } catch (error) {
      this.logger.error(
        `Error sending event notification for delivery ${event.deliveryId} to partner ${userId}: ${error}`
      )
    }
  }
  private async notifyCourier(
    courierId: string,
    delivery: DeliveryEntity,
    newStatus: EnumDeliveryStatus,
    oldStatus: EnumDeliveryStatus,
    deliveryEvent: DeliveryEvent
  ) {
    try {
      this.logger.log(`Sending delivery updated: ${courierId}`)
      const courier = await this.courierRepository.findByIdOrThrow(courierId)

      await this.websocketDispatcher.dispatchDeliveryStatusUpdated(
        courier.userId,
        oldStatus,
        newStatus,
        new DeliveryCourierDto(delivery)
      )
    } catch (error) {
      this.logger.error(
        `Error sending event notification for delivery ${delivery.id} to courier ${courierId}: ${error}`
      )
    }
  }

  // The three trailing values used to be positional parameters. Two of them were
  // EnumDeliveryStatus, so passing them in the wrong order still compiled — and the
  // failure path did exactly that, writing every failed row's statuses backwards.
  // An object parameter forces each value to be named at the call site.
  private async saveDeliveryEvent(
    deliveryEvent: DeliveryEvent,
    outcome: {
      transitionSuccessful: boolean
      oldStatus?: EnumDeliveryStatus // the status the Delivery was actually in
      newStatus?: EnumDeliveryStatus // the status this event moved it to, or tried to
      message?: string
    }
  ) {
    // Only OFFERED and OFFER_EXPIRED name a rider in the courierId column (spec 0002). Every
    // other event leaves it out (null), even when the event object carries a courierId.
    // Checking `type` narrows the union, so TypeScript knows courierId is a string on these two.
    const riderId =
      deliveryEvent.type === EnumDeliveryEventType.OFFERED || deliveryEvent.type === EnumDeliveryEventType.OFFER_EXPIRED
        ? deliveryEvent.courierId
        : undefined

    return await this.deliveryEventRepository.create({
      ...(riderId !== undefined ? { courierId: riderId } : {}),
      actor: deliveryEvent.actor,
      eventSource: deliveryEvent.source,
      message: outcome.message || deliveryEvent.message || null,
      newStatus: outcome.newStatus || null,
      oldStatus: outcome.oldStatus || null,
      deliveryId: deliveryEvent.deliveryId,
      transitionSuccessful: outcome.transitionSuccessful,
      type: deliveryEvent.type,
    })
  }

  private async updateDeliveryStatus(
    deliveryId: string,
    status: EnumDeliveryStatus,
    additionalData: Omit<Prisma.DeliveryUncheckedUpdateInput, 'status'> = {}
  ) {
    return await this.deliveryRepository.update(deliveryId, {
      status,
      ...additionalData,
    })
  }

  async schedulePickupDeliveryFulfillAndCapture(deliveryId: string) {
    const date = new Date(Date.now() + PICKUP_ORDER_FORCED_FULFILL_DELAY_MINUTES * 60 * 1000)

    this.logger.log(`Scheduling ${deliveryId} order pickup fulfillment ${date}`)
    await this.taskScheduler.scheduleTask<ForcePickupFulfillmentPayload>('schedule-force-pickup-fulfillment', date, {
      deliveryId,
    })
  }
}
