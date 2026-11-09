import type { DeliveryFoodReadyEvent, DeliveryReadyDelayedEvent } from 'src/shared-types/delivery-events'
import type { JobReadyUpdatedMessage } from 'src/shared-types/notification'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { OnEvent } from '@nestjs/event-emitter'
import { ConfigService } from '@nestjs/config'
import {
  EnumCourierStatus,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumCancelledBy,
  EnumCourierCompensationReason,
  EnumPartnerChargeReason,
  Prisma,
} from '@prisma/types'
import {
  DeliveryConfirmedEvent,
  DeliveryEvent,
  DeliveryNoCourierAvailableEvent,
  DeliveryOfferedEvent,
  DeliveryOfferExpiredEvent,
  DeliveryReturnedToWaitingEvent,
  DeliveryHandedBackEvent,
  DeliveryCourierPaidForCancellationEvent,
  DeliveryFoodReturnedEvent,
  DeliveryDropoffPointCorrectedEvent,
  DeliveryFoodNotReturnedEvent,
  DELIVERY_ONGOING_STATUSES,
  OfferEndedMessage,
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
import { DEFAULT_HAND_BACK_SECONDS, OFFER_EXPIRY_GRACE_SECONDS, PICKUP_ORDER_FORCED_FULFILL_DELAY_MINUTES } from '../../constants'
import { isRecordNotFoundError } from '../../prisma.util'
import { WebsocketDispatcher } from '../websocket/models/WebsocketDispatcher'
import { TaskBusScheduler } from '../taskBus/models/TaskBusScheduler'
import { TaskBusService } from '../taskBus/taskBus.service'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { SOS_SENTENCES } from 'src/domains/sos/sos-incident-state'
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
import { addCourierToRejectedList, removeCourierFromRejectedList } from '../cache/rejected-couriers'
import { OfferPushService } from '../pushNotification/offer-push.service'
import { occurredAtForTap, TAP_AGE_WORTH_A_LOOK_MS } from 'src/domains/delivery-event/utils/occurred-at.util'
import { DispatchStopRepository } from 'src/persistence/repositories/dispatch-stop.repository'
import { adminRefusedMessage, clock } from 'src/domains/dispatch-stop/dispatch-stop-time'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'
import { PartnerChargeRepository } from 'src/persistence/repositories/partner-charge.repository'
import { resolveCancellationPayout } from 'src/domains/delivery/utils/cancellation-payout.util'
import { eventLogLine } from 'src/domains/delivery-event/utils/event-log-line'

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

// Internal dispatch events partners never receive as webhooks (row 61 review): they would tell a
// restaurant which rider was offered its delivery or let an offer pass, and partners have no use
// for them. The delivery's own status changes still reach partners as before.
const EVENTS_NOT_SENT_TO_PARTNERS: EnumDeliveryEventType[] = [
  EnumDeliveryEventType.OFFERED,
  EnumDeliveryEventType.OFFER_EXPIRED,
  EnumDeliveryEventType.NO_COURIER_AVAILABLE,
]

// What one try at offering a delivery came to. NOT_WAITING: someone else offered or took it first.
// STOPPED: dispatch is stopped (spec 0014); no offer is made and nothing is recorded or retried.
type OfferStepResult = 'OFFERED' | 'NO_COURIER' | 'NOT_WAITING' | 'STOPPED' | 'NOT_DUE'

// What the timing check of one offer came to (spec 0031): how long to hold it, and the words the
// OFFERED event adds. `note` is empty when the offer is not a timed one.
type OfferTiming = { dueInMs: number; note: string }

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
    private readonly cacheService: CacheService,
    // Spec 0003: the push half of telling a rider about an offer (off unless Firebase is set up).
    private readonly offerPushService: OfferPushService,
    private readonly dispatchStopRepository: DispatchStopRepository,
    private readonly osrmRoutingService: OsrmRoutingService,
    // Spec 0015: the rider's pay and the restaurant's charge when a job is cancelled.
    private readonly courierCompensationRepository: CourierCompensationRepository,
    private readonly partnerChargeRepository: PartnerChargeRepository
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

  // When a rider's job step happened, for a step the phone sent `tapAgeMs` after the tap (spec 0009,
  // AC-7): the server's receive time minus that age, never before the delivery's latest job step
  // (or its creation, when it has none) and never after it was received.
  async occurredAtForCourierTap(
    delivery: { id: string; createdAt: Date },
    tap: { receivedAt: Date; tapAgeMs: number }
  ): Promise<Date> {
    // A step that waited more than an hour is worth a look: the age is the rider's phone's claim
    // (decision 20.13). Ids and the age only, never personal data.
    if (tap.tapAgeMs > TAP_AGE_WORTH_A_LOOK_MS) {
      this.logger.warn(
        `Delivery ${delivery.id}: a rider's step arrived ${Math.round(tap.tapAgeMs / 60000)} min after its tap`
      )
    }
    const latestStep = await this.deliveryEventRepository.findLatestJobStepOccurredAt(delivery.id)
    return occurredAtForTap({
      receivedAt: tap.receivedAt,
      tapAgeMs: tap.tapAgeMs,
      floor: latestStep ?? delivery.createdAt,
    })
  }

  async processDeliveryEvent(originalEvent: DeliveryEvent): Promise<void> {
    // Ids and type only (row 95): the event's message is free text and stays on its DeliveryEvent row.
    this.logger.log(`Processing order event: ${eventLogLine(originalEvent)}`)
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
        // A rider's tapped step (it carries occurredAt) that no longer applies, such as a Delivered
        // sent after an admin cancelled, is kept as a failed row with its tap time, so the co-op can
        // see that the rider acted and when (spec 0009, decision 20.13). Every other event is still
        // dropped silently, as before.
        if (deliveryEvent.occurredAt) {
          await this.saveDeliveryEvent(deliveryEvent, {
            transitionSuccessful: false,
            oldStatus: currentStatus,
            message: `No transition from ${currentStatus} via ${deliveryEvent.type}; the rider's step arrived after the delivery changed`,
          })
        }
        return
      }

      if (deliveryEvent.type === EnumDeliveryEventType.HANDED_BACK) {
        // Spec 0020: written only by handBack, in one conditional write with its status.
        throw new CantUpdateDeliveryStatusError('HANDED_BACK is recorded by a rider hand back only')
      }

      if (deliveryEvent.type === EnumDeliveryEventType.RETURNED_TO_WAITING) {
        // Spec 0014: written only by returnToWaitingForDispatchStop, in one conditional write with
        // its status (row 29 review). Never processed as an ordinary event.
        throw new CantUpdateDeliveryStatusError('RETURNED_TO_WAITING is recorded by a dispatch stop only')
      }

      if (deliveryEvent.type === EnumDeliveryEventType.REASSIGNED) {
        const newCourierId = deliveryEvent.courierId
        if (!newCourierId) throw new NotFoundException('Courier ID is required for reassignment')
        const droppedCourierId = dbDelivery.courierId // capture BEFORE clearing
        const newCourier = await this.courierRepository.findByIdOrThrow(newCourierId)

        // Amounts for the new rider first, then the offer, so a failed calculation leaves the
        // delivery with its old rider rather than half moved (spec 0002, flow 1).
        const { totalCost, totalCompensation, fee, feePercentage } =
          await this.deliveryCalculationService.calculateDeliveryAmountsForMatchedCourier({
            deliveryId,
            courierId: newCourierId,
          })

        // Drop the old rider, offer to the new one. The new rider must still accept.
        // An admin's offer has no deadline (spec 0002, AC-3): offerExpiresAt stays null.
        // Written only if the delivery is still where it was read (same status, same rider), so a
        // status change the old rider sent meanwhile is not overwritten (row 61 review). A miss
        // throws, and the catch below records this REASSIGNED as a failed transition.
        const moved = await this.deliveryRepository.updateIfMatches(
          deliveryId,
          { status: currentStatus, courierId: droppedCourierId },
          {
            courierId: null,
            matchedCourierId: newCourierId,
            offeredAt: new Date(),
            offerExpiresAt: null,
            // No rider holds it now (spec 0020): no accept time, no hand back.
            acceptedAt: null,
            handBackUntil: null,
            totalCost,
            totalCompensation,
            fee,
            feePercentage,
          }
        )
        if (!moved) {
          throw new CantUpdateDeliveryStatusError(
            `Delivery ${deliveryId} changed while it was being reassigned; nothing was moved`
          )
        }

        // Sets status via the state machine result, saves the DeliveryEvent, notifies partner.
        const updatedDelivery = await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus)

        // The delivery no longer carries the dropped rider's id, so notifyCourier inside
        // updateDeliveryAndSendNotifications did not reach them — tell them explicitly.
        if (droppedCourierId) {
          await this.notifyCourier(droppedCourierId, updatedDelivery, newStatus, currentStatus, deliveryEvent)
        }
        await this.saveOfferedEvent(deliveryId, newCourierId, EnumEventActor.ADMIN, null)
        await this.sendOfferToRider(newCourier, updatedDelivery)
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
          // Written with the status in one conditional write (decision 32.17), so an accept that lost
          // the race to a cancel leaves no rider on the cancelled delivery.
          // Spec 0020: the accept time and the end of the free hand back, stored now so a later change
          // of the setting never moves a running minute (0 seconds: no hand back).
          // A setting that cannot be read must never cost a rider their accept (value 4): the
          // default window is used and the failure logged.
          let handBackSeconds = DEFAULT_HAND_BACK_SECONDS
          try {
            handBackSeconds = await this.configDomainService.instanceConfig.getHandBackSeconds()
          } catch (error) {
            this.logger.warn(`Could not read handBackSeconds while accepting ${deliveryEvent.deliveryId}: ${error}`)
          }
          // Taken after the read, so a slow read does not shorten the window (row 71 review).
          const acceptedAt = new Date()
          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus, {
            courierId,
            offerExpiresAt: null,
            acceptedAt,
            handBackUntil: handBackSeconds > 0 ? new Date(acceptedAt.getTime() + handBackSeconds * 1000) : null,
          })

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

          // With the status, in its conditional write (decision 32.17).
          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus, { courierId })
          break
        }
        case EnumDeliveryStatus.ON_THE_WAY: {
          this.logger.log(`Delivery ${deliveryEvent.deliveryId} was marked as on the way  by: ${deliveryEvent.actor}`)

          const courierId = dbDelivery.courierId
          if (!courierId) {
            throw new NotFoundException('Courier ID is required for dispatching')
          }

          // With the status, in its conditional write (decision 32.17).
          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus, { courierId })
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

          // The tap time when the step waited on the phone for signal (spec 0009, AC-12).
          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus, {
            pickupReadyAt: deliveryEvent.occurredAt ?? new Date(),
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

          // The tap time when the step waited on the phone for signal (spec 0009, AC-12).
          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus, {
            dropoffReadyAt: deliveryEvent.occurredAt ?? new Date(),
          })
          // The rider is free again: offer them (or anyone) a delivery that is waiting (spec 0002, AC-7).
          await this.matchWaitingDeliveries()
          break
        case EnumDeliveryStatus.FAILED: {
          // The reason is free text and stays on the event row (row 95): the log names the delivery only.
          this.logger.log(`Delivery ${deliveryEvent.deliveryId} has failed`)

          await this.endDelivery(dbDelivery, deliveryEvent, newStatus, currentStatus)
          break
        }
        case EnumDeliveryStatus.CANCELED: {
          this.logger.log(`Delivery ${deliveryEvent.deliveryId} was canceled by: ${deliveryEvent.actor}`)

          await this.cancelDelivery(dbDelivery, deliveryEvent, currentStatus)
          break
        }
        default:
          this.logger.warn(`Received an unsupported order status event: ${eventLogLine(deliveryEvent)}`)
      }
    } catch (error) {
      this.logger.error(
        `Delivery status transition failed for event ${eventLogLine(deliveryEvent)}: ${error}`,
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
    // A heat or storm stop binds admins too (spec 0014, AC-4, decision 29.1): restart dispatch first.
    await this.refuseIfDispatchStopped()
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
    // The open offer this one replaces, if another rider holds one: they are told it moved (below).
    const replacedCourierId =
      delivery.status === EnumDeliveryStatus.ASSIGNING_COURIER &&
      delivery.matchedCourierId &&
      delivery.matchedCourierId !== courierId
        ? delivery.matchedCourierId
        : null

    // Amounts first, then the offer, so a failed calculation leaves no offer behind.
    const deliveryAmounts = await this.deliveryCalculationService.calculateDeliveryAmountsForMatchedCourier({
      deliveryId,
      courierId,
    })
    const { totalCost, totalCompensation, fee, feePercentage } = deliveryAmounts

    // The race rule (spec 0002) applies to the admin override too: written only if the delivery is
    // still as it was read (same status, nobody took it, the same offer or none open), and the
    // status goes in the same write, so a rider's accept landing in between can never be undone by
    // a later status write. An admin's offer never expires (AC-3), whatever the setting.
    const offeredAt = new Date()
    const written = await this.deliveryRepository.updateIfMatches(
      deliveryId,
      {
        status: delivery.status,
        courierId: null,
        matchedCourierId: delivery.matchedCourierId,
        offeredAt: delivery.offeredAt,
      },
      {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt,
        offerExpiresAt: null,
        totalCost,
        totalCompensation,
        fee,
        feePercentage,
      }
    )
    if (!written) {
      throw new CantUpdateDeliveryStatusError(
        `Delivery ${deliveryId} changed while you were offering it (a rider answered or it moved on); reload and try again`
      )
    }

    try {
      const updatedDelivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

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
      await this.saveOfferedEvent(deliveryId, courierId, EnumEventActor.ADMIN, null, replacedCourierId)
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

      await this.sendOfferToRider(courier, updatedDelivery)
    } catch (error) {
      // Give the previous offer back, but only if this admin offer is still the one in place (a rider
      // may have accepted it meanwhile, and that must stand).
      await this.deliveryRepository.updateIfMatches(
        deliveryId,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: courierId, offeredAt, courierId: null },
        previousOffer
      )
      throw error
    }

    // The rider whose open offer was replaced drops it from their screen now. Their own expiry job,
    // if any, finds the offer changed and does nothing. They are not put on the skip list: an admin
    // moved the offer, the rider did nothing (value 5).
    if (replacedCourierId) {
      try {
        const replacedCourier = await this.courierRepository.findById(replacedCourierId)
        if (replacedCourier) {
          await this.sendOfferEndedToRider(replacedCourier, { deliveryId, reason: 'MOVED' })
        }
      } catch (error) {
        this.logger.error(`Could not tell courier ${replacedCourierId} that the offer of ${deliveryId} moved: ${error}`)
      }
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
      // Dispatch is stopped (spec 0014): nothing is offered to anyone until it restarts.
      if (result === 'STOPPED') break
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

    // Skipped for this delivery like a decline (the same 20 min list). Added BEFORE the offer is
    // cleared, so a matcher running in between (a rider coming Online, a retry) cannot offer the
    // delivery straight back to this rider. Nothing else about the rider changes: no count, no
    // status change (value 5). A failed write here must not stop the delivery moving on, so it is
    // logged and the rider may simply be offered it again.
    // An offer ended because dispatch stopped is not the rider's miss (spec 0014, AC-5): no skip list.
    let addedToSkipList = false
    if (reason !== 'STOPPED') {
      try {
        addedToSkipList = await addCourierToRejectedList(this.cacheService, deliveryId, courierId)
      } catch (error) {
        this.logger.error(`Could not add courier ${courierId} to the skip list of ${deliveryId}: ${error}`)
      }
    }

    let ended: boolean
    try {
      ended = await this.deliveryRepository.updateIfMatches(deliveryId, stillThisOffer, {
        matchedCourierId: null,
        offeredAt: null,
        offerExpiresAt: null,
      })
    } catch (error) {
      if (addedToSkipList) await this.undoSkipListEntry(deliveryId, courierId)
      throw error
    }
    if (!ended) {
      // The offer had already changed, so this rider's turn did not end here. Take back only the
      // entry this call added; one left over from an earlier decline is not ours to remove.
      if (addedToSkipList) await this.undoSkipListEntry(deliveryId, courierId)
      this.logger.log(`Offer of delivery ${deliveryId} to courier ${courierId} had already changed; nothing ended`)
      return false
    }

    // From here the offer is gone. Every step below is guarded on its own, so a failure in one (the
    // rider lookup, the socket, the event pipeline) cannot leave the delivery with no OFFER_EXPIRED
    // row and nobody looking for a rider. The processor never retries a job, so nothing else would.

    // Tell the rider first, so their screen drops the offer before matching takes its time.
    try {
      const courier = await this.courierRepository.findById(courierId)
      if (courier) {
        await this.sendOfferEndedToRider(courier, { deliveryId, reason })
      }
    } catch (error) {
      this.logger.error(`Could not tell courier ${courierId} that the offer of ${deliveryId} ended: ${error}`)
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
    try {
      await this.processDeliveryEvent(expiredEvent)
    } catch (error) {
      this.logger.error(`Recording OFFER_EXPIRED for delivery ${deliveryId} failed: ${error}`, (error as Error).stack)
    }

    // If that left the delivery waiting with nobody offered (matching failed, or nobody is free),
    // make sure a backstop retry is pending, so it is matched again later.
    await this.ensureBackstopIfStillWaiting(deliveryId)
    return true
  }

  // Never throws. A failed read still sets the retry: the retry job checks the delivery itself and
  // does nothing if it is offered or taken by then.
  private async ensureBackstopIfStillWaiting(deliveryId: string): Promise<void> {
    try {
      const delivery = await this.deliveryRepository.findById(deliveryId)
      const stillWaiting =
        delivery?.status === EnumDeliveryStatus.ASSIGNING_COURIER && !delivery.matchedCourierId && !delivery.courierId
      if (!stillWaiting) return
    } catch (error) {
      this.logger.error(`Could not check whether delivery ${deliveryId} still waits: ${error}`)
    }
    await this.scheduleNoCourierRetry(deliveryId)
  }

  // Never throws: undoing a skip list entry is cleanup, and its failure only means the rider sits
  // out this one delivery for up to 20 minutes.
  private async undoSkipListEntry(deliveryId: string, courierId: string): Promise<void> {
    try {
      await removeCourierFromRejectedList(this.cacheService, deliveryId, courierId)
    } catch (error) {
      this.logger.error(`Could not take courier ${courierId} off the skip list of ${deliveryId}: ${error}`)
    }
  }

  // For the two upstream test routes (partner `test/:deliveryId/assign-courier`, admin
  // `testing/match-delivery-to-courier`). They used to write matchedCourierId on its own, with no
  // offeredAt, no OFFERED row and no timer; now they run the same offer step as real matching, so
  // the invariant "offeredAt is set if and only if matchedCourierId is set" holds for them too.
  // Returns the rider offered and the delivery, or undefined when nobody is free (which is recorded
  // like any other "nobody free", with its backstop retry).
  async offerWaitingDeliveryNow(deliveryId: string) {
    // The admin test routes offer at once, like a hand offer: no hold (spec 0031).
    const result = await this.offerToNextCourier(deliveryId, { ignoreTiming: true })
    if (result === 'NO_COURIER') {
      await this.recordNoCourierAvailable(deliveryId)
      return undefined
    }
    if (result === 'NOT_WAITING') {
      throw new CantUpdateDeliveryStatusError(`Delivery ${deliveryId} is not waiting for a rider`)
    }
    if (result === 'STOPPED') {
      await this.refuseIfDispatchStopped()
    }

    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    if (!delivery.matchedCourierId) return undefined // answered or moved on in the meantime
    const courier = await this.courierRepository.findByIdOrThrow(delivery.matchedCourierId)
    return { courier, delivery }
  }

  // Spec 0014, AC-4: an admin's hand offer, a reassignment or a test route during a stop answers
  // 409 with when dispatch restarts.
  async refuseIfDispatchStopped(): Promise<void> {
    const now = new Date()
    const stop = await this.dispatchStopRepository.findOn(now)
    if (stop) throw new CantUpdateDeliveryStatusError(adminRefusedMessage(stop, now))
  }

  // Spec 0022, AC-7: an admin's hand offer or a reassignment to a rider whose SOS is active answers
  // 409 with a sentence. The rider is offerable again once the SOS is not active.
  // A check before the write, not part of it (row 73 review): an SOS that starts in the same few
  // milliseconds slips past, and the worst case is an offer the rider lets expire. Accepted as is.
  async refuseIfCourierInSos(courierId: string): Promise<void> {
    if (await this.courierRepository.hasActiveSos(courierId)) {
      throw new CantUpdateDeliveryStatusError(SOS_SENTENCES.courierInSos)
    }
  }

  // Start of a dispatch stop (spec 0014, AC-5, step 1): every open offer ends, its rider told, with
  // no skip list entry. Never throws; returns how many ended.
  async endAllOpenOffersForDispatchStop(message: string): Promise<number> {
    let open: DeliveryEntity[]
    try {
      open = await this.deliveryRepository.findAllOpenOffers()
    } catch (error) {
      this.logger.error(`Could not look up open offers to end for a dispatch stop: ${error}`)
      return 0
    }
    let ended = 0
    for (const delivery of open) {
      if (!delivery.matchedCourierId) continue
      try {
        const done = await this.endOffer({
          deliveryId: delivery.id,
          courierId: delivery.matchedCourierId,
          offeredAt: delivery.offeredAt,
          reason: 'STOPPED',
          message,
        })
        if (done) ended += 1
      } catch (error) {
        this.logger.error(`Could not end the offer of delivery ${delivery.id} for a dispatch stop: ${error}`)
      }
    }
    return ended
  }

  // Start of a dispatch stop (spec 0014, AC-5, step 2): one delivery held before pickup goes back to
  // waiting with nobody. Status and rider change in ONE conditional write on the status and rider
  // that were read, so a pickup (or any step) written first wins and nothing is returned; this is
  // the admin hand offer's pattern (row 29 review). Returns whether THIS call returned it, with the
  // amounts the rider is paid from, so the pay follows this write and never a later read.
  async returnToWaitingForDispatchStop(
    deliveryId: string,
    courierId: string,
    actor: EnumEventActor,
    message: string
  ): Promise<{ returned: false } | { returned: true; totalCompensation: number | null; currencyCode: string }> {
    const delivery = await this.deliveryRepository.findById(deliveryId)
    const returnable: EnumDeliveryStatus[] = [
      EnumDeliveryStatus.ACCEPTED,
      EnumDeliveryStatus.DISPATCHED,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
    ]
    if (!delivery || delivery.courierId !== courierId || !returnable.includes(delivery.status)) {
      return { returned: false }
    }
    const oldStatus = delivery.status
    const written = await this.deliveryRepository.updateIfMatches(
      deliveryId,
      { status: oldStatus, courierId },
      {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        matchedCourierId: null,
        offeredAt: null,
        offerExpiresAt: null,
        acceptedAt: null,
        handBackUntil: null,
      }
    )
    if (!written) return { returned: false }

    // From here the delivery is back to waiting. Each step is guarded, so a failed notification
    // cannot hide the return (the payment still follows).
    const event: DeliveryReturnedToWaitingEvent = {
      deliveryId,
      type: EnumDeliveryEventType.RETURNED_TO_WAITING,
      actor,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId,
      message,
    }
    try {
      await this.saveDeliveryEvent(event, {
        transitionSuccessful: true,
        oldStatus,
        newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      })
    } catch (error) {
      this.logger.error(`Could not record RETURNED_TO_WAITING for delivery ${deliveryId}: ${error}`)
    }
    try {
      const updated = await this.deliveryRepository.findByIdOrThrow(deliveryId)
      if (updated.partnerId) {
        await this.notifyPartner(updated.partnerId, EnumDeliveryStatus.ASSIGNING_COURIER, oldStatus, event)
      }
      // The delivery no longer carries the rider's id, so tell them explicitly. No skip list: the
      // rider did nothing wrong.
      await this.notifyCourier(courierId, updated, EnumDeliveryStatus.ASSIGNING_COURIER, oldStatus, event)
    } catch (error) {
      this.logger.error(`Could not tell the restaurant or rider that delivery ${deliveryId} went back to waiting: ${error}`)
    }
    return { returned: true, totalCompensation: delivery.totalCompensation, currencyCode: delivery.currencyCode }
  }

  // Spec 0020 (AC-6): a rider gives back an order they accepted, inside the free window the caller
  // has checked. The shape of returnToWaitingForDispatchStop: the rider goes on the delivery's skip
  // list FIRST (so a matcher running in between cannot offer it straight back; undone if the write
  // misses), one conditional write on status and rider back to waiting, the event saved outside the
  // state machine's switch, the restaurant and the rider told, then a new offer round (or the no
  // courier spell and its retry). No pay and no charge either way (AC-7). A missed write (a cancel,
  // reassign, dispatch stop or second hand back got there first) is saved as a failed row (value 1).
  async handBack(deliveryId: string, courierId: string, oldStatus: EnumDeliveryStatus): Promise<boolean> {
    let addedToSkipList = false
    try {
      addedToSkipList = await addCourierToRejectedList(this.cacheService, deliveryId, courierId)
    } catch (error) {
      this.logger.error(`Could not put rider ${courierId} on the skip list of delivery ${deliveryId}: ${error}`)
    }

    const written = await this.deliveryRepository.updateIfMatches(
      deliveryId,
      { status: oldStatus, courierId },
      {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        matchedCourierId: null,
        offeredAt: null,
        offerExpiresAt: null,
        acceptedAt: null,
        handBackUntil: null,
      }
    )

    const event: DeliveryHandedBackEvent = {
      deliveryId,
      type: EnumDeliveryEventType.HANDED_BACK,
      actor: EnumEventActor.COURIER,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId,
      // The window's length is a co-op setting, so the message names none (row 71 review).
      message: written ? 'Handed back within the free window' : 'Hand back refused: the order changed first',
    }

    if (!written) {
      if (addedToSkipList) {
        try {
          await removeCourierFromRejectedList(this.cacheService, deliveryId, courierId)
        } catch (error) {
          this.logger.error(`Could not take rider ${courierId} off the skip list of delivery ${deliveryId}: ${error}`)
        }
      }
      try {
        await this.saveDeliveryEvent(event, { transitionSuccessful: false, oldStatus, newStatus: oldStatus })
      } catch (error) {
        this.logger.error(`Could not record the refused HANDED_BACK for delivery ${deliveryId}: ${error}`)
      }
      return false
    }

    try {
      await this.saveDeliveryEvent(event, {
        transitionSuccessful: true,
        oldStatus,
        newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      })
    } catch (error) {
      this.logger.error(`Could not record HANDED_BACK for delivery ${deliveryId}: ${error}`)
    }
    try {
      const updated = await this.deliveryRepository.findByIdOrThrow(deliveryId)
      if (updated.partnerId) {
        await this.notifyPartner(updated.partnerId, EnumDeliveryStatus.ASSIGNING_COURIER, oldStatus, event)
      }
      // The delivery no longer carries the rider's id, so tell them explicitly.
      await this.notifyCourier(courierId, updated, EnumDeliveryStatus.ASSIGNING_COURIER, oldStatus, event)
    } catch (error) {
      this.logger.error(`Could not tell the restaurant or rider that delivery ${deliveryId} was handed back: ${error}`)
    }
    // Straight back to matching; nobody free means the usual no courier spell and retry. The hand
    // back is done whatever happens here: a failure is logged and the backstop sweep still finds
    // the waiting delivery, so the rider is never answered 500 for an order they gave back (row 71
    // review).
    try {
      await this.offerOrWait(deliveryId)
    } catch (error) {
      this.logger.error(`Could not start matching after delivery ${deliveryId} was handed back: ${error}`)
    }
    return true
  }

  // End of a dispatch stop (spec 0014, AC-4): every waiting delivery, oldest first, gets an offer or
  // a recorded "nobody free" with its backstop. Not matchWaitingDeliveries, which offers one only.
  async matchAllWaitingDeliveriesAfterStop(): Promise<void> {
    let waitingIds: string[]
    try {
      waitingIds = await this.deliveryRepository.findIdsWaitingForCourierOldestFirst()
    } catch (error) {
      this.logger.error(`Could not look up waiting deliveries after a dispatch stop: ${error}`)
      return
    }
    for (const deliveryId of waitingIds) {
      await this.offerOrWait(deliveryId)
    }
  }

  // An accept that took the offer and then did not go through gives the offer back with its old
  // deadline (DeliveryDomainService.acceptDelivery). The expiry job may have run meanwhile, found
  // the offer taken and done nothing, so a new timer is set for the same deadline; a deadline that
  // has already passed ends the offer after the grace. Two timers for one offer are harmless: the
  // second finds the offer gone and does nothing. Never throws.
  async rearmOfferExpiry(deliveryId: string, courierId: string, offeredAt: Date, offerExpiresAt: Date) {
    await this.scheduleOfferExpiry(
      deliveryId,
      courierId,
      offeredAt,
      offerExpiresAt.getTime() - Date.now(),
      `-rearm-${Date.now()}`
    )
  }

  // After a triggering event: offer to the next rider, or record that nobody is free and set the
  // backstop timer.
  async offerOrWait(deliveryId: string): Promise<void> {
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

    // STOPPED records nothing and arms no backstop: the end of the stop matches it again.
    if (result === 'NO_COURIER') {
      await this.recordNoCourierAvailable(deliveryId)
    }
  }

  // The one "offer to the next rider" step, shared by the ASSIGNING_COURIER case, the backstop
  // retry and a rider becoming free. Amounts are worked out first; only when they succeed is the
  // offer written, in one conditional update with its start time and deadline, so a failure can
  // never leave an offer with no timer behind (flow 1).
  private async offerToNextCourier(
    deliveryId: string,
    options: { ignoreTiming?: boolean } = {}
  ): Promise<OfferStepResult> {
    // The one gate for every automatic offer (spec 0014, AC-4): while dispatch is stopped, nobody is
    // offered anything. The end of the stop matches every waiting delivery again.
    if (await this.dispatchStopRepository.findOn(new Date())) {
      this.logger.log(`Dispatch is stopped; delivery ${deliveryId} waits`)
      return 'STOPPED'
    }

    const match = await this.deliveryMatchingService.findCourierForDelivery(deliveryId)
    if (!match) {
      this.logger.log(`No courier found for delivery ${deliveryId}`)
      return 'NO_COURIER'
    }
    const { courier } = match

    // No matcher offers work to a rider in an active SOS (spec 0022, AC-7; decision 73.11). The two
    // automatic matchers already leave such riders out in their SQL; this one check also covers the
    // STATIC matcher, which returns its configured rider without asking whether they are free. The
    // delivery then waits as if no rider were free, and the backstop retry tries again.
    if (await this.courierRepository.hasActiveSos(courier.id)) {
      this.logger.log(`Courier ${courier.id} has an active SOS; delivery ${deliveryId} is not offered to them`)
      return 'NO_COURIER'
    }

    // Spec 0031: with offers timed, hold this one until the chosen rider needs to leave. Checked here,
    // after the rider is chosen, so every path that offers passes through it (as the dispatch stop
    // above does), and each try chooses the rider and the time afresh.
    const timing =
      options.ignoreTiming === true ? { dueInMs: 0, note: '' } : await this.offerTimingOf(match)
    if (timing.dueInMs > 0) {
      const retrySeconds = await this.configDomainService.instanceConfig.getNoCourierRetrySeconds()
      // At most one retry period away, so a setting switched off or a rider coming free counts soon.
      // `Math.ceil`: road times are fractional and the job's delay is whole milliseconds.
      const delayMs = Math.ceil(Math.min(timing.dueInMs, retrySeconds * 1000))
      await this.scheduleNoCourierRetry(deliveryId, delayMs)
      this.logger.log(`Delivery ${deliveryId} is held; looking again in ${Math.round(delayMs / 1000)} s`)
      return 'NOT_DUE'
    }

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

    // A stop that began while this matching ran has already ended the open offers it could see, so
    // this one would survive it: look again, and take the claim back (row 29 review).
    if (await this.dispatchStopRepository.findOn(new Date())) {
      await this.deliveryRepository.updateIfMatches(
        deliveryId,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: courier.id, offeredAt, courierId: null },
        { matchedCourierId: null, offeredAt: null, offerExpiresAt: null }
      )
      this.logger.log(`Dispatch stopped while delivery ${deliveryId} was being offered; offer taken back`)
      return 'STOPPED'
    }

    this.logger.log(`Delivery ${deliveryId} is being offered to courier: ${courier.id}`)

    // From here the offer is written. Each step below is guarded on its own, so one failing cannot
    // skip the others, above all the expiry timer, which is what ends an offer nobody answers.
    try {
      await this.saveOfferedEvent(deliveryId, courier.id, EnumEventActor.SYSTEM, offerExpiresAt, null, timing.note)
    } catch (error) {
      this.logger.error(`Could not record OFFERED for delivery ${deliveryId}: ${error}`, (error as Error).stack)
    }

    if (expirySeconds !== null) {
      await this.scheduleOfferExpiry(deliveryId, courier.id, offeredAt, expirySeconds * 1000)
    }
    await this.removeNoCourierRetry(deliveryId)

    try {
      const updatedDelivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)
      this.logger.log(`Sending offer to courier: ${courier.id}`)
      await this.sendOfferToRider(courier, updatedDelivery)
    } catch (error) {
      // The phone still finds the offer on its next fetch of new deliveries.
      this.logger.error(`Could not send the offer of ${deliveryId} to courier ${courier.id}: ${error}`)
    }
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
  // `replacedCourierId` names the rider whose open offer an admin moved to this one, so the timeline
  // shows that offer ending without an OFFER_EXPIRED, which would read as the rider's miss.
  private async saveOfferedEvent(
    deliveryId: string,
    courierId: string,
    actor: EnumEventActor,
    offerExpiresAt: Date | null,
    replacedCourierId: string | null = null,
    timingNote = ''
  ): Promise<void> {
    const deadline = offerExpiresAt ? `answer by ${offerExpiresAt.toISOString()}` : 'no deadline'
    const replaced = replacedCourierId ? `; moved by an admin from the open offer to courier ${replacedCourierId}` : ''
    const offeredEvent: DeliveryOfferedEvent = {
      deliveryId,
      type: EnumDeliveryEventType.OFFERED,
      actor,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId,
      message: `Offered to courier ${courierId}, ${deadline}${replaced}${timingNote}`,
    }
    await this.saveDeliveryEvent(offeredEvent, {
      transitionSuccessful: true,
      oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
    })
  }

  // Spec 0031, AC-2, AC-5, AC-6: when this offer is due, and what its event says. Never throws, and
  // never carries a coordinate into the note or a log line (value 5): a route that cannot be worked
  // out means the offer goes now and says so, so a delivery is never stuck waiting on the router.
  private async offerTimingOf(match: {
    courier: { id: string }
    delivery: { readyAt: Date | null; foodReadyAt: Date | null }
    pickupLocation: { latitude: number; longitude: number }
    travelSeconds?: number | null
  }): Promise<OfferTiming> {
    const config = this.configDomainService.instanceConfig
    if (!(await config.getOfferTimingEnabled())) return { dueInMs: 0, note: '' }
    const readyTime = match.delivery.foodReadyAt ?? match.delivery.readyAt
    if (!readyTime) return { dueInMs: 0, note: '' }

    // Only asked when the matcher did not work it out. A null from the matcher already means no route.
    const travelSeconds =
      match.travelSeconds !== undefined
        ? match.travelSeconds
        : await this.roadSecondsToPickup(match.courier.id, match.pickupLocation)
    if (travelSeconds === null) return { dueInMs: 0, note: `, ready ${clock(readyTime)}, travel unknown` }

    const leadMinutes = await config.getOfferLeadMinutes()
    const dueAt = readyTime.getTime() - travelSeconds * 1000 - leadMinutes * 60_000
    return {
      dueInMs: dueAt - Date.now(),
      note: `, ready ${clock(readyTime)}, travel ~${Math.round(travelSeconds / 60)} min, lead ${leadMinutes} min`,
    }
  }

  private async roadSecondsToPickup(
    courierId: string,
    pickupLocation: { latitude: number; longitude: number }
  ): Promise<number | null> {
    try {
      const fromLocation = await this.courierRepository.getCurrentLocation(courierId)
      if (!fromLocation) return null
      const route = await this.osrmRoutingService.getRoute({ fromLocation, toLocation: pickupLocation })
      return route.durationSeconds
    } catch (error) {
      this.logger.warn(`No route for courier ${courierId} to the pickup: ${(error as Error).message}`)
      return null
    }
  }

  // CANCELED or FAILED (flow 7): an open offer ends with the status change and the backstop goes.
  // A pending offer-expiry job finds the status changed and does nothing. If a rider was working the
  // delivery, they are free again.
  // Spec 0015. The CANCELED status write is conditional on the status and rider read when the event
  // came in (AC-14): a drop off, a pickup, a reassignment or another cancel that got there first
  // makes it miss, the throw below makes processDeliveryEvent save a failed transition, and nothing
  // is paid or charged. When it lands, cancelledFromStatus is truly where the cancellation came from.
  private async cancelDelivery(dbDelivery: DeliveryEntity, deliveryEvent: DeliveryEvent, oldStatus: EnumDeliveryStatus) {
    const cancelledBy =
      deliveryEvent.type === EnumDeliveryEventType.CANCELED && deliveryEvent.cancelledBy
        ? deliveryEvent.cancelledBy
        : EnumCancelledBy.COOP
    const clearOffer =
      oldStatus === EnumDeliveryStatus.ASSIGNING_COURIER
        ? { matchedCourierId: null, offeredAt: null, offerExpiresAt: null }
        : {}
    // The pay rule in force now, kept with the cancellation (decision 32.18), so an award the sweep
    // writes later pays under it even if a representative saves another rule meanwhile. A read that
    // fails never stops the cancel: the award then reads the rule when it is written, as before.
    let cancellationPayoutPolicy: string | null = null
    try {
      cancellationPayoutPolicy = await this.configDomainService.instanceConfig.getCancellationPayoutPolicy()
    } catch (error) {
      this.logger.warn(`Could not read cancellationPayoutPolicy while cancelling ${dbDelivery.id}: ${error}`)
    }

    const written = await this.deliveryRepository.updateIfMatches(
      dbDelivery.id,
      { status: oldStatus, courierId: dbDelivery.courierId },
      {
        status: EnumDeliveryStatus.CANCELED,
        cancelledBy,
        cancelledFromStatus: oldStatus,
        cancelledAt: new Date(),
        cancellationPayoutPolicy,
        ...clearOffer,
        // Spec 0020 (AC-2): a cancelled order can no longer be handed back.
        acceptedAt: null,
        handBackUntil: null,
      }
    )
    if (!written) {
      throw new CantUpdateDeliveryStatusError(
        `Delivery ${dbDelivery.id} changed while it was being cancelled (it was ${oldStatus}); the cancellation did not take`
      )
    }

    await this.saveDeliveryEvent(deliveryEvent, {
      transitionSuccessful: true,
      oldStatus,
      newStatus: EnumDeliveryStatus.CANCELED,
    })

    // From here the delivery is cancelled. Each step below is guarded: none may undo that or skip
    // the next. The pay comes before the rider is told, so the card can show the amount at once.
    await this.settleCancellation(dbDelivery.id)

    try {
      const updated = await this.deliveryRepository.findByIdOrThrow(dbDelivery.id)
      if (updated.partnerId) {
        await this.notifyPartner(updated.partnerId, EnumDeliveryStatus.CANCELED, oldStatus, deliveryEvent)
      }
      if (updated.courierId) {
        await this.notifyCourier(updated.courierId, updated, EnumDeliveryStatus.CANCELED, oldStatus, deliveryEvent)
      }
    } catch (error) {
      this.logger.error(`Could not tell the restaurant or rider that delivery ${dbDelivery.id} was cancelled: ${error}`)
    }
    if (dbDelivery.courierId && DELIVERY_ONGOING_STATUSES.includes(oldStatus)) {
      // The rider's phone: an alert of its own even when the app is closed (AC-7). Fire and forget.
      this.offerPushService.jobCancelled(dbDelivery.courierId, dbDelivery.id)
    }
    // A rider offered it but not yet holding it drops the offer now, rather than ringing until the
    // expiry job finds the status changed (row 32 review). Not their miss: MOVED, no skip list.
    if (oldStatus === EnumDeliveryStatus.ASSIGNING_COURIER && dbDelivery.matchedCourierId) {
      try {
        const offeredCourier = await this.courierRepository.findById(dbDelivery.matchedCourierId)
        if (offeredCourier) {
          await this.sendOfferEndedToRider(offeredCourier, { deliveryId: dbDelivery.id, reason: 'MOVED' })
        }
      } catch (error) {
        this.logger.error(`Could not end the open offer of cancelled delivery ${dbDelivery.id}: ${error}`)
      }
    }

    await this.removeNoCourierRetry(dbDelivery.id)
    if (dbDelivery.courierId) {
      await this.matchWaitingDeliveries()
    }
  }

  // Spec 0015. Pays the rider and charges the restaurant for a cancellation that came after a rider
  // accepted, whichever of the two is still missing. Safe to call any number of times (the inline
  // call above and the minute sweep): each half is written once. Never throws.
  async settleCancellation(deliveryId: string): Promise<void> {
    let delivery: DeliveryEntity | null
    try {
      delivery = await this.deliveryRepository.findById(deliveryId)
    } catch (error) {
      this.logger.error(`CANCELLATION_SETTLE_FAILED {"deliveryId":"${deliveryId}"}: ${error}`)
      return
    }
    if (
      !delivery ||
      !delivery.cancelledAt ||
      !delivery.cancelledFromStatus ||
      !DELIVERY_ONGOING_STATUSES.includes(delivery.cancelledFromStatus)
    ) {
      return
    }
    if (delivery.courierId) {
      await this.awardCancellationPay(delivery, delivery.courierId)
    } else {
      // Should not happen (a rider is set on accept); say so rather than leave it quietly unpaid.
      this.logger.warn(
        `Delivery ${delivery.id} was cancelled from ${delivery.cancelledFromStatus} with no rider: no cancellation pay`
      )
    }
    if (delivery.cancelledBy === EnumCancelledBy.RESTAURANT) {
      await this.chargePartnerForCancellation(delivery)
    }
  }

  // Two halves, each written only if missing: the CourierCompensation row (unique by delivery), then
  // its COURIER_PAID_FOR_CANCELLATION event, which reads what the row paid (AC-1, AC-2). Never throws:
  // a failure is logged with ids and amount only, and the sweep completes the missing half (AC-10).
  private async awardCancellationPay(delivery: DeliveryEntity, courierId: string): Promise<void> {
    const logContext: Record<string, string | number | null> = {
      deliveryId: delivery.id,
      courierId,
      amount: null,
      policy: null,
    }
    try {
      let award = await this.courierCompensationRepository.findCancellationAward(delivery.id)
      if (!award) {
        const menu = await this.configDomainService.instanceConfig.getReassignmentPayoutPolicies()
        // The rule in force at the cancellation (decision 32.18); a delivery cancelled before that
        // column existed, or whose read failed, falls back to the rule in force now.
        const storedPolicy =
          delivery.cancellationPayoutPolicy ??
          (await this.configDomainService.instanceConfig.getCancellationPayoutPolicy())
        const { policy, amount, warnings } = resolveCancellationPayout(menu, storedPolicy, delivery.totalCompensation)
        logContext.amount = amount
        logContext.policy = policy
        for (const warning of warnings) {
          this.logger.warn(`Cancellation pay for delivery ${delivery.id}: ${warning}`)
        }
        award = await this.courierCompensationRepository.createCancellationAwardOnce({
          amount,
          currencyCode: delivery.currencyCode,
          reason: EnumCourierCompensationReason.CANCELLATION,
          policy,
          message: `Paid for a job cancelled by ${delivery.cancelledBy ?? EnumCancelledBy.COOP}`,
          courierId,
          deliveryId: delivery.id,
          cancellationOf: delivery.id,
        })
      }
      logContext.amount = award.amount
      logContext.policy = award.policy

      // Check, then write: safe with one worker (BullMQ runs the sweep one job at a time, and the
      // sweep leaves the newest minute to this inline call). A second backend instance would want a
      // unique key on the event, due with the payments rows (row 32 review).
      const paidEvent = await this.deliveryEventRepository.findLatestOfTypes(delivery.id, [
        EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION,
      ])
      if (!paidEvent) {
        const event: DeliveryCourierPaidForCancellationEvent = {
          deliveryId: delivery.id,
          type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION,
          actor: EnumEventActor.SYSTEM,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId: award.courierId,
          message:
            `Courier ${award.courierId} paid ${award.amount} ${award.currencyCode} (cents) under ${award.policy} ` +
            `for cancellation by ${delivery.cancelledBy ?? EnumCancelledBy.COOP}`,
        }
        await this.recordCancellationEvent(event, delivery.status)
      }
    } catch (error) {
      this.logger.error(`CANCELLATION_PAYOUT_FAILED ${JSON.stringify(logContext)}: ${error}`, (error as Error).stack)
    }
  }

  // A restaurant's own cancellation after a rider accepted is charged to it, the delivery's price
  // (AC-6). Written once; never throws.
  private async chargePartnerForCancellation(delivery: DeliveryEntity): Promise<void> {
    if (!delivery.partnerId) {
      this.logger.warn(`Delivery ${delivery.id} was cancelled by the restaurant but has no partner: no charge recorded`)
      return
    }
    const amount = delivery.totalCost ?? 0
    try {
      if (await this.partnerChargeRepository.findByDeliveryId(delivery.id)) return
      if (delivery.totalCost === null) {
        this.logger.warn(`Delivery ${delivery.id} has no totalCost: the restaurant's cancellation charge is 0`)
      }
      await this.partnerChargeRepository.createOnce({
        partnerId: delivery.partnerId,
        deliveryId: delivery.id,
        amount,
        currencyCode: delivery.currencyCode,
        reason: EnumPartnerChargeReason.CANCELLATION,
      })
    } catch (error) {
      this.logger.error(
        `CANCELLATION_CHARGE_FAILED ${JSON.stringify({ deliveryId: delivery.id, partnerId: delivery.partnerId, amount })}: ${error}`,
        (error as Error).stack
      )
    }
  }

  // Spec 0015. Records a cancellation event (the pay, a food outcome) on a delivery whose status does
  // not change: never through processDeliveryEvent, which would drop it (no legal transition). The
  // status is CANCELED, or FAILED if the cancelled delivery has failed since.
  async recordCancellationEvent(
    event: DeliveryCourierPaidForCancellationEvent | DeliveryFoodReturnedEvent | DeliveryFoodNotReturnedEvent,
    status: EnumDeliveryStatus
  ): Promise<void> {
    await this.saveDeliveryEvent(event, { transitionSuccessful: true, oldStatus: status, newStatus: status })
  }

  // Spec 0016. Records a rider's drop off pin move: no status change, so never through
  // processDeliveryEvent (which would drop it). Old and new status are both the current one.
  async recordDropoffPointCorrectedEvent(
    event: DeliveryDropoffPointCorrectedEvent,
    status: EnumDeliveryStatus
  ): Promise<void> {
    await this.saveDeliveryEvent(event, { transitionSuccessful: true, oldStatus: status, newStatus: status })
  }

  // Spec 0023. Records the restaurant's delay or food ready: no status change, so never through
  // processDeliveryEvent (which would drop it). No courierId: the restaurant acted, not a rider.
  async recordReadyEvent(
    event: DeliveryReadyDelayedEvent | DeliveryFoodReadyEvent,
    status: EnumDeliveryStatus
  ): Promise<void> {
    await this.saveDeliveryEvent(event, { transitionSuccessful: true, oldStatus: status, newStatus: status })
  }

  // Spec 0023 (AC-6): tells the rider holding this job, if any, over the live connection and by push.
  // Never throws: the restaurant's action already happened and is on the record.
  async notifyReadyUpdated(delivery: DeliveryEntity, delayMinutes: number | null): Promise<void> {
    if (!delivery.courierId) return
    const message: JobReadyUpdatedMessage = {
      deliveryId: delivery.id,
      restaurantName: delivery.pickupBusinessName,
      readyAt: delivery.readyAt ? delivery.readyAt.toISOString() : null,
      foodReadyAt: delivery.foodReadyAt ? delivery.foodReadyAt.toISOString() : null,
      delayMinutes,
    }
    try {
      const courier = await this.courierRepository.findById(delivery.courierId)
      if (courier?.userId) {
        await this.websocketDispatcher.sendJobReadyUpdated(courier.userId, message)
      }
    } catch (error) {
      this.logger.error(`Could not tell the rider of delivery ${delivery.id} its ready time changed: ${error}`)
    }
    this.offerPushService.jobReadyUpdated(delivery.courierId, message)
  }

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

  // Every new offer reaches the rider through these two (spec 0003): the live connection first, then
  // push to their phones. Push is started, not awaited, so Google being slow or down never delays
  // or undoes an offer (AC-2). `finally` starts it even if the socket send threw, since a locked
  // phone is exactly the one the socket cannot reach.
  private async sendOfferToRider(courier: { id: string; userId: string }, delivery: DeliveryEntity) {
    try {
      await this.websocketDispatcher.sendOfferToCourier(courier.userId, new DeliveryCourierDto(delivery))
    } finally {
      this.offerPushService.newOffer(courier.id, delivery.id)
    }
  }

  // An offer ended on the server: the open app drops it, and the alert on a locked phone stops (AC-6).
  private async sendOfferEndedToRider(courier: { id: string; userId: string }, message: OfferEndedMessage) {
    try {
      await this.websocketDispatcher.sendOfferEnded(courier.userId, message)
    } finally {
      this.offerPushService.offerEnded(courier.id, message)
    }
  }

  // Timer helpers. A failure to talk to Redis is logged, never thrown: it must not undo an offer
  // or a status change that already happened. Without its timer an offer rings on like expiry off.
  // `untilDeadlineMs` is the time left until the offer's deadline; the job runs the network grace
  // after it. `jobIdSuffix` gives a re-armed timer an id of its own, because BullMQ ignores an add
  // whose id is still in the queue (the first job may be running at that very moment).
  private async scheduleOfferExpiry(
    deliveryId: string,
    courierId: string,
    offeredAt: Date,
    untilDeadlineMs: number,
    jobIdSuffix = ''
  ) {
    try {
      await this.bullMQService.addJob<OfferExpiryJobPayload>(
        'offer-expiry',
        { deliveryId, courierId, offeredAt: offeredAt.toISOString() },
        {
          delay: Math.max(0, untilDeadlineMs) + OFFER_EXPIRY_GRACE_SECONDS * 1000,
          jobId: `${offerExpiryJobId(deliveryId, offeredAt)}${jobIdSuffix}`,
        }
      )
    } catch (error) {
      this.logger.error(`Could not set the expiry timer of delivery ${deliveryId}: ${error}`)
    }
  }

  // Remove, then add: at most one backstop is pending per delivery, whatever triggered it. The id
  // carries the time because BullMQ ignores an add whose id still exists, and the job that calls
  // this from its own handler still exists while it runs.
  // A failed remove does not stop the add: an extra pending retry is harmless (it finds the delivery
  // offered and does nothing, and the next remove cleans it up), a missing one leaves it stuck.
  // `delayMs`: a held offer's next look (spec 0031); without it, the co-op's retry period.
  private async scheduleNoCourierRetry(deliveryId: string, delayMs?: number) {
    await this.removeNoCourierRetry(deliveryId)
    try {
      const delay = delayMs ?? (await this.configDomainService.instanceConfig.getNoCourierRetrySeconds()) * 1000
      await this.bullMQService.addJob<NoCourierRetryJobPayload>(
        'no-courier-retry',
        { deliveryId },
        { delay, jobId: `${noCourierRetryJobIdPrefix(deliveryId)}${Date.now()}` }
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
    // Decision 32.17 (row 32 review): conditional on the status read when the event came in, like
    // the cancel. A rider's drop off that lost the race to a paid cancellation must not land on top
    // of it (paid twice, a restaurant charged for a delivered order). A miss throws, and
    // processDeliveryEvent saves a failed transition, as for any event with no legal move.
    const written = await this.deliveryRepository.updateIfMatches(
      deliveryEvent.deliveryId,
      { status: oldStatus },
      { status: newStatus, ...additionalDeliveryData }
    )
    if (!written) {
      throw new CantUpdateDeliveryStatusError(
        `Delivery ${deliveryEvent.deliveryId} changed while ${deliveryEvent.type} was being applied (it was ${oldStatus}); the step did not take`
      )
    }
    const updatedDelivery = await this.deliveryRepository.findByIdOrThrow(deliveryEvent.deliveryId)

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

  private async notifyPartner(
    userId: string,
    newStatus: EnumDeliveryStatus,
    oldStatus: EnumDeliveryStatus,
    event: DeliveryEvent
  ) {
    if (EVENTS_NOT_SENT_TO_PARTNERS.includes(event.type)) return

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
    // Spec 0015 adds the three cancellation records, which are each about one rider; spec 0016 the
    // rider's drop off pin move.
    const riderId =
      deliveryEvent.type === EnumDeliveryEventType.OFFERED ||
      deliveryEvent.type === EnumDeliveryEventType.OFFER_EXPIRED ||
      deliveryEvent.type === EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION ||
      deliveryEvent.type === EnumDeliveryEventType.FOOD_RETURNED ||
      deliveryEvent.type === EnumDeliveryEventType.FOOD_NOT_RETURNED ||
      deliveryEvent.type === EnumDeliveryEventType.DROPOFF_POINT_CORRECTED ||
      deliveryEvent.type === EnumDeliveryEventType.HANDED_BACK
        ? deliveryEvent.courierId
        : undefined

    return await this.deliveryEventRepository.create({
      ...(riderId !== undefined ? { courierId: riderId } : {}),
      // A step that waited for signal keeps its tap time, on the success row and the failed row
      // alike (spec 0009, AC-7). Left out, the column default (now) records the arrival.
      ...(deliveryEvent.occurredAt ? { occurredAt: deliveryEvent.occurredAt } : {}),
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

  async schedulePickupDeliveryFulfillAndCapture(deliveryId: string) {
    const date = new Date(Date.now() + PICKUP_ORDER_FORCED_FULFILL_DELAY_MINUTES * 60 * 1000)

    this.logger.log(`Scheduling ${deliveryId} order pickup fulfillment ${date}`)
    await this.taskScheduler.scheduleTask<ForcePickupFulfillmentPayload>('schedule-force-pickup-fulfillment', date, {
      deliveryId,
    })
  }
}
