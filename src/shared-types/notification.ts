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
  // Spec 0047: dispatch confirmed or refused this rider's split request.
  SPLIT_REQUEST_DECIDED = 'SPLIT_REQUEST_DECIDED',
  // Chat (spec 0034): a new message in a thread. To a rider it carries their message; to admins
  // (room `dispatch` on the `admins` namespace) the thread id and the message.
  CHAT_MESSAGE = 'CHAT_MESSAGE',
  // Chat (spec 0034, AC-6): dispatch read the rider's thread up to this time, so their own messages show "read".
  CHAT_READ_BY_DISPATCH = 'CHAT_READ_BY_DISPATCH',
  // Chat (spec 0034, AC-7): an admin read a thread, so every admin's unread mark for it clears.
  CHAT_THREAD_READ = 'CHAT_THREAD_READ',
  // Spec 0038 (AC-9): a person answered this rider's review request. Data only, the request id alone;
  // the phone shows "Your review request has an answer" on the chat's quiet channel.
  REVIEW_ANSWERED = 'REVIEW_ANSWERED',
  // Spec 0052 (AC-4): a complaint about this rider needs their reply. Data only, the complaint id alone;
  // the phone shows "A complaint about a job needs your reply" (translated) on the chat's quiet channel.
  COMPLAINT_NEEDS_REPLY = 'COMPLAINT_NEEDS_REPLY',
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
// Spec 0047 (AC-7, cross check 12): dispatch's answer to a split request. On a confirm, the rider keeps leg
// `legNumber` of `legCount` in the size `boxSize`; on a refusal, the admin's sentence, if any.
export interface SplitRequestDecidedMessage {
  deliveryId: string
  outcome: 'CONFIRMED' | 'REFUSED'
  adminNote: string | null
  legNumber: number | null
  legCount: number | null
  boxSize: string | null
}

export interface RemovalRequestDecidedMessage {
  deliveryId: string
  outcome: 'APPROVED' | 'DECLINED'
  decisionNote: string | null
  paid: boolean
  payAmount: number | null
  currencyCode: string
}

// Spec 0034 (chat). What a rider's phone gets over its live connection. `message` is the rider's own
// DTO shape (ChatMessageCourierDto); typed loosely here so this file stays free of DTO imports.
export interface ChatMessageToCourier {
  message: { id: string; [field: string]: unknown }
}

// Spec 0034 (chat), AC-6: the time dispatch has read the rider's thread up to, as ISO text. Nothing is
// ever sent the other way: dispatch never learns whether a rider read anything.
export interface ChatReadByDispatchMessage {
  dispatchLastReadAt: string
}

// Spec 0034 (chat): what admins get on the `admins` namespace, room `dispatch`.
export interface ChatMessageToDispatch {
  threadId: string
  message: { id: string; [field: string]: unknown }
}

export interface ChatThreadReadMessage {
  threadId: string
  dispatchLastReadAt: string
}
