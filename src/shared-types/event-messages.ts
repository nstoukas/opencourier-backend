// Spec 0054 (row 47), AC-4: the one list of event message codes. A DeliveryEvent stores a code and its
// values (`messageCode`, `messageParams`), and each app shows the code in its reader's language. The
// English `message` column is still written, rendered from the same code by the server
// (src/localization/en.ts), so logs and older readers keep working. The code and params are the record;
// the message is derived from them (cross check 7).
//
// This file is copied to the apps the way the other shared types are. Each app's completeness test walks
// these lists and fails when a code has no text in either language.
//
// Rules (cross check 6):
// - A code's params never change shape once used. A new shape is a new code.
// - Money is integer cents plus the currency code (`amount`, `currency`); times are ISO UTC strings
//   (`readyAt`, `at`), shown in Europe/Athens; distances are metres; names and ids as stored; enum values
//   as their codes, which the apps translate (`server.enum.*` in the translation files).
// - People's own words (an admin's note, a rider's note, an item name the restaurant typed) travel as a
//   param (`note`, `itemName`, `topic`) and are never translated.
// - A removal reason is copied with both labels at write time (`label`, `labelEl`; `labelEl` falls back
//   to `label` when the reason had no Greek label).

// One value inside `messageParams`. A part (below) is a piece of a message that is only sometimes there,
// such as an offer's deadline or the stops of a stacked offer; an array of parts is shown one after the
// other (or as a list, where the template says `{{name, list}}` or `{{name, comma}}`).
export type EventParamValue = string | number | boolean | null | EventPart | EventPart[]

// `type`, not `interface`, so a value can be stored in a Prisma Json column without a cast.
export type EventMessageParams = { [name: string]: EventParamValue }

export type EventPart = { part: EventPartCode; params: EventMessageParams }

// Every full message: its code and the names of its params. The templates are in
// src/localization/en.ts and el.ts under `server.event.<code>`.
export const EVENT_MESSAGE_CODES = {
  // Creating and sizing (spec 0043, spec 0023)
  CREATED: ['deliveryId', 'partnerId', 'readyAt'],
  CREATED_BUSY: ['deliveryId', 'partnerId', 'readyAt', 'busyMinutes'],
  BOX_SIZE_ASSUMED: ['size', 'units'],
  BOX_SIZE_CHANGED_BY_RESTAURANT: ['fromSize', 'fromUnits', 'toSize', 'toUnits'],
  BOX_SIZE_SET_BY_SPLIT: ['adminId', 'size', 'wasSize'],
  BOX_OVER_CAPACITY_CONFIRMED: ['admin', 'deliveryUnits', 'heldUnits', 'boxUnits', 'totalUnits'],
  BOX_OVER_CAPACITY_CONFIRMED_UNNAMED: ['deliveryUnits', 'heldUnits', 'boxUnits', 'totalUnits'],
  READY_DELAYED: ['minutes', 'readyAt'],
  FOOD_READY: ['at'],

  // Offers and answers (spec 0002, spec 0048)
  OFFERED: ['courierId', 'deadline', 'extras'],
  ADMIN_OFFERED: ['courierId'],
  ADMIN_OFFERED_WITH_NOTE: ['courierId', 'note'],
  NO_COURIER_AVAILABLE: [],
  OFFER_EXPIRED_AFTER: ['seconds'],
  OFFER_EXPIRED_AFTER_STACK: ['seconds'],
  RIDER_WENT_OFFLINE: [],
  RIDER_WENT_OFFLINE_STACK: [],
  DISPATCH_STOP_OFFER_ENDED: ['reason'],
  DISPATCH_STOP_OFFER_ENDED_STACK: ['reason'],
  ACCEPTED: ['courierId', 'deliveryId'],
  ACCEPTED_AUTOMATICALLY: ['courierId', 'deliveryId'],
  ACCEPTED_TOGETHER: ['courierId', 'deliveryId', 'otherDeliveryId'],
  ACCEPTED_TOGETHER_AUTOMATICALLY: ['courierId', 'deliveryId', 'otherDeliveryId'],
  ACCEPTED_BY_SWEEP: ['courierId', 'deliveryId'],
  REJECTED: ['courierId', 'deliveryId'],
  REJECTED_TOGETHER: ['courierId', 'deliveryId', 'otherDeliveryId'],

  // The job's steps (spec 0009, spec 0021)
  MARKED_DISPATCHED: ['deliveryId', 'courierId'],
  ARRIVED_AT_PICKUP: ['deliveryId', 'courierId', 'how'],
  MARKED_PICKED_UP: ['deliveryId', 'courierId'],
  MARKED_ON_THE_WAY: ['deliveryId', 'courierId'],
  ARRIVED_AT_DROPOFF: ['deliveryId', 'courierId', 'how'],
  MARKED_DELIVERED: ['deliveryId', 'courierId'],
  TAP_TOO_LATE: ['fromStatus', 'eventType'],
  TRANSITION_FAILED: ['note'],

  // Hand back, waiting, leaving (spec 0020, spec 0033)
  HANDED_BACK: [],
  HAND_BACK_REFUSED: [],
  LEFT_AFTER_WAIT: [],
  LEAVE_REFUSED: [],
  COURIER_PAID_FOR_WAIT: ['courierId', 'amount', 'currency', 'minutes', 'centsPerMinute', 'waitOf'],
  COURIER_PAID_FOR_WAIT_NOTE: ['courierId', 'amount', 'currency', 'note', 'waitOf'],

  // Cancelling (spec 0015)
  CANCELED_BY_PARTNER: ['deliveryId', 'partnerId', 'cancelledBy'],
  CANCELED_BY_ADMIN: ['cancelledBy'],
  CANCELLATION_PAY: ['courierId', 'amount', 'currency', 'policy', 'cancelledBy'],
  FOOD_RETURNED: [],

  // An admin's or rider's own words, nothing else (cross check 5)
  ADMIN_NOTE: ['note'],
  RIDER_NOTE: ['note'],

  // Reassigning (spec 0035)
  REASSIGNED: ['droppedCourierId', 'newCourierId', 'policy', 'amount', 'currency', 'awardId'],
  REASSIGNED_WITH_NOTE: ['droppedCourierId', 'newCourierId', 'policy', 'amount', 'currency', 'note', 'awardId'],

  // Dispatch stops (spec 0014)
  DISPATCH_STOP_RETURNED: ['reason'],

  // Removals (spec 0035)
  REMOVAL_REQUESTED: ['label', 'labelEl'],
  REMOVAL_WITHDRAWN: ['label', 'labelEl'],
  REMOVAL_DECLINED: ['label', 'labelEl'],
  REMOVAL_APPROVED: ['label', 'labelEl'],
  REMOVAL_APPROVED_AFTER_PICKUP: ['label', 'labelEl'],
  REMOVAL_CANCELLED_AFTER_PICKUP: ['label', 'labelEl'],
  REMOVAL_APPROVAL_FAILED: ['label', 'labelEl'],
  COURIER_PAID_FOR_REMOVAL: ['courierId', 'amount', 'currency', 'policy', 'label', 'labelEl', 'requestId'],
  PARTNER_CHARGED_FOR_REMOVAL: ['amount', 'currency', 'label', 'labelEl', 'requestId'],
  COURIER_PAID_FOR_RETURN_TRIP: ['courierId', 'amount', 'currency'],

  // Splits (spec 0047)
  SPLIT_REQUESTED: ['count', 'sizes', 'splitId'],
  SPLIT_LEFT: ['minutes', 'splitId'],
  SPLIT_LEFT_CANCELLED: [],
  SPLIT_REFUSED: ['adminId', 'splitId'],
  SPLIT_CONFIRMED: ['adminId', 'splitId', 'count', 'sizes', 'legNumber', 'legCount', 'newLegIds'],
  SPLIT_VOIDED: ['splitId'],
  SPLIT_LEG_CREATED: ['legNumber', 'splitId', 'size'],
  SPLIT_LEG_CREATED_BY_ADMIN: ['legNumber', 'splitId', 'adminId', 'size'],
  PARTNER_CHARGED_FOR_SPLIT: ['amount', 'currency', 'splitId'],
  SPLIT_LEG_CHARGE_VOIDED: ['amount', 'currency'],
  COURIER_PAID_FOR_SPLIT_WAIT: ['courierId', 'amount', 'currency', 'minutes', 'centsPerMinute', 'splitId'],

  // Reviews (spec 0038)
  REVIEW_REQUESTED: ['topic'],
  REVIEW_ANSWERED: ['outcome'],
  COURIER_PAID_FOR_REVIEW: ['courierId', 'amount', 'currency', 'reviewId'],

  // Drop off pin moves (spec 0016, row 102)
  DROPOFF_MOVED_BY_RIDER: ['metres', 'from', 'to', 'outcome'],
  DROPOFF_MOVED_BY_RESTAURANT: ['metres', 'from', 'to'],

  // Product reports (spec 0032)
  PRODUCT_REPORTED: ['kind', 'source'],
  PRODUCT_REPORTED_ITEM: ['kind', 'itemName', 'source'],
  PRODUCT_REPORT_RESOLVED: ['kind'],
  // Row 146: written on the job an accepted add on joined; `addOnId` is the added delivery.
  ADD_ON_JOINED: ['courierId', 'addOnId'],
  ADD_ON_LEFT: ['courierId', 'addOnId'],
  // Row 160: a restaurant's edit changed the tip; both amounts in cents, with the delivery's currency.
  TIP_CHANGED_BY_RESTAURANT: ['oldTip', 'newTip', 'currency'],

  // Dev seed scripts
  SEEDED_COMPLETED: [],
  SEEDED_REASSIGNMENT: [],
} as const

// The pieces a message may carry in a param (see EventPart). Templates under `server.eventPart.<code>`.
export const EVENT_PART_CODES = {
  // An offer's deadline, one of the two.
  OFFER_DEADLINE: ['at'],
  OFFER_NO_DEADLINE: [],
  // What else an offer's record says, in this order.
  OFFER_MOVED_BY_ADMIN: ['courierId'],
  TIMING_TRAVEL_UNKNOWN: ['readyAt'],
  TIMING_TRAVEL: ['readyAt', 'travelMinutes', 'leadMinutes'],
  TIMING_LEAD: ['readyAt', 'leadMinutes'],
  STACK_PAIRED: ['otherDeliveryId', 'stops'],
  ADD_ON: ['jobId', 'figures', 'stops', 'calm', 'why'],
  ADD_ON_FIGURES: ['extraKm', 'extraMinutes'],
  ADD_ON_CARRYING_FOOD: [],
  ADD_ON_FREE_RIDER_FOUND: [],
  ADD_ON_NO_FREE_RIDER: [],
  // One stop of a stacked or add on offer: the first 8 characters of the delivery id.
  STOP_PICKUP: ['shortId'],
  STOP_DROPOFF: ['shortId'],
  // One box of a split, by its size.
  BOX: ['size'],
} as const

export type EventMessageCode = keyof typeof EVENT_MESSAGE_CODES
export type EventPartCode = keyof typeof EVENT_PART_CODES

// The params one code takes, worked out from the lists above: `ParamsOf<'FOOD_READY'>` is `{ at: ... }`.
// `[number]` turns the tuple of names into a union of names; the mapped type then has one key per name.
export type ParamsOf<C extends EventMessageCode> = { [K in (typeof EVENT_MESSAGE_CODES)[C][number]]: EventParamValue }
export type PartParamsOf<P extends EventPartCode> = { [K in (typeof EVENT_PART_CODES)[P][number]]: EventParamValue }
