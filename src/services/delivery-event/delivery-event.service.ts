import { OfferReasonRepository } from 'src/persistence/repositories/offer-reason.repository'
import { RIDER_DEACTIVATED_SENTENCE } from 'src/domains/courier/account-upkeep'
import { SIBLING_LEG_HELD_SENTENCE } from 'src/domains/delivery/legs'
import {
  MAX_DELIVERIES_HELD,
  THIRD_DELIVERY_REFUSED_SENTENCE,
  stackPairBlockKey,
  stackStopsOf,
  stopParts,
} from 'src/domains/delivery/stack'
import { TwoOrderService, StackPlan, AddOnPlan } from 'src/services/two-order/two-order.service'
import { addOnFigures, addOnJobIdOf, addOnPart } from 'src/domains/delivery/add-on'
import { randomUUID } from 'crypto'
import { OfferReasonInput, addOnOfferReason, adminOfferReason, stackOfferReason } from 'src/domains/matching/offer-reason'
import { BoxOverCapacityException } from 'src/errors'
import type {
  DeliveryFoodReadyEvent,
  DeliveryProductReportedEvent,
  DeliveryProductReportResolvedEvent,
  DeliveryReadyDelayedEvent,
} from 'src/shared-types/delivery-events'
import type {
  DeliverySplitClosedEvent,
  DeliverySplitEvent,
  DeliveryPartnerSplitChargeVoidedEvent,
} from 'src/shared-types/delivery-events'
import { splitWaitMinutes } from 'src/domains/split/split'
import { SplitRequestRepository } from 'src/persistence/repositories/split-request.repository'
import type {
  JobReadyUpdatedMessage,
  RemovalRequestDecidedMessage,
  SplitRequestDecidedMessage,
} from 'src/shared-types/notification'
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { OnEvent } from '@nestjs/event-emitter'
import { ConfigService } from '@nestjs/config'
import {
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumCancelledBy,
  EnumCourierCompensationReason,
  EnumPartnerChargeReason,
  EnumFoodOutcome,
  EnumRemovalRequestStatus,
  EnumSplitRequestStatus,
  CourierCompensation,
  DeliveryRemovalRequest,
  Prisma,
} from '@prisma/types'
import {
  DeliveryAcceptedEvent,
  DeliveryConfirmedEvent,
  DeliveryEvent,
  DeliveryRejectedEvent,
  DeliveryNoCourierAvailableEvent,
  DeliveryOfferedEvent,
  DeliveryOfferExpiredEvent,
  DeliveryReturnedToWaitingEvent,
  DeliveryHandedBackEvent,
  DeliveryCourierPaidForCancellationEvent,
  DeliveryCourierPaidForWaitEvent,
  DeliveryWaitUndispatchedEvent,
  DeliveryRemovalApprovedEvent,
  DeliveryRemovalEvent,
  DeliveryCourierPaidForRemovalEvent,
  DeliveryPartnerChargedForRemovalEvent,
  DeliveryCourierPaidForReturnTripEvent,
  DeliveryFoodReturnedEvent,
  DeliveryDropoffPointCorrectedEvent,
  DeliveryBoxEvent,
  DeliveryFoodNotReturnedEvent,
  DELIVERY_ONGOING_STATUSES,
  OfferEndedMessage,
  OfferEndedReason,
  STATE_MACHINE,
} from 'src/shared-types/index'
import { NEST_DELIVERY_EVENT_NAME } from './delivery-event.type'
import {
  CantUpdateDeliveryStatusError,
  DispatchStoppedError,
  DeliveryNotFoundException,
  DeliveryOfferAlreadyMatchedException,
  InconsistentDataError,
  OfferHasEndedException,
} from '../../errors'
import {
  DEFAULT_HAND_BACK_SECONDS,
  OFFER_EXPIRY_GRACE_SECONDS,
  PICKUP_ORDER_FORCED_FULFILL_DELAY_MINUTES,
  STACK_ACCEPT_GIVE_UP_MS,
  STACK_PAIR_BLOCK_SECONDS,
} from '../../constants'
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
import { CourierMatch, DeliveryMatchingService } from '../delivery-matching/delivery-matching.service'
import { DeliveryCalculationService } from '../delivery-calculation/delivery-calculation.service'
import { IDeliveryAmountsCalculationsResult } from '../delivery-calculation/interfaces/IDeliveryAmountsCalculationsResult'
import { DeliveryCourierDto } from 'src/rest-api/delivery/courier/dtos/delivery.courier.dto'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { CacheService } from '../cache/cache.service'
import { addCourierToRejectedList, removeCourierFromRejectedList } from '../cache/rejected-couriers'
import { OfferPushService } from '../pushNotification/offer-push.service'
import { occurredAtForTap, TAP_AGE_WORTH_A_LOOK_MS } from 'src/domains/delivery-event/utils/occurred-at.util'
import { DispatchStopRepository } from 'src/persistence/repositories/dispatch-stop.repository'
import { adminRefusedSentence } from 'src/domains/dispatch-stop/dispatch-stop-time'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'
import { PartnerChargeRepository } from 'src/persistence/repositories/partner-charge.repository'
import { resolveCancellationPayout } from 'src/domains/delivery/utils/cancellation-payout.util'
import { eventLogLine } from 'src/domains/delivery-event/utils/event-log-line'
import { latestCompletedWait, paidWaitMinutes, splitWindowsUntil, waitOfKey } from 'src/domains/delivery/wait-pay'
import { RemovalRequestRepository } from 'src/persistence/repositories/removal-request.repository'
import { roundMoney } from 'src/core/utils/money'
import { EventText, eventPart, eventText, storedEventText } from 'src/domains/delivery-event/event-text'
import { EventPart } from 'src/shared-types/event-messages'
import { describeErrorForLog, errorSummaryForLog } from 'src/utils/errorForLog'

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

// Spec 0035: every removal event is written by its own path, never processed as an ordinary event.
// An admin cannot post one through the event route.
const REMOVAL_EVENT_TYPES: EnumDeliveryEventType[] = [
  EnumDeliveryEventType.REMOVAL_REQUESTED,
  EnumDeliveryEventType.REMOVAL_WITHDRAWN,
  EnumDeliveryEventType.REMOVAL_DECLINED,
  EnumDeliveryEventType.REMOVAL_APPROVED,
  EnumDeliveryEventType.COURIER_PAID_FOR_REMOVAL,
  EnumDeliveryEventType.PARTNER_CHARGED_FOR_REMOVAL,
  EnumDeliveryEventType.COURIER_PAID_FOR_RETURN_TRIP,
]

// Spec 0038: the review events are written by the review request's own transaction, with null
// statuses. An admin cannot post one through the event route either.
const REVIEW_EVENT_TYPES: EnumDeliveryEventType[] = [
  EnumDeliveryEventType.REVIEW_REQUESTED,
  EnumDeliveryEventType.REVIEW_ANSWERED,
  EnumDeliveryEventType.COURIER_PAID_FOR_REVIEW,
]

// Spec 0047: the split events are written by SplitRequestService and the close below, never processed as
// ordinary events. An admin cannot post one through the event route.
export const SPLIT_EVENT_TYPES: EnumDeliveryEventType[] = [
  EnumDeliveryEventType.SPLIT_REQUESTED,
  EnumDeliveryEventType.SPLIT_CONFIRMED,
  EnumDeliveryEventType.SPLIT_REFUSED,
  EnumDeliveryEventType.SPLIT_CLOSED,
  EnumDeliveryEventType.PARTNER_CHARGED_FOR_SPLIT,
  EnumDeliveryEventType.PARTNER_SPLIT_CHARGE_VOIDED,
]

// Spec 0043: the box events are written by recordBoxEvent only, with no status change. Refused on
// the event route, so an admin cannot post one and have it dropped silently.
export const BOX_EVENT_TYPES: EnumDeliveryEventType[] = [
  EnumDeliveryEventType.BOX_SIZE_ASSUMED,
  EnumDeliveryEventType.BOX_SIZE_CHANGED,
  EnumDeliveryEventType.BOX_OVER_CAPACITY_CONFIRMED,
]

// What one try at offering a delivery came to. NOT_WAITING: someone else offered or took it first.
// STOPPED: dispatch is stopped (spec 0014); no offer is made and nothing is recorded or retried.
type OfferStepResult = 'OFFERED' | 'NO_COURIER' | 'NOT_WAITING' | 'STOPPED' | 'NOT_DUE'

// What the timing check of one offer came to (spec 0031): how long to hold it, and the words the
// OFFERED event adds. `note` is empty when the offer is not a timed one.
// `note`: what the OFFERED record says about the timing, as parts of its message (spec 0054).
type OfferTiming = { dueInMs: number; note: EventPart[] }

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
    private readonly partnerChargeRepository: PartnerChargeRepository,
    // Spec 0035: closes an open removal request whatever ends the rider's job.
    private readonly removalRequestRepository: RemovalRequestRepository,
    // Spec 0044 (decision 12.6): last and optional for TypeScript only, so tests that build this service
    // with the older argument list still compile; Nest always injects it (the persistence module is global).
    private readonly offerReasonRepository?: OfferReasonRepository,
    // Spec 0047: optional for the same reason; closes an open split request whatever ends the rider's job.
    private readonly splitRequestRepository?: SplitRequestRepository,
    // Spec 0048: optional for the same reason; pairs a second waiting delivery into a stacked offer. Without
    // it every offer is a single one, as before stacks existed.
    private readonly twoOrderService?: TwoOrderService
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

      if (REMOVAL_EVENT_TYPES.includes(deliveryEvent.type)) {
        // Spec 0035: before the check below, so an admin's post is refused on the record even where
        // the state machine has no row for it. Thrown here, the catch saves a failed row.
        throw new CantUpdateDeliveryStatusError(`${deliveryEvent.type} is recorded by a removal request only`)
      }
      if (REVIEW_EVENT_TYPES.includes(deliveryEvent.type)) {
        throw new CantUpdateDeliveryStatusError(`${deliveryEvent.type} is recorded by a review request only`)
      }
      if (BOX_EVENT_TYPES.includes(deliveryEvent.type)) {
        throw new CantUpdateDeliveryStatusError(`${deliveryEvent.type} is recorded by the box model only`)
      }
      if (SPLIT_EVENT_TYPES.includes(deliveryEvent.type)) {
        throw new CantUpdateDeliveryStatusError(`${deliveryEvent.type} is recorded by a split request only`)
      }

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
            text: eventText('TAP_TOO_LATE', { fromStatus: currentStatus, eventType: deliveryEvent.type }),
          })
        }
        return
      }

      if (deliveryEvent.type === EnumDeliveryEventType.HANDED_BACK) {
        // Spec 0020: written only by handBack, in one conditional write with its status.
        throw new CantUpdateDeliveryStatusError('HANDED_BACK is recorded by a rider hand back only')
      }

      if (deliveryEvent.type === EnumDeliveryEventType.WAIT_UNDISPATCHED) {
        // Spec 0033: written only by leaveWait, after the limit is checked, so an admin cannot post it.
        throw new CantUpdateDeliveryStatusError('WAIT_UNDISPATCHED is recorded by a rider leaving only')
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
        // Spec 0035 (AC-20): the saved row names the rider it was taken from.
        deliveryEvent.droppedCourierId = droppedCourierId
        const newCourier = await this.courierRepository.findByIdOrThrow(newCourierId)
        // Spec 0035 (AC-19): the rider who was waiting is paid to the end of this move.
        const endedAt = new Date()
        deliveryEvent.occurredAt = endedAt
        const waitPayOwed = await this.isWaitPayOwedAfterMove(dbDelivery, endedAt)

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
            // Spec 0048: the new rider's offer is a single one; the stack this job came from stays on its events.
            offerGroupId: null,
            stopSequence: Prisma.DbNull,
            // No rider holds it now (spec 0020): no accept time, no hand back.
            acceptedAt: null,
            handBackUntil: null,
            arrivedAtPickupAt: null,
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
        // Spec 0048 (cross check 6): this job left its stack (the write above took its link), so the order
        // its rider keeps goes on alone, with no stop sequence.
        if (dbDelivery.offerGroupId) await this.settleStackStops(dbDelivery.offerGroupId, deliveryId)

        // Sets status via the state machine result, saves the DeliveryEvent, notifies partner.
        const updatedDelivery = await this.updateDeliveryAndSendNotifications(
          deliveryEvent,
          newStatus,
          currentStatus,
          waitPayOwed ? { waitPayOwedAt: new Date() } : {}
        )
        if (waitPayOwed) await this.settleWaitPay(deliveryId)

        // The delivery no longer carries the dropped rider's id, so notifyCourier inside
        // updateDeliveryAndSendNotifications did not reach them — tell them explicitly.
        if (droppedCourierId) {
          await this.notifyCourier(droppedCourierId, updatedDelivery, newStatus, currentStatus, deliveryEvent)
        }
        await this.saveOfferedEvent(
          deliveryId,
          newCourierId,
          EnumEventActor.ADMIN,
          null,
          null,
          [],
          adminOfferReason(deliveryEvent.adminUserId)
        )
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
            this.logger.warn(
              `Could not read handBackSeconds while accepting ${deliveryEvent.deliveryId}: ${errorSummaryForLog(error)}`
            )
          }
          // Taken after the read, so a slow read does not shorten the window (row 71 review).
          const acceptedAt = new Date()
          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus, {
            courierId,
            offerExpiresAt: null,
            acceptedAt,
            handBackUntil: handBackSeconds > 0 ? new Date(acceptedAt.getTime() + handBackSeconds * 1000) : null,
            // Spec 0033 (AC-7): someone took it, so the hold after a rider left is over.
            undispatchedAt: null,
          })

          const courier = await this.courierRepository.findByIdOrThrow(courierId)

          if (courier.status === EnumCourierStatus.LAST_CALL) {
            // Spec 0040 (AC-1): recorded as LAST_CALL_ACCEPTED. The accept is already saved, so a failure
            // here is logged and the accept kept: the rider stays on Last Call, which gets no new offers.
            try {
              await this.courierRepository.changeStatus(
                courierId,
                EnumCourierStatus.OFFLINE,
                EnumCourierStatusChangeCause.LAST_CALL_ACCEPTED
              )
            } catch (error) {
              this.logger.error(
                `Could not set courier ${courierId} Offline after their Last Call accept: ${errorSummaryForLog(error)}`
              )
            }
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

          // Spec 0033: the rider's clock at the restaurant starts here; the tap time if signal was bad.
          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus, {
            arrivedAtPickupAt: deliveryEvent.occurredAt ?? new Date(),
          })
          break
        case EnumDeliveryStatus.PICKED_UP:
          this.logger.log(`Delivery ${deliveryEvent.deliveryId} was picked up by: ${deliveryEvent.actor}`)

          // Spec 0033: a delivery can change hands even after pickup, so the event names who picked it up.
          if (deliveryEvent.type === EnumDeliveryEventType.PICKED_UP) {
            deliveryEvent.courierId = dbDelivery.courierId
          }
          // The tap time when the step waited on the phone for signal (spec 0009, AC-12).
          const pickedUpAt = deliveryEvent.occurredAt ?? new Date()
          const waitPayOwed = await this.isWaitPayOwed(dbDelivery, pickedUpAt)
          await this.updateDeliveryAndSendNotifications(deliveryEvent, newStatus, currentStatus, {
            pickupReadyAt: pickedUpAt,
            ...(waitPayOwed ? { waitPayOwedAt: new Date() } : {}),
          })
          if (waitPayOwed) await this.settleWaitPay(deliveryId)
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
        `Delivery status transition failed for event ${eventLogLine(deliveryEvent)}: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
      await this.saveDeliveryEvent(deliveryEvent, {
        transitionSuccessful: false,
        oldStatus: currentStatus, // the status the Delivery was in when the attempt failed
        newStatus, // the status the state machine said the attempt was heading for
        // The error's own sentence, as before: a developer's English, kept untranslated as a note.
        text: eventText('TRANSITION_FAILED', { note: (error as Error).message }),
      })
    }
  }

  // Spec 0043 (AC-6, review fix): the offer is written under a lock on the rider with their box
  // measured inside it. Past a full box without `confirmOverCapacity` it answers 409 with the numbers;
  // confirmed, it returns the numbers measured at the write, for the record of the override.
  async offerDeliveryToCourierAsAdmin(
    deliveryId: string,
    courierId: string,
    message?: string,
    confirmOverCapacity = false,
    // Spec 0044 (AC-6): the admin, named in the offer's reason.
    adminUserId: string | null = null
  ): Promise<{ heldUnits: number; deliveryUnits: number }> {
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
    const claim = await this.deliveryRepository.claimForRiderWithinBox(
      deliveryId,
      courierId,
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
        // Spec 0048: an admin's offer is a single one, even when it moves one order of an open stack.
        offerGroupId: null,
        stopSequence: Prisma.DbNull,
        totalCost,
        totalCompensation,
        fee,
        feePercentage,
      },
      confirmOverCapacity
    )
    if (claim.outcome === 'BOX_FULL') {
      throw new BoxOverCapacityException(claim.heldUnits, claim.deliveryUnits)
    }
    // Spec 0048 (cross check 10): never a third delivery, and no confirm passes it.
    if (claim.outcome === 'TWO_HELD') {
      throw new ConflictException(THIRD_DELIVERY_REFUSED_SENTENCE)
    }
    // Spec 0051 (cross check 7): an admin cannot give work to a deactivated rider.
    if (claim.outcome === 'DEACTIVATED') {
      throw new ConflictException(RIDER_DEACTIVATED_SENTENCE)
    }
    // Spec 0046 (AC-4): the rider holds another leg of this order, measured under the lock.
    if (claim.outcome === 'SIBLING_LEG') {
      throw new ConflictException(SIBLING_LEG_HELD_SENTENCE)
    }
    if (claim.outcome === 'NOT_WAITING') {
      throw new CantUpdateDeliveryStatusError(
        `Delivery ${deliveryId} changed while you were offering it (a rider answered or it moved on); reload and try again`
      )
    }

    // Spec 0048 (AC-5): this order left an open stack, so the other order stays offered to its rider alone.
    if (delivery.offerGroupId) {
      await this.releaseStackPartners(delivery.offerGroupId, deliveryId)
    }

    try {
      const updatedDelivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

      const auditEvent: DeliveryConfirmedEvent = {
        deliveryId,
        type: EnumDeliveryEventType.CONFIRMED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        // The admin's own words, if any, travel untranslated as a note (spec 0054, cross check 5).
        ...(message
          ? eventText('ADMIN_OFFERED_WITH_NOTE', { courierId, note: message })
          : eventText('ADMIN_OFFERED', { courierId })),
      }

      await this.saveDeliveryEvent(auditEvent, {
        transitionSuccessful: true,
        oldStatus,
        newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      })
      await this.saveOfferedEvent(
        deliveryId,
        courierId,
        EnumEventActor.ADMIN,
        null,
        replacedCourierId,
        [],
        adminOfferReason(adminUserId)
      )
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
        this.logger.error(
          `Could not tell courier ${replacedCourierId} that the offer of ${deliveryId} moved: ${errorSummaryForLog(
            error
          )}`
        )
      }
    }
    return { heldUnits: claim.heldUnits, deliveryUnits: claim.deliveryUnits }
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
      // Spec 0038 (AC-15): an open offer kept the rider busy when the Offline statement ran, so their
      // position stayed; with the offers ended, erase it now if they hold no job.
      try {
        await this.courierRepository.clearLocationIfOfflineAndFree(courierId)
      } catch (error) {
        this.logger.error(`Could not erase the position of Offline courier ${courierId}: ${errorSummaryForLog(error)}`)
      }
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
      this.logger.error(
        `Could not look up open offers of courier ${courierId}: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
      return
    }

    for (const delivery of openOffers) {
      try {
        await this.endOffer({
          deliveryId: delivery.id,
          courierId,
          offeredAt: delivery.offeredAt,
          reason: 'OFFLINE',
          text: eventText('RIDER_WENT_OFFLINE', {}),
        })
      } catch (error) {
        this.logger.error(
          `Could not end offer of delivery ${delivery.id}: ${errorSummaryForLog(error)}`,
          describeErrorForLog(error).stack
        )
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
      this.logger.error(
        `Could not look up deliveries waiting for a rider: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
      return
    }

    for (const deliveryId of waitingIds) {
      let result: OfferStepResult
      try {
        result = await this.offerToNextCourier(deliveryId)
      } catch (error) {
        this.logger.error(
          `Offering waiting delivery ${deliveryId} failed: ${errorSummaryForLog(error)}`,
          describeErrorForLog(error).stack
        )
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
      text: eventText('OFFER_EXPIRED_AFTER', { seconds }),
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
      this.logger.error(
        `Retrying delivery ${payload.deliveryId} failed: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
      result = 'NO_COURIER'
    }

    // Still nobody: try again later. No new event, it is the same waiting spell.
    if (result === 'NO_COURIER') {
      await this.scheduleNoCourierRetry(payload.deliveryId)
    }
  }

  // Ends one open offer with OFFER_EXPIRED (the deadline passed, or the rider went offline). The
  // conditional update is the race rule: it clears the offer only if the delivery is still offered
  // to this rider, by this very offer, and nobody has taken it. Returns how many offers it ended: 0 or
  // 1, or 2 for a stack. Spec 0048 (AC-5): a delivery of an open stack ends with its partner, the first
  // call ending both and any later one finding nothing to do (cross check 9: idempotent); each rider is
  // skip listed for each delivery on its own list, as for a single offer.
  private async endOffer(args: {
    deliveryId: string
    courierId: string
    offeredAt: Date | null
    reason: OfferEndedReason
    text: EventText
  }): Promise<number> {
    const { deliveryId, courierId, reason, text } = args

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

    // Spec 0048: the deliveries this offer covers. A single offer is itself; an open stack is both of its
    // deliveries still offered to this rider by this offer, the earlier created first (cross check 9: it
    // is matched again first). A failed read ends this delivery alone, as before stacks existed.
    const ids = await this.idsCoveredByOffer(deliveryId, courierId, args.offeredAt)
    const isStack = ids.length > 1

    // Every write first, then the follow ups, so neither delivery of a stack is matched again while the
    // other still holds the rider.
    const ended: string[] = []
    for (const id of ids) {
      if (await this.endOneOffer(id, courierId, reason, stillThisOffer)) ended.push(id)
    }
    if (ended.length === 0) return 0

    // Cross check 9: a stack declined or missed is not offered as the same pair again for 20 minutes. Not
    // after Offline or a dispatch stop: the rider never judged the pair. Keyed on the pair, not on what this
    // call ended, so two expiry jobs that each ended one half still block it.
    if (isStack && reason === 'EXPIRED') await this.blockStackPair(ids)

    for (const id of ended) {
      await this.followUpEndedOffer(id, courierId, reason, isStack ? stackVariantOf(text) : text)
    }
    return ended.length
  }

  // Spec 0048: which deliveries one offer to this rider covers (see endOffer). Never throws.
  private async idsCoveredByOffer(deliveryId: string, courierId: string, offeredAt: Date | null): Promise<string[]> {
    try {
      const delivery = await this.deliveryRepository.findById(deliveryId)
      if (!delivery?.offerGroupId) return [deliveryId]
      const members = await this.deliveryRepository.findOpenGroupMembers(delivery.offerGroupId, courierId, offeredAt)
      const ids = members.map((member) => member.id)
      return ids.includes(deliveryId) ? ids : [deliveryId]
    } catch (error) {
      this.logger.error(
        `Could not read the stack of delivery ${deliveryId}; ending its offer alone: ${errorSummaryForLog(error)}`
      )
      return [deliveryId]
    }
  }

  // The write half of ending one delivery's offer: the skip list, then the conditional clear. Returns
  // whether this call ended it. Throws only when the write itself fails (the skip entry taken back first).
  private async endOneOffer(
    deliveryId: string,
    courierId: string,
    reason: OfferEndedReason,
    stillThisOffer: Prisma.DeliveryWhereInput
  ): Promise<boolean> {
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
        this.logger.error(
          `Could not add courier ${courierId} to the skip list of ${deliveryId}: ${errorSummaryForLog(error)}`
        )
      }
    }

    let ended: boolean
    try {
      ended = await this.deliveryRepository.updateIfMatches(deliveryId, stillThisOffer, {
        matchedCourierId: null,
        offeredAt: null,
        offerExpiresAt: null,
        // Spec 0048: an ended offer is no longer part of a stack.
        offerGroupId: null,
        stopSequence: Prisma.DbNull,
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
    }
    return ended
  }

  // The follow up half, once the offer is gone. Every step is guarded on its own, so a failure in one
  // (the rider lookup, the socket, the event pipeline) cannot leave the delivery with no OFFER_EXPIRED
  // row and nobody looking for a rider. The expiry job is added without `attempts`, so BullMQ never retries it
  // and nothing else would.
  private async followUpEndedOffer(
    deliveryId: string,
    courierId: string,
    reason: OfferEndedReason,
    text: EventText
  ): Promise<void> {
    // Tell the rider first, so their screen drops the offer before matching takes its time.
    try {
      const courier = await this.courierRepository.findById(courierId)
      if (courier) {
        await this.sendOfferEndedToRider(courier, { deliveryId, reason })
      }
    } catch (error) {
      this.logger.error(
        `Could not tell courier ${courierId} that the offer of ${deliveryId} ended: ${errorSummaryForLog(error)}`
      )
    }

    const expiredEvent: DeliveryOfferExpiredEvent = {
      deliveryId,
      type: EnumDeliveryEventType.OFFER_EXPIRED,
      actor: EnumEventActor.SYSTEM,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId,
      ...text,
    }
    // Saves OFFER_EXPIRED and offers the delivery to the next rider, like a decline.
    try {
      await this.processDeliveryEvent(expiredEvent)
    } catch (error) {
      this.logger.error(
        `Recording OFFER_EXPIRED for delivery ${deliveryId} failed: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
    }

    // If that left the delivery waiting with nobody offered (matching failed, or nobody is free),
    // make sure a backstop retry is pending, so it is matched again later.
    await this.ensureBackstopIfStillWaiting(deliveryId)
  }

  // Spec 0048 (cross check 9): the two deliveries of a stack the rider declined or missed are not stacked
  // together again for 20 minutes. Never throws: without the block they may simply be paired again.
  private async blockStackPair(ids: string[]): Promise<void> {
    const [one, other] = ids
    if (!one || !other) return
    try {
      await this.cacheService.save<boolean>(stackPairBlockKey(one, other), true, STACK_PAIR_BLOCK_SECONDS)
    } catch (error) {
      this.logger.error(
        `Could not keep deliveries ${one} and ${other} from being stacked again: ${errorSummaryForLog(error)}`
      )
    }
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
      this.logger.error(`Could not check whether delivery ${deliveryId} still waits: ${errorSummaryForLog(error)}`)
    }
    await this.scheduleNoCourierRetry(deliveryId)
  }

  // Never throws: undoing a skip list entry is cleanup, and its failure only means the rider sits
  // out this one delivery for up to 20 minutes.
  private async undoSkipListEntry(deliveryId: string, courierId: string): Promise<void> {
    try {
      await removeCourierFromRejectedList(this.cacheService, deliveryId, courierId)
    } catch (error) {
      this.logger.error(
        `Could not take courier ${courierId} off the skip list of ${deliveryId}: ${errorSummaryForLog(error)}`
      )
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
    if (stop) throw new DispatchStoppedError(adminRefusedSentence(stop, now))
  }

  // Spec 0022, AC-7: an admin's hand offer or a reassignment to a rider whose SOS is active answers
  // 409 with a sentence. The rider is offerable again once the SOS is not active.
  // A check before the write, not part of it (row 73 review): an SOS that starts in the same few
  // milliseconds slips past, and the worst case is an offer the rider lets expire. Accepted as is.
  // Spec 0051 (cross check 7): an admin hand offer, a reassign and an accept refuse a deactivated rider (409).
  // The claim checks again under the rider's lock; this answers first, in words.
  async refuseIfCourierDeactivated(courierId: string): Promise<void> {
    const courier = await this.courierRepository.findById(courierId)
    if (courier?.deactivatedAt) throw new ConflictException(RIDER_DEACTIVATED_SENTENCE)
  }

  // Spec 0046 (AC-4, cross check 3): an admin path that would give a rider a second leg of an order they
  // already hold a leg of answers 409 before anything is written. The hand offer checks again under the
  // rider's lock (claimForRiderWithinBox); confirmOverCapacity never lets it through.
  async refuseIfCourierHoldsSiblingLeg(courierId: string, deliveryId: string): Promise<void> {
    if (await this.deliveryRepository.holdsSiblingLeg(courierId, deliveryId)) {
      throw new ConflictException(SIBLING_LEG_HELD_SENTENCE)
    }
  }

  // Spec 0051 (row 108 review): after an accept's take. A deactivation holds the rider's row lock from its
  // checks to its commit; this read waits for it. Either the deactivation committed first (true here, and
  // the take is given back), or this read came first and the deactivation then sees the taken delivery as
  // a held job and is refused.
  async isCourierDeactivatedAfterTake(courierId: string): Promise<boolean> {
    return this.courierRepository.isDeactivatedWaitingForLock(courierId)
  }

  async refuseIfCourierInSos(courierId: string): Promise<void> {
    if (await this.courierRepository.hasActiveSos(courierId)) {
      throw new CantUpdateDeliveryStatusError(SOS_SENTENCES.courierInSos)
    }
  }

  // Spec 0048 (cross check 10): an admin's hand offer or reassign answers 409 when the rider already holds
  // two deliveries besides this one. A read before the write, like refuseIfCourierInSos; the hand offer's
  // claim counts again under the rider's lock.
  async refuseIfCourierHoldsTwo(courierId: string, deliveryId: string): Promise<void> {
    if ((await this.courierRepository.liveDeliveryCount(courierId, deliveryId)) >= MAX_DELIVERIES_HELD) {
      throw new ConflictException(THIRD_DELIVERY_REFUSED_SENTENCE)
    }
  }

  // Spec 0048 (AC-5): the rider declines a stack, by either of its deliveries, and both end: each delivery
  // puts the rider on its own skip list (never the other's), each is cleared in its own conditional write,
  // the two are not stacked together again for 20 minutes, and each gets its REJECTED event, which matches
  // it again, the earlier created first (cross check 9). Idempotent: a decline arriving after the stack
  // ended (expired, taken, moved) answers 409 "This offer has ended" and changes nothing.
  async declineStack(delivery: DeliveryEntity, courierId: string): Promise<void> {
    if (!delivery.offerGroupId) throw new OfferHasEndedException()
    const members = await this.deliveryRepository.findOpenGroupMembers(delivery.offerGroupId, courierId, delivery.offeredAt)
    if (!members.some((member) => member.id === delivery.id)) throw new OfferHasEndedException()

    const ended: DeliveryEntity[] = []
    for (const member of members) {
      // Before the offer is cleared, as for a single decline, so a matcher running in between cannot offer
      // it straight back to this rider. A failed write is logged: the decline must still go through.
      let addedToSkipList = false
      try {
        addedToSkipList = await addCourierToRejectedList(this.cacheService, member.id, courierId)
      } catch (error) {
        this.logger.error(
          `Could not add courier ${courierId} to the skip list of ${member.id}: ${errorSummaryForLog(error)}`
        )
      }
      let declined = false
      try {
        declined = await this.deliveryRepository.updateIfMatches(
          member.id,
          {
            status: EnumDeliveryStatus.ASSIGNING_COURIER,
            matchedCourierId: courierId,
            offeredAt: delivery.offeredAt,
            courierId: null,
          },
          { matchedCourierId: null, offeredAt: null, offerExpiresAt: null, offerGroupId: null, stopSequence: Prisma.DbNull }
        )
      } finally {
        if (!declined && addedToSkipList) await this.undoSkipListEntry(member.id, courierId)
      }
      if (declined) ended.push(member)
    }
    if (ended.length > 1) await this.blockStackPair(ended.map((member) => member.id))

    for (const member of ended) {
      const partnerId = members.find((other) => other.id !== member.id)?.id
      const rejected: DeliveryRejectedEvent = {
        deliveryId: member.id,
        type: EnumDeliveryEventType.REJECTED,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
        ...(partnerId
          ? eventText('REJECTED_TOGETHER', { courierId, deliveryId: member.id, otherDeliveryId: partnerId })
          : eventText('REJECTED', { courierId, deliveryId: member.id })),
      }
      await this.processDeliveryEvent(rejected)
    }
    if (!ended.some((member) => member.id === delivery.id)) throw new OfferHasEndedException()
  }

  // Spec 0048 (cross check 8): the minute sweep's step. A stack the rider accepted whose second ACCEPTED did
  // not land (the process stopped, or the write lost a race and the first one stood) is completed here, a
  // minute later, so the rider who tapped accept is never left with half a pair (value 4: trust the rider).
  // Returns how many it completed. Never throws.
  async completeTakenStackAccepts(before: Date): Promise<number> {
    let taken: DeliveryEntity[]
    try {
      taken = await this.deliveryRepository.findTakenGroupMembersNotAccepted(before)
    } catch (error) {
      this.logger.error(`Could not look up stack accepts to complete: ${errorSummaryForLog(error)}`)
      return 0
    }
    let completed = 0
    for (const delivery of taken) {
      const courierId = delivery.courierId
      if (!courierId) continue
      try {
        // Review of row 80: the checks an accept makes after its take. A dispatch stop that began, or a
        // deactivation, since the rider's tap gives this order back to waiting instead of a job (value 3: no
        // rider takes work during a stop); so does an accept that has kept failing for STACK_ACCEPT_GIVE_UP_MS,
        // so the sweep does not try one row for ever. The backstop then matches it again.
        const stopped = await this.dispatchStopRepository.findOn(new Date())
        const givingUp = Date.now() - delivery.updatedAt.getTime() > STACK_ACCEPT_GIVE_UP_MS
        if (stopped || givingUp || (await this.isCourierDeactivatedAfterTake(courierId))) {
          const givenBack = await this.deliveryRepository.updateIfMatches(
            delivery.id,
            { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
            {
              courierId: null,
              matchedCourierId: null,
              offeredAt: null,
              offerExpiresAt: null,
              offerGroupId: null,
              stopSequence: Prisma.DbNull,
            }
          )
          if (givenBack) {
            this.logger.warn(
              `Stack accept of delivery ${delivery.id} by courier ${courierId} not completed (${
                stopped ? 'dispatch stopped' : givingUp ? 'it kept failing' : 'rider deactivated'
              }); the order waits for a rider again`
            )
            // agy review of row 80: the other order, already the rider's job, is alone now, so its four stop
            // sequence is cleared too (cross check 6); `delivery` is the row read before the write, so its
            // offerGroupId still names the group.
            if (delivery.offerGroupId) await this.settleStackStops(delivery.offerGroupId, delivery.id)
            await this.ensureBackstopIfStillWaiting(delivery.id)
          }
          continue
        }
        const accepted: DeliveryAcceptedEvent = {
          deliveryId: delivery.id,
          type: EnumDeliveryEventType.ACCEPTED,
          actor: EnumEventActor.SYSTEM,
          courierId,
          source: EnumDeliveryEventSource.OPENCOURIER,
          ...eventText('ACCEPTED_BY_SWEEP', { courierId, deliveryId: delivery.id }),
        }
        await this.processDeliveryEvent(accepted)
        const after = await this.deliveryRepository.findById(delivery.id)
        if (after && after.status !== EnumDeliveryStatus.ASSIGNING_COURIER) completed += 1
      } catch (error) {
        this.logger.error(
          `Could not complete the stack accept of delivery ${delivery.id}: ${errorSummaryForLog(error)}`
        )
      }
    }
    return completed
  }

  // Spec 0048 (cross check 6): clears the group's stop sequence once its two deliveries are no longer with
  // one rider (settleStopSequence decides). Never throws: a sequence left behind is only advisory.
  private async settleStackStops(groupId: string, changedDeliveryId: string): Promise<void> {
    try {
      const cleared = await this.deliveryRepository.settleStopSequence(groupId)
      if (cleared > 0) this.logger.log(`Delivery ${changedDeliveryId} left its stack; the stop sequence was cleared`)
    } catch (error) {
      this.logger.error(
        `Could not settle the stop sequence of delivery ${changedDeliveryId}: ${errorSummaryForLog(error)}`
      )
    }
  }

  // Spec 0048 (AC-5): the other delivery of an open stack keeps its offer as a single one. Never throws.
  private async releaseStackPartners(groupId: string, exceptDeliveryId: string): Promise<void> {
    try {
      const released = await this.deliveryRepository.releaseOpenGroupPartners(groupId, exceptDeliveryId)
      if (released > 0) this.logger.log(`Delivery ${exceptDeliveryId} left its stack; the other order stays offered alone`)
    } catch (error) {
      this.logger.error(
        `Could not release the stack partner of delivery ${exceptDeliveryId}: ${errorSummaryForLog(error)}`
      )
    }
  }

  // Start of a dispatch stop (spec 0014, AC-5, step 1): every open offer ends, its rider told, with
  // no skip list entry. Never throws; returns how many ended.
  async endAllOpenOffersForDispatchStop(text: EventText): Promise<number> {
    let open: DeliveryEntity[]
    try {
      open = await this.deliveryRepository.findAllOpenOffers()
    } catch (error) {
      this.logger.error(`Could not look up open offers to end for a dispatch stop: ${errorSummaryForLog(error)}`)
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
          text,
        })
        ended += done
      } catch (error) {
        this.logger.error(
          `Could not end the offer of delivery ${delivery.id} for a dispatch stop: ${errorSummaryForLog(error)}`
        )
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
    text: EventText
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
    // Spec 0035 (AC-19): the rider who was waiting is paid to the end of this move.
    const endedAt = new Date()
    const waitPayOwed = await this.isWaitPayOwedAfterMove(delivery, endedAt)
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
        arrivedAtPickupAt: null,
        ...(waitPayOwed ? { waitPayOwedAt: new Date() } : {}),
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
      occurredAt: endedAt,
      ...text,
    }
    try {
      await this.saveDeliveryEvent(event, {
        transitionSuccessful: true,
        oldStatus,
        newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      })
    } catch (error) {
      this.logger.error(`Could not record RETURNED_TO_WAITING for delivery ${deliveryId}: ${errorSummaryForLog(error)}`)
    }
    if (waitPayOwed) await this.settleWaitPay(deliveryId)
    try {
      const updated = await this.deliveryRepository.findByIdOrThrow(deliveryId)
      if (updated.partnerId) {
        await this.notifyPartner(updated.partnerId, EnumDeliveryStatus.ASSIGNING_COURIER, oldStatus, event)
      }
      // The delivery no longer carries the rider's id, so tell them explicitly. No skip list: the
      // rider did nothing wrong.
      await this.notifyCourier(courierId, updated, EnumDeliveryStatus.ASSIGNING_COURIER, oldStatus, event)
    } catch (error) {
      this.logger.error(
        `Could not tell the restaurant or rider that delivery ${deliveryId} went back to waiting: ${errorSummaryForLog(
          error
        )}`
      )
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
      this.logger.error(
        `Could not put rider ${courierId} on the skip list of delivery ${deliveryId}: ${errorSummaryForLog(error)}`
      )
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
        arrivedAtPickupAt: null,
      }
    )

    const event: DeliveryHandedBackEvent = {
      deliveryId,
      type: EnumDeliveryEventType.HANDED_BACK,
      actor: EnumEventActor.COURIER,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId,
      // The window's length is a co-op setting, so the message names none (row 71 review).
      ...(written ? eventText('HANDED_BACK', {}) : eventText('HAND_BACK_REFUSED', {})),
    }

    if (!written) {
      if (addedToSkipList) {
        try {
          await removeCourierFromRejectedList(this.cacheService, deliveryId, courierId)
        } catch (error) {
          this.logger.error(
            `Could not take rider ${courierId} off the skip list of delivery ${deliveryId}: ${errorSummaryForLog(
              error
            )}`
          )
        }
      }
      try {
        await this.saveDeliveryEvent(event, { transitionSuccessful: false, oldStatus, newStatus: oldStatus })
      } catch (error) {
        this.logger.error(
          `Could not record the refused HANDED_BACK for delivery ${deliveryId}: ${errorSummaryForLog(error)}`
        )
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
      this.logger.error(`Could not record HANDED_BACK for delivery ${deliveryId}: ${errorSummaryForLog(error)}`)
    }
    try {
      const updated = await this.deliveryRepository.findByIdOrThrow(deliveryId)
      if (updated.partnerId) {
        await this.notifyPartner(updated.partnerId, EnumDeliveryStatus.ASSIGNING_COURIER, oldStatus, event)
      }
      // The delivery no longer carries the rider's id, so tell them explicitly.
      await this.notifyCourier(courierId, updated, EnumDeliveryStatus.ASSIGNING_COURIER, oldStatus, event)
    } catch (error) {
      this.logger.error(
        `Could not tell the restaurant or rider that delivery ${deliveryId} was handed back: ${errorSummaryForLog(
          error
        )}`
      )
    }
    // Straight back to matching; nobody free means the usual no courier spell and retry. The hand
    // back is done whatever happens here: a failure is logged and the backstop sweep still finds
    // the waiting delivery, so the rider is never answered 500 for an order they gave back (row 71
    // review).
    try {
      await this.offerOrWait(deliveryId)
    } catch (error) {
      this.logger.error(
        `Could not start matching after delivery ${deliveryId} was handed back: ${errorSummaryForLog(error)}`
      )
    }
    return true
  }

  // Spec 0033 (AC-6): a rider leaves a restaurant that kept them past the co-op's limit, which the
  // caller has checked. handBack's shape: the skip list first, one conditional write back to waiting,
  // the event saved outside the state machine's switch, the restaurant and rider told, then matching.
  // Unlike a hand back, the wait is paid. A missed write is saved as a failed row (value 1).
  async leaveWait(delivery: DeliveryEntity, courierId: string, occurredAt: Date): Promise<boolean> {
    const deliveryId = delivery.id
    const oldStatus = delivery.status
    const waitPayOwed = await this.isWaitPayOwed(delivery, occurredAt)

    let addedToSkipList = false
    try {
      addedToSkipList = await addCourierToRejectedList(this.cacheService, deliveryId, courierId)
    } catch (error) {
      this.logger.error(
        `Could not put rider ${courierId} on the skip list of delivery ${deliveryId}: ${errorSummaryForLog(error)}`
      )
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
        arrivedAtPickupAt: null,
        undispatchedAt: occurredAt,
        ...(waitPayOwed ? { waitPayOwedAt: new Date() } : {}),
      }
    )

    const event: DeliveryWaitUndispatchedEvent = {
      deliveryId,
      type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
      actor: EnumEventActor.COURIER,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId,
      occurredAt,
      ...(written ? eventText('LEFT_AFTER_WAIT', {}) : eventText('LEAVE_REFUSED', {})),
    }

    if (!written) {
      if (addedToSkipList) {
        try {
          await removeCourierFromRejectedList(this.cacheService, deliveryId, courierId)
        } catch (error) {
          this.logger.error(
            `Could not take rider ${courierId} off the skip list of delivery ${deliveryId}: ${errorSummaryForLog(
              error
            )}`
          )
        }
      }
      try {
        await this.saveDeliveryEvent(event, { transitionSuccessful: false, oldStatus, newStatus: oldStatus })
      } catch (error) {
        this.logger.error(
          `Could not record the refused WAIT_UNDISPATCHED for delivery ${deliveryId}: ${errorSummaryForLog(error)}`
        )
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
      this.logger.error(`Could not record WAIT_UNDISPATCHED for delivery ${deliveryId}: ${errorSummaryForLog(error)}`)
    }
    if (waitPayOwed) await this.settleWaitPay(deliveryId)
    try {
      const updated = await this.deliveryRepository.findByIdOrThrow(deliveryId)
      if (updated.partnerId) {
        await this.notifyPartner(updated.partnerId, EnumDeliveryStatus.ASSIGNING_COURIER, oldStatus, event)
      }
      // The delivery no longer carries the rider's id, so tell them explicitly.
      await this.notifyCourier(courierId, updated, EnumDeliveryStatus.ASSIGNING_COURIER, oldStatus, event)
    } catch (error) {
      this.logger.error(
        `Could not tell the restaurant or rider that the rider left delivery ${deliveryId}: ${errorSummaryForLog(
          error
        )}`
      )
    }
    // Held by the timing check until the food is due. The rider has left whatever happens here: the
    // backstop sweep still finds the waiting delivery.
    try {
      await this.offerOrWait(deliveryId)
    } catch (error) {
      this.logger.error(
        `Could not start matching after the rider left delivery ${deliveryId}: ${errorSummaryForLog(error)}`
      )
    }
    return true
  }

  // Spec 0033, AC-1 and AC-2: whether this wait earns delay pay under the settings in force now. Read
  // before the status write, so the same write can record that money is owed.
  private async isWaitPayOwed(delivery: DeliveryEntity, endedAt: Date): Promise<boolean> {
    if (!delivery.arrivedAtPickupAt || !delivery.promisedReadyAt) return false
    try {
      const config = this.configDomainService.instanceConfig
      if (!(await config.getWaitPayEnabled())) return false
      if ((await config.getWaitPayCentsPerMinute()) <= 0) return false
      const freeMinutes = await config.getWaitPayFreeMinutes()
      // Row 11 review: the split windows are left out here too, as the settle leaves them out. If the trail
      // cannot be read, nothing is left out: the wait is stamped and the settle, which reads the trail
      // again, decides (an unpaid rider is the worse mistake, value 4).
      let events: Awaited<ReturnType<DeliveryEventRepository['findWaitEvents']>> = []
      try {
        events = await this.deliveryEventRepository.findWaitEvents(delivery.id)
      } catch (error) {
        this.logger.error(`Could not read the split windows of delivery ${delivery.id}: ${errorSummaryForLog(error)}`)
      }
      return (
        paidWaitMinutes({
          arrivedAt: delivery.arrivedAtPickupAt,
          promisedReadyAt: delivery.promisedReadyAt,
          foodReadyAt: delivery.foodReadyAt,
          freeMinutes,
          endedAt,
          excluded: splitWindowsUntil(events, endedAt),
        }) > 0
      )
    } catch (error) {
      this.logger.error(
        `Could not read the delay pay settings for delivery ${delivery.id}: ${errorSummaryForLog(error)}`
      )
      return false
    }
  }

  // Spec 0035 (AC-19): whether a move off this delivery ends a wait that earns pay. Only from the
  // status where the rider was waiting: arrivedAtPickupAt can still be set after a pickup, which would
  // stamp a wait the trail cannot show.
  private async isWaitPayOwedAfterMove(delivery: DeliveryEntity, endedAt: Date): Promise<boolean> {
    if (delivery.status !== EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION) return false
    return this.isWaitPayOwed(delivery, endedAt)
  }

  // Spec 0033, AC-3, AC-4, AC-8. Pays the rider and charges the restaurant for a wait, whichever piece
  // is still missing. Only the newest wait can start a payment: an earlier one ended either paid or
  // while delay pay was off. Safe to call any number of times (right after the wait and from the
  // minute sweep). Never throws: waitPayOwedAt stays set on a failure, so the sweep tries again.
  // The free minutes and rate are read here: only a retry after a representative changes one differs.
  async settleWaitPay(deliveryId: string): Promise<void> {
    try {
      const delivery = await this.deliveryRepository.findById(deliveryId)
      if (!delivery?.waitPayOwedAt) return

      const config = this.configDomainService.instanceConfig
      const freeMinutes = await config.getWaitPayFreeMinutes()
      const centsPerMinute = await config.getWaitPayCentsPerMinute()
      const events = await this.deliveryEventRepository.findWaitEvents(deliveryId)
      const newest = latestCompletedWait(events, delivery.promisedReadyAt, delivery.foodReadyAt, freeMinutes)

      const awards = await this.courierCompensationRepository.findWaitAwards(deliveryId)
      // A rate set to 0 since the wait ended writes nothing (decision 23.10).
      if (newest && centsPerMinute > 0 && !awards.some((award) => award.waitOf === waitOfKey(deliveryId, newest.endEventId))) {
        if (newest.courierId) {
          awards.push(
            await this.courierCompensationRepository.createWaitPayOnce({
              amount: newest.minutes * centsPerMinute,
              currencyCode: delivery.currencyCode,
              reason: EnumCourierCompensationReason.WAITING,
              policy: 'WAIT_PAY',
              message: `Waited ${newest.minutes} min at ${centsPerMinute} cents a minute`,
              // Spec 0036: the same minutes as a number, so a restaurant's charge can say them.
              waitMinutes: newest.minutes,
              courierId: newest.courierId,
              deliveryId,
              waitOf: waitOfKey(deliveryId, newest.endEventId),
            })
          )
        } else {
          // Only a PICKED_UP saved before spec 0033 can have no rider.
          this.logger.warn(`Delivery ${deliveryId}: a wait ended with no rider on record, so it was not paid`)
        }
      }
      for (const award of awards) {
        await this.finishWaitPayment(delivery, award)
      }

      // Nothing on the trail to pay from, though the status write said pay is owed: an event was never
      // saved. The stamp stays, so the sweep keeps trying for a day and the gap shows in the log.
      if (!newest) {
        this.logger.error(`WAIT_PAY_NOT_ON_TRAIL ${JSON.stringify({ deliveryId })}`)
        return
      }

      // Only the time that was read: a wait that became owed meanwhile keeps its own.
      await this.deliveryRepository.updateIfMatches(
        deliveryId,
        { waitPayOwedAt: delivery.waitPayOwedAt },
        { waitPayOwedAt: null }
      )
    } catch (error) {
      this.logger.error(
        `WAIT_PAY_SETTLE_FAILED ${JSON.stringify({ deliveryId })}: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
    }
  }

  // The event and the restaurant's charge of one paid wait, each read from what the rider was paid, so
  // the three always agree. Check, then write, as the cancellation award does (single worker).
  private async finishWaitPayment(delivery: DeliveryEntity, award: CourierCompensation): Promise<void> {
    const waitOf = award.waitOf
    if (!waitOf) return

    // The event's message carries `wait <waitOf>` below and this check reads it: keep that part as is.
    const paidMessages = await this.deliveryEventRepository.findWaitPaidMessages(delivery.id)
    if (!paidMessages.some((message) => message.includes(waitOf))) {
      const event: DeliveryCourierPaidForWaitEvent = {
        deliveryId: delivery.id,
        type: EnumDeliveryEventType.COURIER_PAID_FOR_WAIT,
        actor: EnumEventActor.SYSTEM,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: award.courierId,
        ...waitPaidText(award, waitOf),
      }
      await this.saveDeliveryEvent(event, {
        transitionSuccessful: true,
        oldStatus: delivery.status,
        newStatus: delivery.status,
      })
    }

    if (delivery.partnerId) {
      await this.partnerChargeRepository.createWaitChargeOnce({
        partnerId: delivery.partnerId,
        deliveryId: delivery.id,
        amount: award.amount,
        currencyCode: award.currencyCode,
        reason: EnumPartnerChargeReason.WAITING,
        waitOf,
        // Spec 0036: copied from the award, like the amount.
        waitMinutes: award.waitMinutes,
      })
    }
  }

  // End of a dispatch stop (spec 0014, AC-4): every waiting delivery, oldest first, gets an offer or
  // a recorded "nobody free" with its backstop. Not matchWaitingDeliveries, which offers one only.
  async matchAllWaitingDeliveriesAfterStop(): Promise<void> {
    let waitingIds: string[]
    try {
      waitingIds = await this.deliveryRepository.findIdsWaitingForCourierOldestFirst()
    } catch (error) {
      this.logger.error(`Could not look up waiting deliveries after a dispatch stop: ${errorSummaryForLog(error)}`)
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
      this.logger.error(
        `Offering delivery ${deliveryId} failed: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
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

    // No matcher offers work to a rider in an active SOS (spec 0022, AC-7; decision 73.11). The two
    // automatic matchers already leave such riders out in their SQL; this one check also covers the
    // STATIC matcher, which returns its configured rider without asking whether they are free. The
    // delivery then waits as if no rider were free, and the backstop retry tries again.
    const riderInSos = match ? await this.courierRepository.hasActiveSos(match.courier.id) : false

    // Spec 0048 (row 81, AC-6, AC-3): with Add on offers on, one more order for a rider already on a job.
    // Looked for when no free rider was found (a shortage), or at every matching under WHENEVER_FITS, where a
    // fitting add on goes before the free rider (decision 81.3). Anything that keeps it from being written
    // leaves this delivery exactly where it was without add ons: offered to the free rider, or waiting.
    // The switch is read first (review nit), so with add ons off nothing more is read than before row 81.
    if (this.twoOrderService && (await this.configDomainService.instanceConfig.getAddOnOffersEnabled())) {
      const freeRiderFound = match !== undefined && !riderInSos
      const delivery = match?.delivery ?? (await this.deliveryRepository.findByIdOrThrow(deliveryId))
      const plan = await this.twoOrderService.findAddOn(delivery, freeRiderFound, async (courierId, secondsToPickup, pickupLocation) => {
        if (options.ignoreTiming === true) return true
        const addOnTiming = await this.offerTimingOf({
          courier: { id: courierId },
          delivery,
          pickupLocation,
          travelSeconds: secondsToPickup,
        })
        return addOnTiming.dueInMs <= 0
      })
      if (plan) {
        const added = await this.offerAddOn(delivery, plan)
        if (added !== 'NOT_ADDED') return added
      }
    }

    if (!match) {
      this.logger.log(`No courier found for delivery ${deliveryId}`)
      return 'NO_COURIER'
    }
    const { courier } = match
    if (riderInSos) {
      this.logger.log(`Courier ${courier.id} has an active SOS; delivery ${deliveryId} is not offered to them`)
      return 'NO_COURIER'
    }

    // Spec 0031: with offers timed, hold this one until the chosen rider needs to leave. Checked here,
    // after the rider is chosen, so every path that offers passes through it (as the dispatch stop
    // above does), and each try chooses the rider and the time afresh.
    const timing =
      options.ignoreTiming === true ? { dueInMs: 0, note: [] } : await this.offerTimingOf(match)
    if (timing.dueInMs > 0) {
      const retrySeconds = await this.configDomainService.instanceConfig.getNoCourierRetrySeconds()
      // At most one retry period away, so a setting switched off or a rider coming free counts soon.
      // `Math.ceil`: road times are fractional and the job's delay is whole milliseconds.
      const delayMs = Math.ceil(Math.min(timing.dueInMs, retrySeconds * 1000))
      await this.scheduleNoCourierRetry(deliveryId, delayMs)
      this.logger.log(`Delivery ${deliveryId} is held; looking again in ${Math.round(delayMs / 1000)} s`)
      return 'NOT_DUE'
    }

    // Spec 0048 (AC-4): with Stacking on, a second waiting delivery (same restaurant, or another with both ready) may go to the
    // same rider in this offer. Asked only after the rider is chosen (scored on this pickup) and this
    // delivery is due; the other delivery must be due too (cross check 11). Anything that keeps the stack
    // from being written means this delivery is offered alone, below.
    if (this.twoOrderService) {
      const plan = await this.twoOrderService.findStackPartner(match.delivery, courier.id, async (candidate) => {
        if (options.ignoreTiming === true) return true
        // The first order's pickup and road time stand in for the candidate's: the same place for a pair from one
        // restaurant, and a pair from two restaurants needs both marked ready, so its offer is never held anyway.
        const candidateTiming = await this.offerTimingOf({
          courier,
          delivery: candidate,
          pickupLocation: match.pickupLocation,
          travelSeconds: match.travelSeconds,
        })
        return candidateTiming.dueInMs <= 0
      })
      if (plan) {
        const stacked = await this.offerStack(match, plan, timing.note)
        if (stacked !== 'ALONE') return stacked
      }
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
    // at the same moment (a retry and a rider coming Online, say) cannot offer it twice. Spec 0043
    // (AC-5): and only if it still fits in the rider's box, checked under a lock on the rider, which
    // also covers the STATIC matcher (it never asks whether its rider has room).
    const claim = await this.deliveryRepository.claimOfferWithinBox(
      deliveryId,
      courier.id,
      { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: null, courierId: null },
      {
        matchedCourierId: courier.id,
        offeredAt,
        offerExpiresAt,
        totalCost,
        totalCompensation,
        fee,
        feePercentage,
        // Spec 0048: a single offer belongs to no stack, whatever link an earlier accepted stack left.
        offerGroupId: null,
        stopSequence: Prisma.DbNull,
      }
    )
    if (claim === 'TWO_HELD') {
      // Spec 0048 (cross check 10): only the Static matcher can name a rider who holds two already. The limit
      // counts with the automatic matchers' busy rule, so they never choose a rider it refuses (review of row 80).
      this.logger.log(`Courier ${courier.id} already holds two deliveries; delivery ${deliveryId} is not offered to them`)
      return 'NO_COURIER'
    }
    if (claim === 'DEACTIVATED') {
      // Spec 0051: only the Static matcher can name a deactivated rider; the delivery waits as if none were free.
      this.logger.log(`Courier ${courier.id} is deactivated; delivery ${deliveryId} is not offered to them`)
      return 'NO_COURIER'
    }
    if (claim === 'SIBLING_LEG') {
      // Spec 0046 (AC-4): only the Static matcher can name a rider who holds another leg of this order (the
      // others skip busy riders). The leg waits as if none were free; the backstop tries again later.
      this.logger.log(`Courier ${courier.id} holds another leg of this order; delivery ${deliveryId} is not offered to them`)
      return 'NO_COURIER'
    }
    if (claim === 'BOX_FULL') {
      // The delivery waits as if no rider were free, and the backstop retry tries again.
      this.logger.log(`Courier ${courier.id} has no room in the box; delivery ${deliveryId} is not offered to them`)
      return 'NO_COURIER'
    }
    if (claim === 'NOT_WAITING') {
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
      await this.saveOfferedEvent(
        deliveryId,
        courier.id,
        EnumEventActor.SYSTEM,
        offerExpiresAt,
        null,
        timing.note,
        match.reason ?? null
      )
    } catch (error) {
      this.logger.error(
        `Could not record OFFERED for delivery ${deliveryId}: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
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
      this.logger.error(
        `Could not send the offer of ${deliveryId} to courier ${courier.id}: ${errorSummaryForLog(error)}`
      )
    }
    return 'OFFERED'
  }

  // Spec 0048 (AC-4): offers `match.delivery` and `plan.partner` together to the chosen rider: one claim for
  // both under the rider's lock, the same offerGroupId, rider, offer time and deadline on each, each its own
  // amounts from its own quote (AC-9: stacking never changes what an order pays), and an OFFERED event per
  // delivery whose reason is kind STACK with the other delivery and the order of stops. 'ALONE' when the
  // claim did not land (the partner was taken meanwhile, say): the caller then offers the first delivery
  // on its own, exactly as without stacking.
  private async offerStack(
    match: CourierMatch,
    plan: StackPlan,
    timingNote: EventPart[]
  ): Promise<OfferStepResult | 'ALONE'> {
    const { courier } = match
    const first = match.delivery
    const second = plan.partner

    // Amounts first, then the offer, as for a single one (flow 1): each from its own quote, the rider's pay
    // its full base plus its own distance (value 3: full fee per order). If either cannot be worked out (a
    // missing quote, say), no stack: the first order goes out alone, as findStackPartner promises (review of
    // row 80), and its own calculation below then fails or succeeds exactly as without stacking.
    let firstAmounts: IDeliveryAmountsCalculationsResult
    let secondAmounts: IDeliveryAmountsCalculationsResult
    try {
      firstAmounts = await this.deliveryCalculationService.calculateDeliveryAmountsForMatchedCourier({
        deliveryId: first.id,
        courierId: courier.id,
      })
      secondAmounts = await this.deliveryCalculationService.calculateDeliveryAmountsForMatchedCourier({
        deliveryId: second.id,
        courierId: courier.id,
      })
    } catch (error) {
      this.logger.error(
        `Could not work out the pay of a stack of ${first.id} and ${second.id}; offering ${
          first.id
        } alone: ${errorSummaryForLog(error)}`
      )
      return 'ALONE'
    }
    const expiryEnabled = await this.configDomainService.instanceConfig.getOfferExpiryEnabled()
    const expirySeconds = expiryEnabled ? await this.configDomainService.instanceConfig.getOfferExpirySeconds() : null
    const offeredAt = new Date()
    const offerExpiresAt = expirySeconds !== null ? new Date(offeredAt.getTime() + expirySeconds * 1000) : null
    const offerGroupId = randomUUID()
    // Cross check 6: the order of the four stops, the same list on both, so the offer card and the job
    // screens draw one route through them. Copied into plain objects, the shape a Json column takes.
    const stopSequence = plan.sequence.stops.map((stop) => ({ deliveryId: stop.deliveryId, stop: stop.stop }))
    const offerOf = (amounts: typeof firstAmounts) => ({
      matchedCourierId: courier.id,
      offeredAt,
      offerExpiresAt,
      offerGroupId,
      stopSequence,
      totalCost: amounts.totalCost,
      totalCompensation: amounts.totalCompensation,
      fee: amounts.fee,
      feePercentage: amounts.feePercentage,
    })

    const claim = await this.deliveryRepository.claimStackWithinBox(
      courier.id,
      { deliveryId: first.id, data: offerOf(firstAmounts) },
      { deliveryId: second.id, data: offerOf(secondAmounts) }
    )
    if (claim !== 'CLAIMED') {
      this.logger.log(`Stack of deliveries ${first.id} and ${second.id} not written (${claim}); offering ${first.id} alone`)
      return 'ALONE'
    }

    // A stop that began while this matching ran: take both back (row 29 review), as for a single offer.
    if (await this.dispatchStopRepository.findOn(new Date())) {
      for (const id of [first.id, second.id]) {
        await this.deliveryRepository.updateIfMatches(
          id,
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: courier.id, offeredAt, courierId: null },
          { matchedCourierId: null, offeredAt: null, offerExpiresAt: null, offerGroupId: null, stopSequence: Prisma.DbNull }
        )
      }
      this.logger.log(`Dispatch stopped while deliveries ${first.id} and ${second.id} were being offered; offer taken back`)
      return 'STOPPED'
    }

    this.logger.log(`Deliveries ${first.id} and ${second.id} are being offered together to courier: ${courier.id}`)
    const stops = stopParts(plan.sequence.stops)
    // The timing note goes on the first order's record only, as before.
    const pairs: [DeliveryEntity, DeliveryEntity, EventPart[]][] = [
      [first, second, timingNote],
      [second, first, []],
    ]
    for (const [delivery, partner, note] of pairs) {
      // The event says which order it was paired with and the stops, so members can audit each pairing
      // (value 1; scope row 80, Done when). Ids only, never an address.
      try {
        await this.saveOfferedEvent(
          delivery.id,
          courier.id,
          EnumEventActor.SYSTEM,
          offerExpiresAt,
          null,
          [...note, eventPart('STACK_PAIRED', { otherDeliveryId: partner.id, stops })],
          stackOfferReason(match.reason, partner.id, plan.sequence)
        )
      } catch (error) {
        this.logger.error(
          `Could not record OFFERED for delivery ${delivery.id}: ${errorSummaryForLog(error)}`,
          describeErrorForLog(error).stack
        )
      }
      // Each delivery keeps its own timer for the shared deadline; the first to run ends both (endOffer).
      if (expirySeconds !== null) {
        await this.scheduleOfferExpiry(delivery.id, courier.id, offeredAt, expirySeconds * 1000)
      }
      await this.removeNoCourierRetry(delivery.id)
    }

    // Both offers reach the open app, each carrying offerGroupId, so it shows them as one pair. Only the first
    // is pushed (cross check 11: one push per stack); the push names the other order, and a phone that wakes
    // to it loads both from the server.
    for (const id of [first.id, second.id]) {
      try {
        const updatedDelivery = await this.deliveryRepository.findByIdOrThrow(id)
        await this.sendOfferToRider(courier, updatedDelivery, id === first.id)
      } catch (error) {
        this.logger.error(`Could not send the offer of ${id} to courier ${courier.id}: ${errorSummaryForLog(error)}`)
      }
    }
    return 'OFFERED'
  }

  // Spec 0048 (row 81, AC-6): offers `delivery` to a rider already on a job, as one more order on the way. A
  // single offer of this one delivery (the job is never touched: AC-7), claimed under the rider's lock with
  // the check that the job is still the one thing they hold, its own amounts from its own quote (AC-9: the
  // added order pays in full), the stop list through both jobs (for the card and the route, AC-10), what it
  // adds in metres and seconds, and an OFFERED event whose reason is kind ADD_ON (value 1). Cross check 2: an
  // add on offered while the rider carries food gets twice the usual time to answer, and the push never
  // rings insistently (offer-push.service). Every add on has a deadline, Offer expiry on or off (81.14). 'NOT_ADDED' when nothing was written: the caller goes on as
  // without add ons.
  private async offerAddOn(delivery: DeliveryEntity, plan: AddOnPlan): Promise<OfferStepResult | 'NOT_ADDED'> {
    const { courierId, job, sequence } = plan
    let amounts: IDeliveryAmountsCalculationsResult
    try {
      amounts = await this.deliveryCalculationService.calculateDeliveryAmountsForMatchedCourier({
        deliveryId: delivery.id,
        courierId,
      })
    } catch (error) {
      this.logger.error(
        `Could not work out the pay of delivery ${delivery.id} as an add on; no add on: ${errorSummaryForLog(error)}`
      )
      return 'NOT_ADDED'
    }
    // Review fix (decision 81.14): an add on always has a deadline, the co-op's offerExpirySeconds, even while
    // Offer expiry is off for ordinary offers. Without one, a calm add on (no insistent ring, no reminders)
    // held the order away from every other rider, free ones included, until the busy rider looked. The
    // setting is editable in admin whether the switch is on or off; nothing is hard coded here.
    const baseSeconds = await this.configDomainService.instanceConfig.getOfferExpirySeconds()
    // Cross check 2: twice the time while carrying food, so the rider can stop before answering.
    const expirySeconds = plan.carryingFood ? baseSeconds * 2 : baseSeconds
    const offeredAt = new Date()
    const offerExpiresAt = new Date(offeredAt.getTime() + expirySeconds * 1000)
    const stopSequence = sequence.stops.map((stop) => ({ deliveryId: stop.deliveryId, stop: stop.stop }))

    const claim = await this.deliveryRepository.claimAddOnWithinBox(
      delivery.id,
      courierId,
      job.id,
      plan.jobStatuses,
      { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: null, courierId: null },
      {
        matchedCourierId: courierId,
        offeredAt,
        offerExpiresAt,
        totalCost: amounts.totalCost,
        totalCompensation: amounts.totalCompensation,
        fee: amounts.fee,
        feePercentage: amounts.feePercentage,
        // Alone until accepted: the job joins it under one offerGroupId only then (joinAcceptedAddOn).
        offerGroupId: null,
        stopSequence,
        addOnExtraMetres: sequence.extraMetres,
        addOnExtraSeconds: sequence.extraSeconds,
      }
    )
    if (claim !== 'CLAIMED') {
      this.logger.log(`Add on of delivery ${delivery.id} to courier ${courierId} not written (${claim})`)
      return claim === 'NOT_WAITING' ? 'NOT_WAITING' : 'NOT_ADDED'
    }

    // A stop that began while this matching ran: take it back (row 29 review), as for a single offer.
    if (await this.dispatchStopRepository.findOn(new Date())) {
      await this.deliveryRepository.updateIfMatches(
        delivery.id,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: courierId, offeredAt, courierId: null },
        { matchedCourierId: null, offeredAt: null, offerExpiresAt: null, stopSequence: Prisma.DbNull }
      )
      this.logger.log(`Dispatch stopped while delivery ${delivery.id} was being offered as an add on; offer taken back`)
      return 'STOPPED'
    }

    this.logger.log(`Delivery ${delivery.id} is being offered to courier ${courierId} as an add on to delivery ${job.id}`)
    const figures = addOnFigures(sequence.extraMetres, sequence.extraSeconds)
    try {
      await this.saveOfferedEvent(
        delivery.id,
        courierId,
        EnumEventActor.SYSTEM,
        offerExpiresAt,
        null,
        [addOnPart(job.id, sequence, plan.carryingFood, plan.freeRiderFound)],
        addOnOfferReason({
          strategy: plan.strategy,
          currentDeliveryId: job.id,
          sequence,
          extraKm: figures?.extraKm ?? 0,
          extraMinutes: figures?.extraMinutes ?? 0,
          carryingFood: plan.carryingFood,
          candidateCount: plan.candidateCount,
          policy: plan.policy,
          freeRiderFound: plan.freeRiderFound,
        })
      )
    } catch (error) {
      this.logger.error(
        `Could not record OFFERED for delivery ${delivery.id}: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
    }
    await this.scheduleOfferExpiry(delivery.id, courierId, offeredAt, expirySeconds * 1000)
    await this.removeNoCourierRetry(delivery.id)

    try {
      const courier = await this.courierRepository.findById(courierId)
      const updatedDelivery = await this.deliveryRepository.findByIdOrThrow(delivery.id)
      if (courier) await this.sendOfferToRider(courier, updatedDelivery)
    } catch (error) {
      // The phone still finds the offer on its next fetch of new deliveries.
      this.logger.error(
        `Could not send the add on offer of ${delivery.id} to courier ${courierId}: ${errorSummaryForLog(error)}`
      )
    }
    return 'OFFERED'
  }

  // Row 81 (AC-10): an add on that left its offer. Accepted by the rider holding the job its stop list names:
  // the two become a pair (joinAcceptedAddOn). Ended any other way (cancelled, moved by an admin, accepted
  // for another rider): its stop list is cleared, since it names a job that is not its rider's. Never throws:
  // the list is only advisory.
  private async settleAddOnLeavingOffer(delivery: DeliveryEntity): Promise<void> {
    const jobId = addOnJobIdOf(delivery)
    if (!jobId) return
    try {
      const stops = delivery.stopSequence !== null ? stackStopsOf(delivery.stopSequence) : null
      if (delivery.status === EnumDeliveryStatus.ACCEPTED && delivery.courierId && stops) {
        const joined = await this.deliveryRepository.joinAcceptedAddOn(delivery.id, jobId, delivery.courierId, stops)
        this.logger.log(
          joined
            ? `Add on ${delivery.id} accepted; it rides with delivery ${jobId}`
            : `Add on ${delivery.id} accepted after delivery ${jobId} left its rider; it goes on alone`
        )
        return
      }
      await this.deliveryRepository.updateIfMatches(delivery.id, { offerGroupId: null }, { stopSequence: Prisma.DbNull })
    } catch (error) {
      this.logger.error(`Could not settle the stop list of add on ${delivery.id}: ${errorSummaryForLog(error)}`)
    }
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
        ...eventText('NO_COURIER_AVAILABLE', {}),
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
  // `reason`: spec 0044 (AC-6), why this rider. Written beside the event, after it: an offer whose
  // reason cannot be written is still made (pay first), and the failure is logged as an error.
  private async saveOfferedEvent(
    deliveryId: string,
    courierId: string,
    actor: EnumEventActor,
    offerExpiresAt: Date | null,
    replacedCourierId: string | null = null,
    // Spec 0054: what else the record says (timing, the stack's partner and stops, the add on), as parts.
    notes: EventPart[] = [],
    reason: OfferReasonInput | null = null
  ): Promise<void> {
    const deadline = offerExpiresAt
      ? eventPart('OFFER_DEADLINE', { at: offerExpiresAt.toISOString() })
      : eventPart('OFFER_NO_DEADLINE', {})
    const replaced = replacedCourierId ? [eventPart('OFFER_MOVED_BY_ADMIN', { courierId: replacedCourierId })] : []
    const offeredEvent: DeliveryOfferedEvent = {
      deliveryId,
      type: EnumDeliveryEventType.OFFERED,
      actor,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId,
      ...eventText('OFFERED', { courierId, deadline, extras: [...replaced, ...notes] }),
    }
    const saved = await this.saveDeliveryEvent(offeredEvent, {
      transitionSuccessful: true,
      oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
    })
    if (!reason) {
      this.logger.error(`Offer of delivery ${deliveryId} to courier ${courierId} has no reason to record (spec 0044)`)
      return
    }
    try {
      if (!this.offerReasonRepository) throw new Error('OfferReasonRepository is not provided')
      await this.offerReasonRepository.create(saved.id, deliveryId, courierId, reason)
    } catch (error) {
      this.logger.error(`Could not record the offer reason for delivery ${deliveryId}: ${errorSummaryForLog(error)}`)
    }
  }

  // Spec 0031, AC-2, AC-5, AC-6: when this offer is due, and what its event says. Never throws, and
  // never carries a coordinate into the note or a log line (value 5): a route that cannot be worked
  // out means the offer goes now and says so, so a delivery is never stuck waiting on the router.
  private async offerTimingOf(match: {
    courier: { id: string }
    delivery: { readyAt: Date | null; foodReadyAt: Date | null; undispatchedAt: Date | null }
    pickupLocation: { latitude: number; longitude: number }
    travelSeconds?: number | null
  }): Promise<OfferTiming> {
    const config = this.configDomainService.instanceConfig
    if (!(await config.getOfferTimingEnabled())) {
      return match.delivery.undispatchedAt ? this.holdAfterRiderLeft(match.delivery) : { dueInMs: 0, note: [] }
    }
    const readyTime = match.delivery.foodReadyAt ?? match.delivery.readyAt
    if (!readyTime) return { dueInMs: 0, note: [] }

    // Only asked when the matcher did not work it out. A null from the matcher already means no route.
    const travelSeconds =
      match.travelSeconds !== undefined
        ? match.travelSeconds
        : await this.roadSecondsToPickup(match.courier.id, match.pickupLocation)
    if (travelSeconds === null) return { dueInMs: 0, note: [eventPart('TIMING_TRAVEL_UNKNOWN', { readyAt: readyTime.toISOString() })] }

    const leadMinutes = await config.getOfferLeadMinutes()
    const dueAt = readyTime.getTime() - travelSeconds * 1000 - leadMinutes * 60_000
    return {
      dueInMs: dueAt - Date.now(),
      note: [
        eventPart('TIMING_TRAVEL', {
          readyAt: readyTime.toISOString(),
          travelMinutes: Math.round(travelSeconds / 60),
          leadMinutes,
        }),
      ],
    }
  }

  // Spec 0033 (AC-7): a rider left this order because the food was late, so with Timed offers off it
  // is still not offered again until the food is ready or nearly due. No travel time here: that is
  // part of Timed offers. Food marked ready, or no ready time at all, goes out as usual.
  private async holdAfterRiderLeft(delivery: { readyAt: Date | null; foodReadyAt: Date | null }): Promise<OfferTiming> {
    if (delivery.foodReadyAt || !delivery.readyAt) return { dueInMs: 0, note: [] }
    const leadMinutes = await this.configDomainService.instanceConfig.getOfferLeadMinutes()
    return {
      dueInMs: delivery.readyAt.getTime() - leadMinutes * 60_000 - Date.now(),
      note: [eventPart('TIMING_LEAD', { readyAt: delivery.readyAt.toISOString(), leadMinutes })],
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
      this.logger.warn(`No route for courier ${courierId} to the pickup: ${errorSummaryForLog(error)}`)
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
      this.logger.warn(
        `Could not read cancellationPayoutPolicy while cancelling ${dbDelivery.id}: ${errorSummaryForLog(error)}`
      )
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
        arrivedAtPickupAt: null,
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
      this.logger.error(
        `Could not tell the restaurant or rider that delivery ${dbDelivery.id} was cancelled: ${errorSummaryForLog(
          error
        )}`
      )
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
        this.logger.error(
          `Could not end the open offer of cancelled delivery ${dbDelivery.id}: ${errorSummaryForLog(error)}`
        )
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
      this.logger.error(`CANCELLATION_SETTLE_FAILED {"deliveryId":"${deliveryId}"}: ${errorSummaryForLog(error)}`)
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
      // Spec 0035 (AC-14): an approval after pickup sets the pay of this cancellation, for the amount
      // fixed at the approve; an unpaid reason pays nothing. Read first, so a failed read stops the
      // award: the sweep tries again, rather than paying under the wrong rule.
      let approved: DeliveryRemovalRequest | null
      try {
        approved = await this.removalRequestRepository.findApprovedAfterPickup(delivery.id, delivery.courierId)
      } catch (error) {
        this.logger.error(`REMOVAL_LOOKUP_FAILED {"deliveryId":"${delivery.id}"}: ${errorSummaryForLog(error)}`)
        return
      }
      const skipAward = approved !== null && !approved.paidToRider
      const awardDone = skipAward || (await this.awardCancellationPay(delivery, delivery.courierId, approved))
      if (approved && !approved.settledAt && awardDone) {
        // Caught here because this runs inside the cancel: a failed charge or stamp must not stop the
        // restaurant's webhook or the rider's cancelled job push. settledAt stays null for the sweep.
        try {
          await this.finishRemovalSettlement(delivery, approved)
        } catch (error) {
          this.logger.error(`REMOVAL_SETTLE_FAILED {"deliveryId":"${delivery.id}"}: ${errorSummaryForLog(error)}`)
        }
      }
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
  // `approved`, when set (spec 0035), is the removal approval whose fixed amount pays this cancellation.
  // Returns whether the row and its event are both written.
  private async awardCancellationPay(
    delivery: DeliveryEntity,
    courierId: string,
    approved: DeliveryRemovalRequest | null = null
  ): Promise<boolean> {
    const logContext: Record<string, string | number | null> = {
      deliveryId: delivery.id,
      courierId,
      amount: null,
      policy: null,
    }
    try {
      let award = await this.courierCompensationRepository.findCancellationAward(delivery.id)
      if (!award) {
        // Spec 0035 (AC-14): the amount and rule fixed at the approve, when there was one.
        const { policy, amount } =
          approved && approved.payAmount !== null && approved.payPolicy
            ? { policy: approved.payPolicy, amount: approved.payAmount }
            : await this.cancellationPayoutNow(delivery)
        logContext.amount = amount
        logContext.policy = policy
        award = await this.courierCompensationRepository.createCancellationAwardOnce({
          amount,
          currencyCode: delivery.currencyCode,
          reason: EnumCourierCompensationReason.CANCELLATION,
          policy,
          message: approved
            ? `Paid for a job cancelled after a removal was approved (${approved.label})`
            : `Paid for a job cancelled by ${delivery.cancelledBy ?? EnumCancelledBy.COOP}`,
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
          ...eventText('CANCELLATION_PAY', {
            courierId: award.courierId,
            amount: award.amount,
            currency: award.currencyCode,
            policy: award.policy,
            cancelledBy: delivery.cancelledBy ?? EnumCancelledBy.COOP,
          }),
        }
        await this.recordCancellationEvent(event, delivery.status)
      }
      return true
    } catch (error) {
      this.logger.error(
        `CANCELLATION_PAYOUT_FAILED ${JSON.stringify(logContext)}: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
      return false
    }
  }

  // The amount a cancellation with no removal approval behind it pays, read from the settings now.
  private async cancellationPayoutNow(delivery: DeliveryEntity): Promise<{ policy: string; amount: number }> {
    const menu = await this.configDomainService.instanceConfig.getReassignmentPayoutPolicies()
    // The rule in force at the cancellation (decision 32.18); a delivery cancelled before that
    // column existed, or whose read failed, falls back to the rule in force now.
    const storedPolicy =
      delivery.cancellationPayoutPolicy ??
      (await this.configDomainService.instanceConfig.getCancellationPayoutPolicy())
    const { policy, amount, warnings } = resolveCancellationPayout(menu, storedPolicy, delivery.totalCompensation)
    for (const warning of warnings) {
      this.logger.warn(`Cancellation pay for delivery ${delivery.id}: ${warning}`)
    }
    return { policy, amount }
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
        `CANCELLATION_CHARGE_FAILED ${JSON.stringify({
          deliveryId: delivery.id,
          partnerId: delivery.partnerId,
          amount,
        })}: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
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

  // Spec 0032: a product report and its resolution, with no status change.
  async recordProductReportEvent(
    event: DeliveryProductReportedEvent | DeliveryProductReportResolvedEvent,
    status: EnumDeliveryStatus
  ): Promise<void> {
    await this.saveDeliveryEvent(event, { transitionSuccessful: true, oldStatus: status, newStatus: status })
  }

  // Spec 0035 (AC-23): whether this very reassignment's REASSIGNED row was saved as successful.
  async hasSuccessfulReassignedWithMessage(deliveryId: string, message: string): Promise<boolean> {
    return this.deliveryEventRepository.hasSuccessfulReassignedWithMessage(deliveryId, message)
  }

  // Spec 0043: a box record (a size assumed or changed, an admin past a full box). No status change,
  // so never through processDeliveryEvent (which refuses these); old and new status are the same.
  async recordBoxEvent(event: DeliveryBoxEvent, status: EnumDeliveryStatus): Promise<void> {
    await this.saveDeliveryEvent(event, { transitionSuccessful: true, oldStatus: status, newStatus: status })
  }

  // Spec 0047: a split event, saved with the old status equal to the new (no status change).
  async recordSplitEvent(event: DeliverySplitEvent, status: EnumDeliveryStatus): Promise<void> {
    await this.saveDeliveryEvent(event, { transitionSuccessful: true, oldStatus: status, newStatus: status })
  }

  // Spec 0047 (AC-3), row 11 review: the stamp a closing write stores when the split wait earns pay under
  // the settings in force at the close (spec 0033's rule for `waitPayOwedAt`), or null. If the settings
  // cannot be read, the wait is stamped anyway: the settle reads the rate again, and an unpaid rider is the
  // worse mistake (value 4).
  async splitWaitOwedAt(flaggedAt: Date, endedAt: Date): Promise<Date | null> {
    try {
      const config = this.configDomainService.instanceConfig
      if (!(await config.getWaitPayEnabled())) return null
      if ((await config.getWaitPayCentsPerMinute()) <= 0) return null
      return splitWaitMinutes(flaggedAt, endedAt) > 0 ? endedAt : null
    } catch (error) {
      this.logger.error(`Could not read the wait pay settings for a split wait: ${errorSummaryForLog(error)}`)
      return endedAt
    }
  }

  // Spec 0047 (AC-3, cross check 1): the wait from a split flag to the close, paid at the co-op's rate with
  // no free minutes, whole minutes rounded down, as one WAITING award (policy SPLIT_WAIT) with its
  // COURIER_PAID_FOR_WAIT event, and charged to the restaurant when the request was CONFIRMED or LEFT (the
  // restaurant picked the size); REFUSED and VOID are the co-op's. Read from the stored request, so the
  // sweep can call it again: does nothing unless `waitOwedAt` is set, writes each piece once (keyed by the
  // request id), and clears the stamp only when all of them exist. Never throws.
  async settleSplitWait(requestId: string): Promise<void> {
    try {
      if (!this.splitRequestRepository) return
      const request = await this.splitRequestRepository.findById(requestId)
      const stamp = request?.waitOwedAt
      if (!request || !stamp) return
      const endedAt = request.answeredAt ?? stamp
      const chargeRestaurant =
        request.status === EnumSplitRequestStatus.CONFIRMED || request.status === EnumSplitRequestStatus.LEFT
      // The rate is read now, like spec 0033's settle: a rate set to 0 since the close writes nothing.
      const centsPerMinute = await this.configDomainService.instanceConfig.getWaitPayCentsPerMinute()
      const minutes = splitWaitMinutes(request.createdAt, endedAt)
      if (centsPerMinute > 0 && minutes > 0) {
        const delivery = await this.deliveryRepository.findByIdOrThrow(request.deliveryId)
        const award = await this.courierCompensationRepository.createSplitWaitPayOnce({
          amount: minutes * centsPerMinute,
          currencyCode: delivery.currencyCode,
          reason: EnumCourierCompensationReason.WAITING,
          policy: 'SPLIT_WAIT',
          message: `Waited ${minutes} min while dispatch split the order, at ${centsPerMinute} cents a minute`,
          waitMinutes: minutes,
          courierId: request.courierId,
          deliveryId: delivery.id,
          splitWaitOf: request.id,
        })
        // Found by the split request's id alone, so rewording the English template (en.ts) cannot hide the
        // first event and write a second (review of 2026-11-22). The id is a cuid: no other line carries it.
        const paidMessages = await this.deliveryEventRepository.findWaitPaidMessages(delivery.id)
        if (!paidMessages.some((message) => message.includes(request.id))) {
          const event: DeliveryCourierPaidForWaitEvent = {
            deliveryId: delivery.id,
            type: EnumDeliveryEventType.COURIER_PAID_FOR_WAIT,
            actor: EnumEventActor.SYSTEM,
            source: EnumDeliveryEventSource.OPENCOURIER,
            courierId: award.courierId,
            // The figures as the award stores them (review of 2026-11-22): on a retry createSplitWaitPayOnce
            // returns the first attempt's award, and the rate may have changed since, so the local values
            // could state a rate the rider was not paid at. The award's own minutes are the source.
            ...eventText('COURIER_PAID_FOR_SPLIT_WAIT', {
              courierId: award.courierId,
              amount: award.amount,
              currency: award.currencyCode,
              minutes: award.waitMinutes || minutes,
              centsPerMinute: award.waitMinutes ? Math.round(award.amount / award.waitMinutes) : centsPerMinute,
              splitId: request.id,
            }),
          }
          await this.saveDeliveryEvent(event, { transitionSuccessful: true, oldStatus: delivery.status, newStatus: delivery.status })
        }
        if (chargeRestaurant && delivery.partnerId) {
          await this.partnerChargeRepository.createSplitWaitChargeOnce({
            partnerId: delivery.partnerId,
            deliveryId: delivery.id,
            amount: award.amount,
            currencyCode: award.currencyCode,
            reason: EnumPartnerChargeReason.WAITING,
            waitMinutes: award.waitMinutes,
            splitWaitOf: request.id,
          })
        } else if (chargeRestaurant) {
          this.logger.warn(`Delivery ${delivery.id} has no restaurant: the split wait is not charged to anyone`)
        }
      }
      await this.splitRequestRepository.clearWaitOwed(request.id, stamp)
    } catch (error) {
      // The stamp stays, so the minute sweep tries again for a day.
      this.logger.error(`SPLIT_WAIT_PAY_FAILED split ${requestId}: ${errorSummaryForLog(error)}`)
    }
  }

  // Row 11 review: the minute sweep's step for split waits still owed, closed between `since` and `before`.
  // Returns how many it tried.
  async settleOwedSplitWaits(since: Date, before: Date): Promise<number> {
    if (!this.splitRequestRepository) return 0
    const owing = await this.splitRequestRepository.findOwingWait(since, before)
    for (const request of owing) await this.settleSplitWait(request.id)
    return owing.length
  }

  // Spec 0047 (cross check 6): whatever takes the rider off or ends the delivery closes an open split
  // request as VOID, pays the split wait up to now (the co-op's, nothing showed the size was wrong), and
  // says so on the record. Guarded by the caller.
  private async voidOpenSplitRequest(deliveryId: string, status: EnumDeliveryStatus): Promise<void> {
    if (!this.splitRequestRepository) return
    const open = await this.splitRequestRepository.findOpenForDelivery(deliveryId)
    if (!open) return
    const now = new Date()
    const closed = await this.splitRequestRepository.closeIfOpen(open.id, {
      status: EnumSplitRequestStatus.VOID,
      answeredAt: now,
      waitOwedAt: await this.splitWaitOwedAt(open.createdAt, now),
    })
    if (!closed) return
    const event: DeliverySplitClosedEvent = {
      deliveryId,
      type: EnumDeliveryEventType.SPLIT_CLOSED,
      actor: EnumEventActor.SYSTEM,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId: open.courierId,
      ...eventText('SPLIT_VOIDED', { splitId: open.id }),
    }
    try {
      await this.recordSplitEvent(event, status)
    } catch (error) {
      this.logger.error(`Could not record the void of split ${open.id}: ${errorSummaryForLog(error)}`)
    }
    await this.settleSplitWait(open.id)
  }

  // Spec 0047 (cross check 5): a leg made by a split that ends without ever being accepted takes back its
  // restaurant charge (unless already billed), with an event. Guarded by the caller.
  private async voidSplitLegChargeIfNeverAccepted(deliveryId: string, status: EnumDeliveryStatus): Promise<void> {
    if (await this.deliveryEventRepository.hasSuccessfulEvent(deliveryId, EnumDeliveryEventType.ACCEPTED)) return
    const { removed: voided, kept } = await this.partnerChargeRepository.deleteUnbilledSplitLegCharge(deliveryId)
    if (kept) {
      // Nothing changed, so no event: the charge is on a bill already, and an admin undoes that bill to take
      // it back (row 11 review).
      this.logger.warn(`Split leg ${deliveryId} ended never accepted, but its charge ${kept.id} is already billed and stays`)
    }
    if (!voided) return
    const event: DeliveryPartnerSplitChargeVoidedEvent = {
      deliveryId,
      type: EnumDeliveryEventType.PARTNER_SPLIT_CHARGE_VOIDED,
      actor: EnumEventActor.SYSTEM,
      source: EnumDeliveryEventSource.OPENCOURIER,
      ...eventText('SPLIT_LEG_CHARGE_VOIDED', { amount: voided.amount, currency: voided.currencyCode }),
    }
    await this.recordSplitEvent(event, status)
  }

  // Spec 0023. Records the restaurant's delay or food ready: no status change, so never through
  // processDeliveryEvent (which would drop it). No courierId: the restaurant acted, not a rider.
  async recordReadyEvent(
    event: DeliveryReadyDelayedEvent | DeliveryFoodReadyEvent,
    status: EnumDeliveryStatus
  ): Promise<void> {
    await this.saveDeliveryEvent(event, { transitionSuccessful: true, oldStatus: status, newStatus: status })
  }

  // Spec 0035: a removal event with no status change (or, `successful` false, an approval that did
  // not take). Never through processDeliveryEvent, which refuses these. Old and new status the same.
  async recordRemovalEvent(
    event: DeliveryRemovalEvent,
    status: EnumDeliveryStatus,
    successful = true
  ): Promise<void> {
    await this.saveDeliveryEvent(event, { transitionSuccessful: successful, oldStatus: status, newStatus: status })
  }

  // Spec 0035 (AC-9). Takes the rider off before pickup, as leaveWait does: the skip list first, one
  // conditional write back to waiting with any wait pay stamped in it, the event saved outside the
  // state machine's switch. Returns the event, or null if the delivery changed first; the caller
  // then records the failed approval and undoes its claim. The rest (the rider's and restaurant's
  // notices, and offering the order again) is finishRemovalBeforePickup, after the pay is written.
  async removeRiderBeforePickup(
    delivery: DeliveryEntity,
    courierId: string,
    label: string,
    // Spec 0054: the request's Greek label too, copied into the record with `label` (cross check 6).
    labelEl: string | null = null
  ): Promise<DeliveryRemovalApprovedEvent | null> {
    const deliveryId = delivery.id
    const oldStatus = delivery.status
    const endedAt = new Date()
    const waitPayOwed = await this.isWaitPayOwedAfterMove(delivery, endedAt)

    let addedToSkipList = false
    try {
      addedToSkipList = await addCourierToRejectedList(this.cacheService, deliveryId, courierId)
    } catch (error) {
      this.logger.error(
        `Could not put rider ${courierId} on the skip list of delivery ${deliveryId}: ${errorSummaryForLog(error)}`
      )
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
        arrivedAtPickupAt: null,
        undispatchedAt: endedAt,
        ...(waitPayOwed ? { waitPayOwedAt: new Date() } : {}),
      }
    )

    if (!written) {
      if (addedToSkipList) await this.undoSkipListEntry(deliveryId, courierId)
      return null
    }

    const event: DeliveryRemovalApprovedEvent = {
      deliveryId,
      type: EnumDeliveryEventType.REMOVAL_APPROVED,
      actor: EnumEventActor.ADMIN,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId,
      occurredAt: endedAt,
      ...eventText('REMOVAL_APPROVED', removalLabels({ label, labelEl })),
    }
    try {
      await this.saveDeliveryEvent(event, {
        transitionSuccessful: true,
        oldStatus,
        newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      })
    } catch (error) {
      this.logger.error(`Could not record REMOVAL_APPROVED for delivery ${deliveryId}: ${errorSummaryForLog(error)}`)
    }
    if (waitPayOwed) await this.settleWaitPay(deliveryId)
    return event
  }

  // The second half of removeRiderBeforePickup, after the pay and the rider's notice: the restaurant
  // and rider told the status changed, then the order offered again, held until the food is due.
  // Never throws: the rider is off whatever happens here, and the backstop sweep finds the delivery.
  async finishRemovalBeforePickup(
    event: DeliveryRemovalApprovedEvent,
    oldStatus: EnumDeliveryStatus
  ): Promise<void> {
    const { deliveryId, courierId } = event
    try {
      const updated = await this.deliveryRepository.findByIdOrThrow(deliveryId)
      if (updated.partnerId) {
        await this.notifyPartner(updated.partnerId, EnumDeliveryStatus.ASSIGNING_COURIER, oldStatus, event)
      }
      // The delivery no longer carries the rider's id, so tell them explicitly.
      await this.notifyCourier(courierId, updated, EnumDeliveryStatus.ASSIGNING_COURIER, oldStatus, event)
    } catch (error) {
      this.logger.error(
        `Could not tell the restaurant or rider that a rider came off delivery ${deliveryId}: ${errorSummaryForLog(
          error
        )}`
      )
    }
    try {
      await this.offerOrWait(deliveryId)
    } catch (error) {
      this.logger.error(
        `Could not start matching after a rider came off delivery ${deliveryId}: ${errorSummaryForLog(error)}`
      )
    }
  }

  // Spec 0035 (AC-13 to AC-15, AC-18). Writes an approved removal's money, whichever pieces are still
  // missing, then marks it settled. After pickup the existing cancellation settlement does this;
  // before pickup, a paid reason's REMOVAL row and event, then any charge. Safe to call any number of
  // times, inline and from the minute sweep. Never throws; a failure leaves settledAt null for the sweep.
  async settleRemoval(requestId: string): Promise<void> {
    try {
      const request = await this.removalRequestRepository.findById(requestId)
      if (!request || request.status !== EnumRemovalRequestStatus.APPROVED || request.settledAt) return
      if (request.afterPickup) {
        await this.settleCancellation(request.deliveryId)
        return
      }
      const delivery = await this.deliveryRepository.findById(request.deliveryId)
      if (!delivery) return
      if (request.paidToRider) await this.payRiderForRemoval(delivery, request)
      await this.finishRemovalSettlement(delivery, request)
    } catch (error) {
      this.logger.error(
        `REMOVAL_SETTLE_FAILED ${JSON.stringify({ requestId })}: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
    }
  }

  // AC-14, before pickup: one CourierCompensation (unique removalOf) and its event, for the amount
  // fixed at the approve. Check, then write, as the cancellation award does (single worker).
  private async payRiderForRemoval(delivery: DeliveryEntity, request: DeliveryRemovalRequest): Promise<void> {
    await this.courierCompensationRepository.createRemovalPayOnce({
      amount: request.payAmount ?? 0,
      currencyCode: delivery.currencyCode,
      reason: EnumCourierCompensationReason.REMOVAL,
      policy: request.payPolicy ?? 'REMOVAL',
      message: `Paid for coming off a delivery: ${request.label}`,
      courierId: request.courierId,
      deliveryId: delivery.id,
      removalOf: request.id,
    })

    // The event's message carries the request's id (`removal <request id>`) and this check reads it: keep the
    // id in the template. Found by the id alone, so rewording the rest cannot write a second event.
    const paid = await this.deliveryEventRepository.findMessagesOfType(
      delivery.id,
      EnumDeliveryEventType.COURIER_PAID_FOR_REMOVAL
    )
    if (!paid.some((message) => message.includes(request.id))) {
      const event: DeliveryCourierPaidForRemovalEvent = {
        deliveryId: delivery.id,
        type: EnumDeliveryEventType.COURIER_PAID_FOR_REMOVAL,
        actor: EnumEventActor.SYSTEM,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: request.courierId,
        ...eventText('COURIER_PAID_FOR_REMOVAL', {
          courierId: request.courierId,
          amount: request.payAmount ?? 0,
          currency: delivery.currencyCode,
          policy: request.payPolicy,
          ...removalLabels(request),
          requestId: request.id,
        }),
      }
      await this.recordRemovalEvent(event, delivery.status)
    }
  }

  // AC-15: the charge, on either path, then the request is settled. The charge is the amount fixed at
  // the approve, written once (unique removalOf), only on a delivery with a partner, and never a
  // delivery fee. Throws on a failure, for settleRemoval or the sweep to retry; settledAt stays null.
  private async finishRemovalSettlement(delivery: DeliveryEntity, request: DeliveryRemovalRequest): Promise<void> {
    if (request.chargedToRestaurant && delivery.partnerId) {
      const amount = request.payAmount ?? 0
      await this.partnerChargeRepository.createRemovalChargeOnce({
        partnerId: delivery.partnerId,
        deliveryId: delivery.id,
        amount,
        currencyCode: delivery.currencyCode,
        reason: EnumPartnerChargeReason.REMOVAL,
        removalOf: request.id,
      })
      const charged = await this.deliveryEventRepository.findMessagesOfType(
        delivery.id,
        EnumDeliveryEventType.PARTNER_CHARGED_FOR_REMOVAL
      )
      // By the request's id alone, as the rider's event above.
      if (!charged.some((message) => message.includes(request.id))) {
        const event: DeliveryPartnerChargedForRemovalEvent = {
          deliveryId: delivery.id,
          type: EnumDeliveryEventType.PARTNER_CHARGED_FOR_REMOVAL,
          actor: EnumEventActor.SYSTEM,
          source: EnumDeliveryEventSource.OPENCOURIER,
          ...eventText('PARTNER_CHARGED_FOR_REMOVAL', {
            amount,
            currency: delivery.currencyCode,
            ...removalLabels(request),
            requestId: request.id,
          }),
        }
        await this.recordRemovalEvent(event, delivery.status)
      }
    }
    await this.removalRequestRepository.markSettled(request.id)
  }

  // Spec 0035 (AC-16, AC-18). Pays the trip back to the restaurant when a rider recorded RETURNED on
  // a job cancelled after pickup: the quote's distance fee times the co-op's percent. No rider
  // position is read. A zero amount writes nothing. Safe to call any number of times. Never throws.
  async settleReturnTrip(deliveryId: string): Promise<void> {
    try {
      const { delivery, quote } = await this.deliveryRepository.findByIdOrThrowWithQuote(deliveryId)
      if (delivery.foodOutcome !== EnumFoodOutcome.RETURNED || !delivery.courierId) return

      let award = await this.courierCompensationRepository.findReturnTripAward(deliveryId)
      if (!award) {
        const percent = await this.configDomainService.instanceConfig.getReturnTripPayPercent()
        const amount = roundMoney((quote.distanceFee * percent) / 100)
        if (amount <= 0) return
        award = await this.courierCompensationRepository.createReturnTripPayOnce({
          amount,
          currencyCode: delivery.currencyCode,
          reason: EnumCourierCompensationReason.RETURN_TRIP,
          policy: 'RETURN_TRIP',
          message: `The trip back to the restaurant, at ${percent}% of the distance fee`,
          courierId: delivery.courierId,
          deliveryId,
          returnOf: deliveryId,
        })
      }

      const paidEvent = await this.deliveryEventRepository.findLatestOfTypes(deliveryId, [
        EnumDeliveryEventType.COURIER_PAID_FOR_RETURN_TRIP,
      ])
      if (!paidEvent) {
        const event: DeliveryCourierPaidForReturnTripEvent = {
          deliveryId,
          type: EnumDeliveryEventType.COURIER_PAID_FOR_RETURN_TRIP,
          actor: EnumEventActor.SYSTEM,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId: award.courierId,
          ...eventText('COURIER_PAID_FOR_RETURN_TRIP', {
            courierId: award.courierId,
            amount: award.amount,
            currency: award.currencyCode,
          }),
        }
        await this.recordRemovalEvent(event, delivery.status)
      }
    } catch (error) {
      this.logger.error(
        `RETURN_TRIP_SETTLE_FAILED ${JSON.stringify({ deliveryId })}: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
    }
  }

  // Spec 0047 (AC-7, cross check 12): tells the rider dispatch's answer to their split request, over the live
  // connection and by push. Never throws: the answer is already on the record.
  async notifySplitDecided(courierId: string, message: SplitRequestDecidedMessage): Promise<void> {
    try {
      const courier = await this.courierRepository.findById(courierId)
      if (courier?.userId) {
        await this.websocketDispatcher.sendSplitRequestDecided(courier.userId, message)
      }
    } catch (error) {
      this.logger.error(
        `Could not tell the rider of delivery ${message.deliveryId} the split outcome: ${errorSummaryForLog(error)}`
      )
    }
    this.offerPushService.splitRequestDecided(courierId, message)
  }

  // Spec 0035 (AC-11): tells the rider dispatch's answer, over the live connection and by push. Never
  // throws: the decision already happened and is on the record.
  async notifyRemovalDecided(courierId: string, message: RemovalRequestDecidedMessage): Promise<void> {
    try {
      const courier = await this.courierRepository.findById(courierId)
      if (courier?.userId) {
        await this.websocketDispatcher.sendRemovalRequestDecided(courier.userId, message)
      }
    } catch (error) {
      this.logger.error(
        `Could not tell the rider of delivery ${message.deliveryId} the removal outcome: ${errorSummaryForLog(error)}`
      )
    }
    this.offerPushService.removalRequestDecided(courierId, message)
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
      this.logger.error(
        `Could not tell the rider of delivery ${delivery.id} its ready time changed: ${errorSummaryForLog(error)}`
      )
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
  // `push` false: the open app hears of it, but no push goes out (the second order of a stack, whose push
  // the first one's carries, spec 0048 cross check 11).
  private async sendOfferToRider(courier: { id: string; userId: string }, delivery: DeliveryEntity, push = true) {
    try {
      await this.websocketDispatcher.sendOfferToCourier(courier.userId, new DeliveryCourierDto(delivery))
    } finally {
      if (push) this.offerPushService.newOffer(courier.id, delivery.id)
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
      this.logger.error(`Could not set the expiry timer of delivery ${deliveryId}: ${errorSummaryForLog(error)}`)
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
      this.logger.error(`Could not set the retry timer of delivery ${deliveryId}: ${errorSummaryForLog(error)}`)
    }
  }

  private async removeNoCourierRetry(deliveryId: string) {
    try {
      await this.bullMQService.removeDelayedJobsWithIdPrefix(noCourierRetryJobIdPrefix(deliveryId))
    } catch (error) {
      this.logger.error(`Could not remove the retry timer of delivery ${deliveryId}: ${errorSummaryForLog(error)}`)
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
        `Error sending event notification for delivery ${event.deliveryId} to partner ${userId}: ${errorSummaryForLog(
          error
        )}`
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
        `Error sending event notification for delivery ${delivery.id} to courier ${courierId}: ${errorSummaryForLog(
          error
        )}`
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
      // Spec 0054: a text that replaces the event's own (a failed row says why it failed).
      text?: EventText
    }
  ) {
    // Only OFFERED and OFFER_EXPIRED name a rider in the courierId column (spec 0002). Every
    // other event leaves it out (null), even when the event object carries a courierId.
    // Checking `type` narrows the union, so TypeScript knows courierId is a string on these two.
    // Spec 0015 adds the three cancellation records, which are each about one rider; spec 0016 the
    // rider's drop off pin move; spec 0033 who picked up, left, or was paid for a wait.
    const riderId =
      deliveryEvent.type === EnumDeliveryEventType.OFFERED ||
      deliveryEvent.type === EnumDeliveryEventType.OFFER_EXPIRED ||
      deliveryEvent.type === EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION ||
      deliveryEvent.type === EnumDeliveryEventType.FOOD_RETURNED ||
      deliveryEvent.type === EnumDeliveryEventType.FOOD_NOT_RETURNED ||
      deliveryEvent.type === EnumDeliveryEventType.DROPOFF_POINT_CORRECTED ||
      deliveryEvent.type === EnumDeliveryEventType.HANDED_BACK ||
      deliveryEvent.type === EnumDeliveryEventType.PRODUCT_REPORTED ||
      deliveryEvent.type === EnumDeliveryEventType.PICKED_UP ||
      deliveryEvent.type === EnumDeliveryEventType.WAIT_UNDISPATCHED ||
      deliveryEvent.type === EnumDeliveryEventType.COURIER_PAID_FOR_WAIT ||
      // Spec 0035: the rider of a request, its answer and the removal or return trip pay. The
      // dispatch stop's return names a rider too, whose wait it now pays.
      deliveryEvent.type === EnumDeliveryEventType.RETURNED_TO_WAITING ||
      deliveryEvent.type === EnumDeliveryEventType.REMOVAL_REQUESTED ||
      deliveryEvent.type === EnumDeliveryEventType.REMOVAL_WITHDRAWN ||
      deliveryEvent.type === EnumDeliveryEventType.REMOVAL_DECLINED ||
      deliveryEvent.type === EnumDeliveryEventType.REMOVAL_APPROVED ||
      deliveryEvent.type === EnumDeliveryEventType.COURIER_PAID_FOR_REMOVAL ||
      deliveryEvent.type === EnumDeliveryEventType.COURIER_PAID_FOR_RETURN_TRIP ||
      // Spec 0038: the rider who asked for a review. These rows are normally written by the review
      // request's transaction; listed here so any path that saves one keeps the rider.
      deliveryEvent.type === EnumDeliveryEventType.REVIEW_REQUESTED ||
      deliveryEvent.type === EnumDeliveryEventType.REVIEW_ANSWERED ||
      deliveryEvent.type === EnumDeliveryEventType.COURIER_PAID_FOR_REVIEW ||
      // Spec 0043: the rider an admin put past a full box, so it is on that rider's record too.
      deliveryEvent.type === EnumDeliveryEventType.BOX_OVER_CAPACITY_CONFIRMED ||
      // Spec 0047: the rider who flagged a split, its answer and its close.
      deliveryEvent.type === EnumDeliveryEventType.SPLIT_REQUESTED ||
      deliveryEvent.type === EnumDeliveryEventType.SPLIT_CONFIRMED ||
      deliveryEvent.type === EnumDeliveryEventType.SPLIT_REFUSED ||
      deliveryEvent.type === EnumDeliveryEventType.SPLIT_CLOSED ||
      // Spec 0040 (AC-2): the accepting rider, automatic, manual or admin, so time worked can find
      // each rider's jobs (Delivery.courierId only holds the latest rider).
      deliveryEvent.type === EnumDeliveryEventType.ACCEPTED
        ? deliveryEvent.courierId
        : // A REASSIGNED row stores the rider it was taken from (AC-20); the event's courierId is the new one.
          deliveryEvent.type === EnumDeliveryEventType.REASSIGNED
          ? deliveryEvent.droppedCourierId ?? undefined
          : undefined

    const saved = await this.deliveryEventRepository.create({
      ...(riderId !== undefined ? { courierId: riderId } : {}),
      // A step that waited for signal keeps its tap time, on the success row and the failed row
      // alike (spec 0009, AC-7). Left out, the column default (now) records the arrival.
      ...(deliveryEvent.occurredAt ? { occurredAt: deliveryEvent.occurredAt } : {}),
      actor: deliveryEvent.actor,
      eventSource: deliveryEvent.source,
      // Spec 0054 (AC-4): the code, its values and the English sentence rendered from them, together.
      ...storedEventText(outcome.text ?? deliveryEvent),
      newStatus: outcome.newStatus || null,
      oldStatus: outcome.oldStatus || null,
      deliveryId: deliveryEvent.deliveryId,
      transitionSuccessful: outcome.transitionSuccessful,
      type: deliveryEvent.type,
    })

    // Spec 0035 (AC-12): whatever took the rider off or ended the delivery closes an open removal
    // request. One rule, here, so a future path cannot forget it: `CLOSED` has no event of its own,
    // since the event that closed it is on the trail. Guarded, so a failure never breaks this event.
    if (
      outcome.transitionSuccessful &&
      outcome.newStatus &&
      !DELIVERY_ONGOING_STATUSES.includes(outcome.newStatus)
    ) {
      try {
        await this.removalRequestRepository.closeOpenForDelivery(deliveryEvent.deliveryId)
      } catch (error) {
        this.logger.error(
          `Could not close an open removal request of delivery ${deliveryEvent.deliveryId}: ${errorSummaryForLog(
            error
          )}`
        )
      }
      // Spec 0047 (cross check 5): a split leg that ended without a rider ever taking it.
      if (
        outcome.oldStatus !== outcome.newStatus &&
        (outcome.newStatus === EnumDeliveryStatus.CANCELED || outcome.newStatus === EnumDeliveryStatus.FAILED)
      ) {
        try {
          await this.voidSplitLegChargeIfNeverAccepted(deliveryEvent.deliveryId, outcome.newStatus)
        } catch (error) {
          this.logger.error(
            `Could not take back the split charge of delivery ${deliveryEvent.deliveryId}: ${errorSummaryForLog(error)}`
          )
        }
      }
    }

    // Spec 0047 (cross check 6), row 11 review: a split request is only open while the rider is at the
    // restaurant, so any step that moves the delivery off that status closes it as VOID and pays its wait: a
    // pickup posted by an admin, a cancellation, a removal, a reassignment, a return to waiting. Not on the
    // split events themselves, which keep the status (so the close cannot re-enter itself). Guarded.
    if (
      outcome.transitionSuccessful &&
      outcome.oldStatus === EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION &&
      outcome.newStatus &&
      outcome.newStatus !== outcome.oldStatus
    ) {
      try {
        await this.voidOpenSplitRequest(deliveryEvent.deliveryId, outcome.newStatus)
      } catch (error) {
        this.logger.error(
          `Could not close an open split request of delivery ${deliveryEvent.deliveryId}: ${errorSummaryForLog(error)}`
        )
      }
    }

    // Spec 0048 (AC-5): a delivery of an open stack that left the offer some other way than the rider's answer
    // (a cancellation, an admin's accept on the rider's behalf) leaves the other order offered to the same
    // rider alone, so it can still be taken. A group accept is untouched: both are taken by then. One rule,
    // here, so a future path cannot forget it. Guarded.
    if (
      outcome.transitionSuccessful &&
      outcome.oldStatus === EnumDeliveryStatus.ASSIGNING_COURIER &&
      outcome.newStatus &&
      outcome.newStatus !== EnumDeliveryStatus.ASSIGNING_COURIER
    ) {
      try {
        const moved = await this.deliveryRepository.findById(deliveryEvent.deliveryId)
        if (moved?.offerGroupId) await this.releaseStackPartners(moved.offerGroupId, moved.id)
        // Row 81: an add on (alone, with a stop list through the rider's job) joins that job when its rider
        // accepted it, and loses the list on any other way out. One rule, here, like the stack's above.
        else if (moved && moved.stopSequence !== null) await this.settleAddOnLeavingOffer(moved)
      } catch (error) {
        this.logger.error(
          `Could not release the stack partner of delivery ${deliveryEvent.deliveryId}: ${errorSummaryForLog(error)}`
        )
      }
    }

    // Spec 0048 (cross check 6): once the two deliveries of a stack are no longer with one rider (an order
    // delivered, cancelled, moved or handed back), the stop sequence is cleared on both and the survivor
    // goes on alone. Checked on every status change of a delivery that is part of a stack; one rule, here,
    // so a future path cannot forget it. Guarded: a sequence left behind is only advisory.
    if (outcome.transitionSuccessful && outcome.oldStatus !== outcome.newStatus) {
      try {
        const changed = await this.deliveryRepository.findById(deliveryEvent.deliveryId)
        if (changed?.offerGroupId && changed.stopSequence !== null) {
          await this.settleStackStops(changed.offerGroupId, changed.id)
        }
      } catch (error) {
        this.logger.error(
          `Could not settle the stop sequence of delivery ${deliveryEvent.deliveryId}: ${errorSummaryForLog(error)}`
        )
      }
    }

    // Spec 0038 (AC-15): a step that moved a delivery (a drop off, a cancellation, a removal, a
    // reassignment, a return to waiting, a hand back, leaving a wait, an offer ending) may have left an
    // Offline rider with no job: their stored position is erased now. One rule, here, so a future path
    // cannot forget it. The review events, saved with null statuses, never get here. Guarded, so a
    // failure never breaks this event.
    if (outcome.transitionSuccessful && outcome.oldStatus && outcome.newStatus) {
      try {
        await this.courierRepository.clearLocationIfOfflineAndFree()
      } catch (error) {
        this.logger.error(
          `Could not erase positions after an event on delivery ${deliveryEvent.deliveryId}: ${errorSummaryForLog(
            error
          )}`
        )
      }
    }
    return saved
  }

  async schedulePickupDeliveryFulfillAndCapture(deliveryId: string) {
    const date = new Date(Date.now() + PICKUP_ORDER_FORCED_FULFILL_DELAY_MINUTES * 60 * 1000)

    this.logger.log(`Scheduling ${deliveryId} order pickup fulfillment ${date}`)
    await this.taskScheduler.scheduleTask<ForcePickupFulfillmentPayload>('schedule-force-pickup-fulfillment', date, {
      deliveryId,
    })
  }
}

// Spec 0054: the same ended offer, said of one order of two offered together. Each code that ends an offer
// has a stack twin, so the record keeps its shape (cross check 6: a new shape is a new code).
const STACK_VARIANT: Partial<Record<EventText['messageCode'], EventText['messageCode']>> = {
  OFFER_EXPIRED_AFTER: 'OFFER_EXPIRED_AFTER_STACK',
  RIDER_WENT_OFFLINE: 'RIDER_WENT_OFFLINE_STACK',
  DISPATCH_STOP_OFFER_ENDED: 'DISPATCH_STOP_OFFER_ENDED_STACK',
}

function stackVariantOf(text: EventText): EventText {
  const code = STACK_VARIANT[text.messageCode]
  if (!code) return text
  // The twin takes the same params as the code it stands for (see EVENT_MESSAGE_CODES).
  return eventText(code, text.messageParams as never)
}

// Spec 0054: the wait pay event's text, from what the rider's award row says. The minutes and rate are
// numbers on the award (spec 0036), so the record can be shown in any language; an award from before those
// columns keeps its English sentence as a note.
function waitPaidText(
  award: { courierId: string; amount: number; currencyCode: string; message: string | null; waitMinutes: number | null },
  waitOf: string
): EventText {
  const base = { courierId: award.courierId, amount: award.amount, currency: award.currencyCode, waitOf }
  if (award.waitMinutes && award.amount % award.waitMinutes === 0) {
    return eventText('COURIER_PAID_FOR_WAIT', {
      ...base,
      minutes: award.waitMinutes,
      centsPerMinute: award.amount / award.waitMinutes,
    })
  }
  return eventText('COURIER_PAID_FOR_WAIT_NOTE', { ...base, note: award.message ?? '' })
}

// Spec 0054 (cross check 6): a removal reason's two labels as a record carries them. A reason with no Greek
// label shows its English one in Greek too, so neither language reads blank.
// `labelEl?` is optional so a request row is accepted whether or not the generated client has the column yet.
export function removalLabels(source: { label: string; labelEl?: string | null }): { label: string; labelEl: string } {
  return { label: source.label, labelEl: source.labelEl || source.label }
}
