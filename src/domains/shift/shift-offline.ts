import { EnumCourierStatusChangeCause } from '@prisma/types'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { dayjs } from 'src/core/utils/time'

// Spec 0049 (row 79): going Offline during a booked shift. Pure rules and words, no database. The event is
// a record the rider and an admin see; nothing counts, ranks or penalises it, and the matcher and every pay
// path never read it (AC-7, value 5).

// Cross check 1: an Offline change in the last 10 minutes of a shift leaves nothing.
export const SHIFT_END_GRACE_MINUTES = 10
// How far back the minute sweep looks for Offline changes whose break limit has passed. A server down for
// longer than this misses those (they are records, never pay), rather than writing them hours late.
export const OFFLINE_SWEEP_LOOKBACK_HOURS = 6
// Cross check 3: a followed up item leaves the admin screen this many days after it was followed up.
export const FOLLOWED_UP_SHOWN_DAYS = 7
// How long a rider sees their own records on the Shifts screen.
export const RIDER_OFFLINE_RECORD_DAYS = 7

// Cross check 1: written only if the rider is still Offline once the break limit has passed, the booking
// still covers the Offline moment, and that moment is not in the shift's last 10 minutes.
export function offlineCountsMidShift(input: {
  offlineAt: Date
  booking: { startsAt: Date; endsAt: Date } | null
  cameBackWithinBreak: boolean
}): boolean {
  const { offlineAt, booking, cameBackWithinBreak } = input
  if (!booking || cameBackWithinBreak) return false
  const at = offlineAt.getTime()
  if (at < booking.startsAt.getTime() || at >= booking.endsAt.getTime()) return false
  return at < booking.endsAt.getTime() - SHIFT_END_GRACE_MINUTES * 60_000
}

// Cross check 2: the cause in plain words, as the rider reads it.
export const RIDER_CAUSE_WORDS: Record<EnumCourierStatusChangeCause, string> = {
  RIDER: 'you switched to Offline',
  ADMIN: 'an admin set you Offline',
  CUT_OFF: 'your sessions were ended by a password change',
  LAST_CALL_ACCEPTED: 'you went Offline after your Last Call job',
  SYSTEM_START: 'the system set you Offline',
  DEACTIVATED: 'your account was deactivated by the co-op',
}

// The same causes as an admin reads them.
export const ADMIN_CAUSE_WORDS: Record<EnumCourierStatusChangeCause, string> = {
  RIDER: 'The rider switched to Offline',
  ADMIN: 'An admin set the rider Offline',
  CUT_OFF: "A password change ended the rider's sessions",
  LAST_CALL_ACCEPTED: 'Offline after a Last Call job',
  SYSTEM_START: 'Set Offline by the system',
  DEACTIVATED: "An admin deactivated the rider's account",
}

// AC-5: what the rider reads under each record.
export const NO_EFFECT_SENTENCE = 'This changes nothing about your offers or pay.'

export function athensClockOf(instant: Date): string {
  return dayjs(instant).tz(INSTANCE_TIMEZONE).format('HH:mm')
}

export function athensDayOf(instant: Date): string {
  return dayjs(instant).tz(INSTANCE_TIMEZONE).format('ddd D MMM')
}

// AC-5: "You went Offline at 21:10 during your shift on Fri 20 Nov, 20:00 to 24:00: you switched to Offline."
export function riderOfflineSentence(input: {
  offlineAt: Date
  cause: EnumCourierStatusChangeCause | null
  shiftStartsAt: Date
  startTime: string
  endTime: string
}): string {
  const cause = input.cause ? `: ${RIDER_CAUSE_WORDS[input.cause]}` : ''
  return `You went Offline at ${athensClockOf(input.offlineAt)} during your shift on ${athensDayOf(
    input.shiftStartsAt
  )}, ${input.startTime} to ${input.endTime}${cause}.`
}
