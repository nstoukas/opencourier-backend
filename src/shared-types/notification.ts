export function courierNotificationChannel(userId: string) {
  return `COURIER:${userId}`
}

export function adminBroadcastNotificationChannel() {
  return `ADMIN:*`
}

export function merchantGroupAdminNotificationChannel(merchantGroupId: string) {
  return `MERCHANT:${merchantGroupId}`
}

export enum NotificationEventType {
  NEW_DELIVERY_OFFER = 'NEW_DELIVERY_OFFER',
  DELIVERY_STATUS_UPDATED = 'DELIVERY_STATUS_UPDATED',
  // An offer this rider held has ended on the server (spec 0002): drop it from the screen.
  OFFER_ENDED = 'OFFER_ENDED',
  // A job this rider held was cancelled (spec 0015): the app raises its own alert and shows the card.
  JOB_CANCELLED = 'JOB_CANCELLED',
  // The restaurant moved the ready time of a job this rider holds, or marked the food ready (spec 0023).
  JOB_READY_UPDATED = 'JOB_READY_UPDATED',
  // A rider's removal request was answered (spec 0035): the app refetches and shows the outcome.
  REMOVAL_REQUEST_DECIDED = 'REMOVAL_REQUEST_DECIDED',
}

// Why an offer ended without the rider answering: the deadline passed, or the rider went offline.
// MOVED: an admin gave the offer to another rider (row 61 review). STOPPED: dispatch was stopped
// for heat or a storm (spec 0014); not the rider's miss, so no skip list entry.
export type OfferEndedReason = 'EXPIRED' | 'OFFLINE' | 'MOVED' | 'STOPPED'

export interface OfferEndedMessage {
  deliveryId: string
  reason: OfferEndedReason
}

// Spec 0023 (AC-6): what a rider holding a job is told when its readiness changes. Ids, the
// restaurant's business name and times only: no customer detail, no position.
export interface JobReadyUpdatedMessage {
  deliveryId: string
  restaurantName: string
  readyAt: string | null // ISO time
  foodReadyAt: string | null // ISO time
  delayMinutes: number | null // null for "Food ready"
}

// Spec 0035 (AC-11): what the rider is told when dispatch answers their request. `payAmount` is null
// when the reason is not paid. `decisionNote` is dispatch's own sentence: never logged.
export interface RemovalRequestDecidedMessage {
  deliveryId: string
  outcome: 'APPROVED' | 'DECLINED'
  decisionNote: string | null
  paid: boolean
  payAmount: number | null
  currencyCode: string
}
