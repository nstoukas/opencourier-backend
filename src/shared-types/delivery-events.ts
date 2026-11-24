import {
  EnumDeliveryEventType,
  EnumEventActor,
  EnumDeliveryEventSource,
  EnumDeliveryStatus,
  EnumCancelledBy,
} from '@prisma/types'
import type { EventMessageCode, EventMessageParams } from './event-messages'

// DELIVERY EVENTS
export { EnumDeliveryEventType, EnumEventActor, EnumDeliveryEventSource, EnumDeliveryStatus, EnumCancelledBy }

export interface BaseDeliveryEvent {
  deliveryId: string
  type: EnumDeliveryEventType
  actor: EnumEventActor
  source: EnumDeliveryEventSource
  courierId?: string | null
  // The English sentence. Since spec 0054 it is rendered from messageCode and messageParams: build all
  // three with eventText() (src/domains/delivery-event/event-text.ts), never by hand.
  message?: string
  messageCode?: EventMessageCode
  messageParams?: EventMessageParams
  // When the event happened, if not when it is processed: a rider's job step that waited on the
  // phone for signal (spec 0009). Left out, the stored occurredAt is the moment it is saved.
  occurredAt?: Date
}

export interface DeliveryCreatedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.CREATED
}
export interface DeliveryConfirmedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.CONFIRMED
}
export interface DeliveryAcceptedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.ACCEPTED
}
export interface DeliveryRejectedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.REJECTED
}
export interface DeliveryCanceledEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.CANCELED
  // Who asked (spec 0015). Left out by an older caller: the event service treats it as COOP.
  cancelledBy?: EnumCancelledBy
}
// Spec 0015: recorded by DeliveryEventService on a cancelled delivery, never through
// processDeliveryEvent (no status changes). `courierId` is the rider the event is about.
export interface DeliveryCourierPaidForCancellationEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION
  courierId: string
}
export interface DeliveryFoodReturnedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.FOOD_RETURNED
  courierId: string
}
export interface DeliveryFoodNotReturnedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.FOOD_NOT_RETURNED
  courierId: string
}
// Spec 0016: a rider moved the drop off pin to where they stand. Recorded by DeliveryEventService
// without a status change, never through processDeliveryEvent. Row 102: a restaurant's own move is
// the same event with the actor PARTNER and no courierId (it was not a rider).
export interface DeliveryDropoffPointCorrectedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.DROPOFF_POINT_CORRECTED
  courierId?: string
}
// Spec 0023: the restaurant moved the ready time, or marked the food ready. Recorded by
// DeliveryEventService without a status change, never through processDeliveryEvent.
export interface DeliveryReadyDelayedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.READY_DELAYED
}
export interface DeliveryFoodReadyEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.FOOD_READY
}
export interface DeliveryFailedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.FAILED
}
export interface DeliveryReassignedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.REASSIGNED
  courierId: string
  // Spec 0035 (AC-20): the rider it was taken from, stored on the row so a wait is paid to whoever
  // actually waited. `courierId` above stays the new rider.
  droppedCourierId?: string | null
  // Spec 0044 (AC-6): the admin who moved it, for the new offer's reason. Not stored on the event row.
  adminUserId?: string | null
}
// Spec 0014. Dispatch stopped while `courierId` held this delivery, not yet picked up: it goes back
// to waiting with nobody, and that rider is paid by the co-op's reassignment payout setting.
export interface DeliveryReturnedToWaitingEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.RETURNED_TO_WAITING
  courierId: string
}

// Spec 0020. A rider gave an accepted order back inside the free window; it went back to matching.
// Recorded by DeliveryEventService.handBack only, never through processDeliveryEvent's switch.
export interface DeliveryHandedBackEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.HANDED_BACK
  courierId: string
}


// Spec 0002. An offer went out to `courierId` (actor SYSTEM for matching, ADMIN for an admin offer).
// Recorded by DeliveryEventService itself, never emitted through processDeliveryEvent.
export interface DeliveryOfferedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.OFFERED
  courierId: string
}
// The offer to `courierId` ended unanswered: its deadline passed, or the rider went offline.
// Emitted through processDeliveryEvent, which then offers the delivery to the next rider.
// Never a REJECTED, so expiries can never be counted as refusals (value 5).
export interface DeliveryOfferExpiredEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.OFFER_EXPIRED
  courierId: string
}
// Matching found no free rider. Names no rider. Recorded once per waiting spell.
export interface DeliveryNoCourierAvailableEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.NO_COURIER_AVAILABLE
}

export interface DeliveryFulfilledEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.FULFILLED
}

export interface DeliveryDispatchedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.DISPATCHED
}

export interface DeliveryCourierArrivedAtPickUpLocationEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION
}

export interface DeliveryPickedUpEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.PICKED_UP
}

export interface DeliveryCourierArrivedAtDropOffLocationEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.ARRIVED_AT_DROPOFF_LOCATION
}
// Spec 0032: a wrong or missing product, and its resolution. Recorded without a status change;
// `courierId` only when a rider filed it.
export interface DeliveryProductReportedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.PRODUCT_REPORTED
  courierId?: string
}
export interface DeliveryProductReportResolvedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.PRODUCT_REPORT_RESOLVED
}
// Spec 0033: a rider left a restaurant that kept them past the limit, and the pay for a wait. Both
// written by DeliveryEventService itself, never processed as ordinary events.
export interface DeliveryWaitUndispatchedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.WAIT_UNDISPATCHED
  courierId: string
}
export interface DeliveryCourierPaidForWaitEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.COURIER_PAID_FOR_WAIT
  courierId: string
}
// Spec 0035: a rider asks dispatch to take them off an order, the answer, and the money. Each is
// written by its own path, never processed as an ordinary event, and names the rider, except
// the restaurant's charge, which does not depend on who rode. A message names the reason's label
// and never the rider's note.
export interface DeliveryRemovalRequestedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.REMOVAL_REQUESTED
  courierId: string
}
export interface DeliveryRemovalWithdrawnEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.REMOVAL_WITHDRAWN
  courierId: string
}
export interface DeliveryRemovalDeclinedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.REMOVAL_DECLINED
  courierId: string
}
export interface DeliveryRemovalApprovedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.REMOVAL_APPROVED
  courierId: string
}
export interface DeliveryCourierPaidForRemovalEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.COURIER_PAID_FOR_REMOVAL
  courierId: string
}
export interface DeliveryPartnerChargedForRemovalEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.PARTNER_CHARGED_FOR_REMOVAL
}
export interface DeliveryCourierPaidForReturnTripEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.COURIER_PAID_FOR_RETURN_TRIP
  courierId: string
}

// Spec 0038: a rider asked a person to review a decision about this delivery, the answer, and a pay
// correction. Written by the review request's own transaction (ReviewRequestRepository) with null
// statuses, never processed as ordinary events. A message names the topic or the outcome, never the
// rider's note or the admin's answer.
export interface DeliveryReviewRequestedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.REVIEW_REQUESTED
  courierId: string
}
export interface DeliveryReviewAnsweredEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.REVIEW_ANSWERED
  courierId: string
}
export interface DeliveryCourierPaidForReviewEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.COURIER_PAID_FOR_REVIEW
  courierId: string
}

// Spec 0043: the box model's three records, written by DeliveryEventService.recordBoxEvent with the
// old status equal to the new, never through processDeliveryEvent. BOX_SIZE_ASSUMED is SYSTEM (no
// size was sent), BOX_SIZE_CHANGED is the restaurant's, BOX_OVER_CAPACITY_CONFIRMED the admin's
// (`courierId` is the rider put past a full box).
export interface DeliveryBoxSizeAssumedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.BOX_SIZE_ASSUMED
}
export interface DeliveryBoxSizeChangedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.BOX_SIZE_CHANGED
}
export interface DeliveryBoxOverCapacityConfirmedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.BOX_OVER_CAPACITY_CONFIRMED
  courierId: string
}
// Spec 0047: split at pickup. Written by DeliveryEventService.recordSplitEvent with the old status equal to
// the new, never through processDeliveryEvent. The request, the answer and the close name the rider;
// the restaurant's charge and its voiding do not depend on who rode. A message names the legs and sizes,
// never the admin's sentence.
export interface DeliverySplitRequestedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.SPLIT_REQUESTED
  courierId: string
}
export interface DeliverySplitConfirmedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.SPLIT_CONFIRMED
  courierId: string
}
export interface DeliverySplitRefusedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.SPLIT_REFUSED
  courierId: string
}
export interface DeliverySplitClosedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.SPLIT_CLOSED
  courierId: string
}
export interface DeliveryPartnerChargedForSplitEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.PARTNER_CHARGED_FOR_SPLIT
}
export interface DeliveryPartnerSplitChargeVoidedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.PARTNER_SPLIT_CHARGE_VOIDED
}
// Row 146: an accepted add on joined its rider's job. Written on the job (deliveryId is the job), naming
// the added delivery in its message; courierId is the rider who now carries both. No status change.
export interface DeliveryAddOnJoinedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.ADD_ON_JOINED
  courierId: string
}
// Row 149: that add on left the job before its drop off. Written on the job, naming the add on; courierId is
// the rider who carried both until then. No status change.
export interface DeliveryAddOnLeftEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.ADD_ON_LEFT
  courierId: string
}
// Row 160: a restaurant's edit changed the tip, which is rider pay. Before a rider holds the order, so no
// courierId. No status change.
export interface DeliveryTipChangedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.TIP_CHANGED
}
export type DeliverySplitEvent =
  | DeliverySplitRequestedEvent
  | DeliverySplitConfirmedEvent
  | DeliverySplitRefusedEvent
  | DeliverySplitClosedEvent
  | DeliveryPartnerChargedForSplitEvent
  | DeliveryPartnerSplitChargeVoidedEvent

export type DeliveryBoxEvent =
  | DeliveryBoxSizeAssumedEvent
  | DeliveryBoxSizeChangedEvent
  | DeliveryBoxOverCapacityConfirmedEvent

export type DeliveryReviewEvent =
  | DeliveryReviewRequestedEvent
  | DeliveryReviewAnsweredEvent
  | DeliveryCourierPaidForReviewEvent

export type DeliveryRemovalEvent =
  | DeliveryRemovalRequestedEvent
  | DeliveryRemovalWithdrawnEvent
  | DeliveryRemovalDeclinedEvent
  | DeliveryRemovalApprovedEvent
  | DeliveryCourierPaidForRemovalEvent
  | DeliveryPartnerChargedForRemovalEvent
  | DeliveryCourierPaidForReturnTripEvent

export interface DeliveryOnTheWayEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.ON_THE_WAY
}

export interface DeliveryDroppedOffEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.DROPPED_OFF
  deliveredData: {
    imageData?: Buffer
    imageName?: string
    imageType?: string
  }
}

export type DeliveryEvent =
  | DeliveryCreatedEvent
  | DeliveryAcceptedEvent
  | DeliveryDispatchedEvent
  | DeliveryRejectedEvent
  | DeliveryConfirmedEvent
  | DeliveryFulfilledEvent
  | DeliveryCourierArrivedAtPickUpLocationEvent
  | DeliveryPickedUpEvent
  | DeliveryOnTheWayEvent
  | DeliveryCourierArrivedAtDropOffLocationEvent
  | DeliveryDroppedOffEvent
  | DeliveryCanceledEvent
  | DeliveryFailedEvent
  | DeliveryReassignedEvent
  | DeliveryReturnedToWaitingEvent
  | DeliveryHandedBackEvent
  | DeliveryOfferedEvent
  | DeliveryOfferExpiredEvent
  | DeliveryNoCourierAvailableEvent
  | DeliveryCourierPaidForCancellationEvent
  | DeliveryFoodReturnedEvent
  | DeliveryFoodNotReturnedEvent
  | DeliveryDropoffPointCorrectedEvent
  | DeliveryReadyDelayedEvent
  | DeliveryProductReportedEvent
  | DeliveryWaitUndispatchedEvent
  | DeliveryCourierPaidForWaitEvent
  | DeliveryProductReportResolvedEvent
  | DeliveryFoodReadyEvent
  | DeliveryRemovalEvent
  | DeliveryReviewEvent
  | DeliveryBoxEvent
  | DeliverySplitEvent
  | DeliveryAddOnJoinedEvent
  | DeliveryAddOnLeftEvent
  | DeliveryTipChangedEvent

export interface ResolvedPendingKeyRotation {
  accountKeys: []
}

export interface DeliveryStatusUpdateEvent {
  deliveryId: string
  oldStatus: EnumDeliveryStatus
  status: EnumDeliveryStatus
  event: DeliveryEvent
  courierId?: string
}

export const ACTIVE_STATUSES: EnumDeliveryStatus[] = [
  EnumDeliveryStatus.CREATED,
  EnumDeliveryStatus.DISPATCHED,
  EnumDeliveryStatus.PICKED_UP,
  EnumDeliveryStatus.ON_THE_WAY,
  EnumDeliveryStatus.DROPPED_OFF,
  EnumDeliveryStatus.CANCELED,
]
export const NOT_ACTIVE_STATUSES: EnumDeliveryStatus[] = [EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.DROPPED_OFF]
