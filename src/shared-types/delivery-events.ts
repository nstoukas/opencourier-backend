import { EnumDeliveryEventType, EnumEventActor, EnumDeliveryEventSource, EnumDeliveryStatus } from '@prisma/types'

// DELIVERY EVENTS
export { EnumDeliveryEventType, EnumEventActor, EnumDeliveryEventSource, EnumDeliveryStatus }

export interface BaseDeliveryEvent {
  deliveryId: string
  type: EnumDeliveryEventType
  actor: EnumEventActor
  source: EnumDeliveryEventSource
  courierId?: string | null
  message?: string
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
}
export interface DeliveryFailedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.FAILED
}
export interface DeliveryReassignedEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.REASSIGNED
  courierId: string
}
// Spec 0014. Dispatch stopped while `courierId` held this delivery, not yet picked up: it goes back
// to waiting with nobody, and that rider is paid by the co-op's reassignment payout setting.
export interface DeliveryReturnedToWaitingEvent extends BaseDeliveryEvent {
  type: typeof EnumDeliveryEventType.RETURNED_TO_WAITING
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
  | DeliveryOfferedEvent
  | DeliveryOfferExpiredEvent
  | DeliveryNoCourierAvailableEvent

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
