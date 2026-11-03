import { EnumDeliveryStatus } from '@prisma/types'
import { PARTNER_ENDED_STATUSES } from 'src/rest-api/delivery/partner/partner-history'

// Spec 0023: the restaurant's ready time and its two actions, "+5 / +10 / +15 min" and "Food ready".
// The rules live here, as plain values and functions, so the routes stay thin and each rule is
// tested on its own.

// The statuses in which a restaurant may still move the ready time or mark the food ready: before
// the rider has the food. (There is no CONFIRMED status; CONFIRMED is only an event type.)
export const READY_ACTION_STATUSES: EnumDeliveryStatus[] = [
  EnumDeliveryStatus.CREATED,
  EnumDeliveryStatus.ASSIGNING_COURIER,
  EnumDeliveryStatus.ACCEPTED,
  EnumDeliveryStatus.DISPATCHED,
  EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
]

// The rider has the food: too late to move anything.
export const PICKED_UP_STATUSES: EnumDeliveryStatus[] = [
  EnumDeliveryStatus.PICKED_UP,
  EnumDeliveryStatus.ON_THE_WAY,
  EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
]

// The minutes a delay may add (AC-3).
export const READY_DELAY_MINUTES = [5, 10, 15] as const

// The latest a ready time may be, counted from when the order was placed: a guard against a button
// pressed again and again, not a rule about kitchens (decision 21.4).
export const MAX_READY_AFTER_CREATION_MINUTES = 180

// The usual prep time a representative may set for a restaurant (AC-9, decision 21.2).
export const USUAL_PREP_MINUTES_MIN = 0
export const USUAL_PREP_MINUTES_MAX = 90
export const USUAL_PREP_MINUTES_SENTENCE = 'The usual prep time is a whole number of minutes from 0 to 90.'

// Every refusal is a fixed sentence the restaurant's page shows as it is (AC-3, AC-4).
export const READY_SENTENCES = {
  alreadyReady: 'The food is already marked ready.',
  pickedUp: 'The rider has already picked this order up.',
  ended: 'This order has ended.',
  tooLate: 'A ready time can be at most 3 hours after the order was placed.',
  changed: 'The ready time just changed. Look again.',
} as const

const MINUTE_MS = 60 * 1000

// A new order's ready time (AC-1): the restaurant's own pick, never earlier than now; otherwise now
// plus its usual prep time.
export function initialReadyAt(pickupReadyAt: Date | null | undefined, usualPrepMinutes: number, now: Date): Date {
  if (pickupReadyAt) {
    return pickupReadyAt.getTime() < now.getTime() ? now : pickupReadyAt
  }
  return new Date(now.getTime() + usualPrepMinutes * MINUTE_MS)
}

// A delay counts from the later of the current promise and now, so a kitchen already late does not
// promise a time in the past (AC-3).
export function delayedReadyAt(readyAt: Date | null, now: Date, minutes: number): Date {
  const from = readyAt && readyAt.getTime() > now.getTime() ? readyAt : now
  return new Date(from.getTime() + minutes * MINUTE_MS)
}

// The sentence that refuses an action in this status, or null when the action may go ahead. The
// food already ready is checked by the caller, since food ready itself treats it as a quiet success.
export function readyActionRefusal(status: EnumDeliveryStatus): string | null {
  if (READY_ACTION_STATUSES.includes(status)) return null
  if (PICKED_UP_STATUSES.includes(status)) return READY_SENTENCES.pickedUp
  if (PARTNER_ENDED_STATUSES.includes(status)) return READY_SENTENCES.ended
  // A status this list does not know yet is refused rather than allowed: the safe direction.
  return READY_SENTENCES.ended
}

// True when the new time would pass the 3 hour guard.
export function pastReadyLimit(newReadyAt: Date, createdAt: Date): boolean {
  return newReadyAt.getTime() > createdAt.getTime() + MAX_READY_AFTER_CREATION_MINUTES * MINUTE_MS
}
