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
}

// Why an offer ended without the rider answering: the deadline passed, or the rider went offline.
// MOVED: an admin gave the offer to another rider (row 61 review). STOPPED: dispatch was stopped
// for heat or a storm (spec 0014); not the rider's miss, so no skip list entry.
export type OfferEndedReason = 'EXPIRED' | 'OFFLINE' | 'MOVED' | 'STOPPED'

export interface OfferEndedMessage {
  deliveryId: string
  reason: OfferEndedReason
}
