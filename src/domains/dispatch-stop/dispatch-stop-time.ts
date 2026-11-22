import { DispatchStop, EnumDispatchStopReason } from '@prisma/types'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { dayjs } from 'src/core/utils/time'
import { CodedSentence } from 'src/localization/coded-sentence'

// Spec 0014. Every dispatch stop time is entered and shown in the instance's time zone (Athens),
// and stored as UTC. All the sentences riders, restaurants and admins read are built here, on the
// server, so the three apps cannot format a time three different ways.

// A wall clock date and time in Athens, as an admin types it.
export type LocalDateTime = { date: string; time: string }

// The UTC instant of an Athens wall clock time, or null when that time does not exist (the hour
// skipped when summer time starts) or the text is not a date and time. The repeated autumn hour
// resolves to its second occurrence (winter time), which is what dayjs's timezone plugin picks
// (decision 29.5).
export function athensToUtc(local: LocalDateTime): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(local.date) || !/^\d{2}:\d{2}$/.test(local.time)) return null
  const parsed = dayjs.tz(`${local.date} ${local.time}`, INSTANCE_TIMEZONE)
  if (!parsed.isValid()) return null
  // A skipped time comes back shifted by an hour: reading it back in Athens shows another time.
  const back = parsed.tz(INSTANCE_TIMEZONE)
  if (back.format('YYYY-MM-DD') !== local.date || back.format('HH:mm') !== local.time) return null
  return parsed.toDate()
}

// How a reason reads inside a sentence.
export function reasonWords(reason: EnumDispatchStopReason): string {
  switch (reason) {
    case EnumDispatchStopReason.HEAT:
      return 'heat'
    case EnumDispatchStopReason.STORM:
      return 'storm'
    default:
      return 'other reasons'
  }
}

function athens(date: Date) {
  return dayjs(date).tz(INSTANCE_TIMEZONE)
}

// "today", "tomorrow", or "on 3 August", seen from `now`, in Athens.
export function dayWords(date: Date, now: Date): string {
  const day = athens(date).format('YYYY-MM-DD')
  if (day === athens(now).format('YYYY-MM-DD')) return 'today'
  if (day === athens(now).add(1, 'day').format('YYYY-MM-DD')) return 'tomorrow'
  return `on ${athens(date).format('D MMMM')}`
}

export function clock(date: Date): string {
  return athens(date).format('HH:mm')
}

// "until 17:00", "until 09:00 tomorrow", or null when the stop has no end.
function untilWords(end: Date | null, now: Date): string | null {
  if (!end) return null
  const day = dayWords(end, now)
  return day === 'today' ? `until ${clock(end)}` : `until ${clock(end)} ${day}`
}

// The effective end of a stop: a restart, else the planned end.
export function effectiveEnd(stop: Pick<DispatchStop, 'endsAt' | 'endedAt'>): Date | null {
  return stop.endedAt ?? stop.endsAt
}

// "today 12:00 to 17:00", "tomorrow 12:00 to 17:00", "today 22:00 to 06:00 tomorrow".
function windowWords(start: Date, end: Date | null, now: Date): string {
  const startDay = dayWords(start, now)
  if (!end) return `${startDay} from ${clock(start)} until dispatch restarts`
  const endDay = dayWords(end, now)
  return endDay === startDay
    ? `${startDay} ${clock(start)} to ${clock(end)}`
    : `${startDay} ${clock(start)} to ${clock(end)} ${endDay}`
}

type StopTimes = Pick<DispatchStop, 'reason' | 'startsAt' | 'endsAt' | 'endedAt'>

// To a restaurant, refused or in its banner while a stop is on.
export function restaurantStoppedMessage(stop: StopTimes, now: Date): string {
  const until = untilWords(effectiveEnd(stop), now) ?? 'until dispatch restarts'
  return `Delivery is stopped ${until} (${reasonWords(stop.reason)}).`
}

// To a rider, in the Home banner while a stop is on.
export function riderStoppedMessage(stop: StopTimes, now: Date): string {
  const until = untilWords(effectiveEnd(stop), now) ?? 'until the co-op restarts it'
  return `Dispatch is stopped ${until} (${reasonWords(stop.reason)}).`
}

// To a restaurant, about a stop that starts soon.
export function restaurantNextMessage(stop: StopTimes, now: Date): string {
  return `Delivery stops ${windowWords(stop.startsAt, stop.endsAt, now)} (${reasonWords(stop.reason)}).`
}

// To a rider, about a stop that starts soon.
export function riderNextMessage(stop: StopTimes, now: Date): string {
  return `Dispatch stops ${windowWords(stop.startsAt, stop.endsAt, now)} (${reasonWords(stop.reason)}).`
}

// To an admin whose hand offer or reassignment was refused (409).
export function adminRefusedMessage(stop: StopTimes, now: Date): string {
  const until = untilWords(effectiveEnd(stop), now) ?? 'until it is restarted'
  return `Dispatch is stopped ${until}.`
}

// ── The same sentences as codes with values (spec 0054, AC-6, review of 2026-11-22) ─────────────
// Each function below returns the code of the matching sentence above, its values, and the English
// sentence itself, so an app can say it in its reader's language (src/localization/coded-sentence.ts).
// The words "today", "tomorrow" and "on 3 August" are left to the app, which fills them in from the ISO
// times when it shows the sentence. The codes are keys of `server.notice` (banners) and `server.error`
// (refusals) in src/localization/en.ts and el.ts.

type Audience = 'RIDER' | 'RESTAURANT'

// A stop in force, to a rider or a restaurant (the banner, and the restaurant's refusal).
export function stoppedSentence(audience: Audience, stop: StopTimes, now: Date): CodedSentence {
  const end = effectiveEnd(stop)
  const message = audience === 'RIDER' ? riderStoppedMessage(stop, now) : restaurantStoppedMessage(stop, now)
  return end
    ? { code: `DISPATCH_STOPPED_${audience}`, params: { reason: stop.reason, until: end.toISOString() }, message }
    : { code: `DISPATCH_STOPPED_${audience}_OPEN`, params: { reason: stop.reason }, message }
}

// A stop that starts soon, to a rider or a restaurant. Like windowWords: the end's day is said only when it
// is not the start's day (Athens time).
export function nextSentence(audience: Audience, stop: StopTimes, now: Date): CodedSentence {
  const message = audience === 'RIDER' ? riderNextMessage(stop, now) : restaurantNextMessage(stop, now)
  const startsAt = stop.startsAt.toISOString()
  const base = `DISPATCH_STOPS_${audience}`
  if (!stop.endsAt) return { code: `${base}_OPEN`, params: { reason: stop.reason, startsAt }, message }
  const sameDay = athens(stop.startsAt).format('YYYY-MM-DD') === athens(stop.endsAt).format('YYYY-MM-DD')
  return {
    code: sameDay ? `${base}_SAME_DAY` : base,
    params: { reason: stop.reason, startsAt, endsAt: stop.endsAt.toISOString() },
    message,
  }
}

// To an admin whose hand offer or reassignment was refused.
export function adminRefusedSentence(stop: StopTimes, now: Date): CodedSentence {
  const end = effectiveEnd(stop)
  const message = adminRefusedMessage(stop, now)
  return end
    ? { code: 'DISPATCH_STOPPED_ADMIN', params: { until: end.toISOString() }, message }
    : { code: 'DISPATCH_STOPPED_ADMIN_OPEN', params: {}, message }
}
