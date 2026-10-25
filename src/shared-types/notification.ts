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
}

// Why an offer ended without the rider answering: the deadline passed, or the rider went offline.
// MOVED: an admin gave the offer to another rider (row 61 review).
export type OfferEndedReason = 'EXPIRED' | 'OFFLINE' | 'MOVED'

export interface OfferEndedMessage {
  deliveryId: string
  reason: OfferEndedReason
}
