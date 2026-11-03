import { INSTANCE_TIMEZONE } from 'src/constants'
import { dayjs } from 'src/core/utils/time'

// Spec 0027 (row 78): the occurrences of the weekly slots (spec 0026) riders book, worked out on the
// server in Athens time. Every time the app shows comes from here as text, so the phone never formats an
// instant in its own zone.

// How far ahead riders can book: the 14 Athens dates starting today.
export const SHIFT_SCHEDULE_DAYS = 14

export interface SlotTimes {
  weekday: number
  startMinute: number
  endMinute: number
}

// The Athens date of an instant, YYYY-MM-DD.
export function athensDate(instant: Date): string {
  return dayjs(instant).tz(INSTANCE_TIMEZONE).format('YYYY-MM-DD')
}

// The 14 Athens dates starting today.
export function scheduleDates(now: Date): string[] {
  const today = dayjs(now).tz(INSTANCE_TIMEZONE).startOf('day')
  return Array.from({ length: SHIFT_SCHEDULE_DAYS }, (_unused, index) => today.add(index, 'day').format('YYYY-MM-DD'))
}

// ISO weekday of an Athens date: 1 Monday to 7 Sunday. Noon, so no time zone edge can move the day.
export function isoWeekday(date: string): number {
  const day = dayjs.tz(`${date} 12:00`, INSTANCE_TIMEZONE).day()
  return day === 0 ? 7 : day
}

// The instant of minute `minute` after midnight on an Athens date. 1440 is the next midnight. A time in
// the hour skipped when summer time starts comes out an hour later, and the repeated autumn hour as its
// second (winter time) occurrence, which is what dayjs's timezone plugin does (decision 29.5): a slot on
// those days is simply an hour shorter or longer.
export function athensInstant(date: string, minute: number): Date {
  if (minute === 1440) {
    const next = dayjs.tz(`${date} 12:00`, INSTANCE_TIMEZONE).add(1, 'day').format('YYYY-MM-DD')
    return dayjs.tz(`${next} 00:00`, INSTANCE_TIMEZONE).toDate()
  }
  return dayjs.tz(`${date} ${clockText(minute)}`, INSTANCE_TIMEZONE).toDate()
}

// Minutes after midnight as HH:mm; 1440 is 24:00.
export function clockText(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

export function occurrenceTimes(date: string, slot: SlotTimes): { startsAt: Date; endsAt: Date } {
  return { startsAt: athensInstant(date, slot.startMinute), endsAt: athensInstant(date, slot.endMinute) }
}

// "18:00 today", "07:00 tomorrow", or "Fri 7 Nov, 18:00": when a booking can last be dropped, as the
// rider reads it in Athens time.
export function dropUntilText(dropUntil: Date, now: Date): string {
  const until = dayjs(dropUntil).tz(INSTANCE_TIMEZONE)
  const today = dayjs(now).tz(INSTANCE_TIMEZONE).format('YYYY-MM-DD')
  const tomorrow = dayjs(now).tz(INSTANCE_TIMEZONE).add(1, 'day').format('YYYY-MM-DD')
  const time = until.format('HH:mm')
  if (until.format('YYYY-MM-DD') === today) return `${time} today`
  if (until.format('YYYY-MM-DD') === tomorrow) return `${time} tomorrow`
  return `${until.format('ddd D MMM')}, ${time}`
}

// When a booking can last be dropped: its start minus the co-op's notice.
export function dropDeadline(startsAt: Date, noticeHours: number): Date {
  return new Date(startsAt.getTime() - noticeHours * 3600_000)
}
