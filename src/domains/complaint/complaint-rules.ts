import { EnumComplaintAbout, EnumComplaintCategory, EnumComplaintFiledBy, EnumComplaintStatus, EnumDeliveryStatus } from '@prisma/types'

// Spec 0052 (row 83): the rules of complaints, as pure values and functions so a test can read them
// without a database. Nothing here, or anywhere, turns complaints into a count, list or score of a
// rider (AC-8, binding value 5).

// AC-1: the fixed list of categories for each `about`. The apps word each code from a translation key.
// `as const` keeps each list's exact values, so a typo is a type error rather than a silent new category.
export const COMPLAINT_CATEGORIES = {
  [EnumComplaintAbout.RESTAURANT]: [
    EnumComplaintCategory.LONG_WAIT,
    EnumComplaintCategory.FOOD_NOT_READY,
    EnumComplaintCategory.UNSAFE_PACKAGING,
    EnumComplaintCategory.RUDE_STAFF,
    EnumComplaintCategory.OTHER,
  ],
  [EnumComplaintAbout.CUSTOMER]: [
    EnumComplaintCategory.ABUSE_OR_THREAT,
    EnumComplaintCategory.UNSAFE_ADDRESS,
    EnumComplaintCategory.NOT_ANSWERING,
    EnumComplaintCategory.OTHER,
  ],
  [EnumComplaintAbout.RIDER]: [
    EnumComplaintCategory.LATE,
    EnumComplaintCategory.RUDE,
    EnumComplaintCategory.FOOD_DAMAGED,
    EnumComplaintCategory.OTHER,
  ],
} as const satisfies Record<EnumComplaintAbout, readonly EnumComplaintCategory[]>

export function categoryFits(about: EnumComplaintAbout, category: EnumComplaintCategory): boolean {
  return (COMPLAINT_CATEGORIES[about] as readonly EnumComplaintCategory[]).includes(category)
}

// Who may complain about whom (the operator's decision, row 83): a rider about a restaurant or a
// customer (never another rider, never dispatch: that is row 30's review requests); a restaurant and an
// admin about a rider.
export const ABOUT_ALLOWED_FOR: Record<EnumComplaintFiledBy, readonly EnumComplaintAbout[]> = {
  [EnumComplaintFiledBy.RIDER]: [EnumComplaintAbout.RESTAURANT, EnumComplaintAbout.CUSTOMER],
  [EnumComplaintFiledBy.RESTAURANT]: [EnumComplaintAbout.RIDER],
  [EnumComplaintFiledBy.ADMIN]: [EnumComplaintAbout.RIDER],
}

// AC-3, cross check 6: a complaint about a rider waits for their reply; any other starts open.
export function startingStatus(about: EnumComplaintAbout): EnumComplaintStatus {
  return about === EnumComplaintAbout.RIDER ? EnumComplaintStatus.AWAITING_REPLY : EnumComplaintStatus.OPEN
}

// Open = still waiting for someone (the rider's reply or an admin). DECIDED and WITHDRAWN are closed.
export const COMPLAINT_OPEN_STATUSES: readonly EnumComplaintStatus[] = [
  EnumComplaintStatus.OPEN,
  EnumComplaintStatus.AWAITING_REPLY,
]

// AC-3: a restaurant files about the rider of a delivered or cancelled order only.
export const RESTAURANT_COMPLAINT_STATUSES: readonly EnumDeliveryStatus[] = [
  EnumDeliveryStatus.DROPPED_OFF,
  EnumDeliveryStatus.CANCELED,
]

// Cross check 6: one open complaint per filer per delivery and `about` (decision 83.1: per `about` too,
// so a rider can complain about the restaurant and the customer of one job). An admin files on behalf of
// whoever called in, so an admin's filing has no key.
export function openForKey(
  filer: { kind: 'RIDER' | 'RESTAURANT'; id: string },
  deliveryId: string,
  about: EnumComplaintAbout
): string {
  return `${filer.kind}:${filer.id}:${deliveryId}:${about}`
}

// The sentences callers read. Fixed, never built from what anyone wrote.
export const COMPLAINT_TEXT_MAX = 1000
export const COMPLAINT_NOT_FOUND = 'Complaint not found'
export const COMPLAINT_TEXT_MESSAGE = 'Write the complaint in 1 to 1000 characters.'
export const COMPLAINT_REPLY_MESSAGE = 'Write your reply in 1 to 1000 characters.'
export const COMPLAINT_OUTCOME_MESSAGE = 'Write the outcome in 1 to 1000 characters.'
export const COMPLAINT_WITHDRAW_REASON_MESSAGE = 'Write why the complaint is withdrawn, in 1 to 1000 characters.'
export const COMPLAINT_ABOUT_NOT_ALLOWED = 'You cannot file a complaint about that.'
export const COMPLAINT_CATEGORY_MISMATCH = 'That category does not fit who the complaint is about.'
export const COMPLAINT_ALREADY_OPEN = 'You already have an open complaint about this order.'
export const COMPLAINT_ORDER_NOT_ENDED = 'You can complain about the rider once the order is delivered or cancelled.'
export const COMPLAINT_NO_RIDER = 'This order had no rider'
export const COMPLAINT_RIDER_NOT_ON_ORDER = 'That rider never accepted this order.'
export const COMPLAINT_AWAITING_REPLY = "Waiting for the rider's reply"
export const COMPLAINT_CLOSED = 'This complaint is already decided or withdrawn.'
export const COMPLAINT_ALREADY_REPLIED = 'This complaint already has a reply.'
export const COMPLAINT_NOT_AWAITING_REPLY = 'This complaint is not waiting for a reply.'
export const COMPLAINT_RIDER_CAN_REPLY =
  "The rider's account is active: the rider replies in the app. A reply can be entered for a rider only once their account is deactivated."

// The trimmed text, or null when it is empty or too long.
export function cleanText(value: string): string | null {
  const text = value.trim()
  return text.length >= 1 && text.length <= COMPLAINT_TEXT_MAX ? text : null
}
