import {
  EnumCourierCompensationReason,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
} from '@prisma/types'
import { dayjs } from 'src/core/utils/time'
import { DELIVERY_ONGOING_STATUSES, DELIVERY_PICKED_UP_STATUSES } from 'src/shared-types/stateMachine'
import { JOB_END_EVENT_TYPES, RETURN_TRIP_END_EVENT_TYPES } from './job-end-event-types'

// Spec 0040: a rider's worked shifts, breaks and the three part split, worked out from records when
// read and never stored. Everything in this file is pure (no database, no clock): the same records
// and the same setting always give the same answer, which is what lets a rider check any figure.

// ---- What the reads hand in ----

export interface StatusChangeRow {
  id: string
  createdAt: Date
  fromStatus: EnumCourierStatus
  toStatus: EnumCourierStatus
  cause: EnumCourierStatusChangeCause
  adminUserId: string | null
  // The admin's email, else username; only filled in for the admin view (AC-15).
  adminLabel?: string | null
}

// A successful DeliveryEvent on a delivery this rider accepted at least once.
export interface JobEventRow {
  id: string
  deliveryId: string
  type: EnumDeliveryEventType
  oldStatus: EnumDeliveryStatus | null
  courierId: string | null
  occurredAt: Date
  createdAt: Date
}

export interface JobDeliveryRow {
  id: string
  status: EnumDeliveryStatus
  courierId: string | null
  totalCompensation: number | null
  tips: number
  pickupName: string
}

export interface CompensationRow {
  id: string
  deliveryId: string
  amount: number
  currencyCode: string
  reason: EnumCourierCompensationReason
  waitMinutes: number | null
  createdAt: Date
}

export interface WorkedShiftsInput {
  courierId: string
  now: Date
  // The records cover [windowStart, windowEnd]; windowEnd is never after now.
  windowStart: Date
  windowEnd: Date
  // The days asked for, [rangeStart, rangeEnd), midnight to midnight in `timezone`.
  rangeStart: Date
  rangeEnd: Date
  // The rider's status at windowStart: the last change before it, else Offline.
  statusAtWindowStart: EnumCourierStatus
  statusChanges: StatusChangeRow[]
  events: JobEventRow[]
  deliveries: JobDeliveryRow[]
  compensations: CompensationRow[]
  // Deliveries this rider ever accepted with a recorded rider (decides "unlinked", AC-7).
  deliveriesWithAnyJob: ReadonlySet<string>
  recordedFrom: Date | null
  shiftBreakMinutes: number
  currencyCode: string
  timezone: string
}

// ---- What comes out ----

export interface WorkedJob {
  deliveryId: string
  pickupName: string
  acceptedAt: Date
  // null while the rider still holds the delivery.
  endedAt: Date | null
  endEventType: EnumDeliveryEventType | null
  droppedOff: boolean
  // totalCompensation + tips when this rider's job ended in their drop off, else 0.
  deliveryMoneyCents: number
  paidWaitSeconds: number
  compensations: WorkedCompensation[]
}

export interface WorkedCompensation {
  id: string
  reason: EnumCourierCompensationReason
  amountCents: number
  createdAt: Date
  addedLater: boolean
}

export interface WorkedStatusChange {
  at: Date
  fromStatus: EnumCourierStatus
  toStatus: EnumCourierStatus
  cause: EnumCourierStatusChangeCause
  byAdmin: boolean
  adminLabel?: string | null
}

export interface WorkedBreak {
  startedAt: Date
  endedAt: Date
}

export interface WorkedShift {
  startedAt: Date
  startedBeforeRange: boolean
  endedAt: Date | null
  onBreakSince: Date | null
  workSeconds: number
  jobSeconds: number
  paidWaitSeconds: number
  unpaidSeconds: number
  breaks: WorkedBreak[]
  moneyCents: number
  lateMoneyCents: number
  centsPerHour: number | null
  currencyCode: string
  statusChanges: WorkedStatusChange[]
  jobs: WorkedJob[]
}

export interface WorkedDay {
  date: string
  workSeconds: number
  jobSeconds: number
  paidWaitSeconds: number
  unpaidSeconds: number
  // Includes unlinkedMoneyCents (decision 36.36); € per hour leaves it out.
  moneyCents: number
  centsPerHour: number | null
  unlinkedMoneyCents: number
}

export interface WorkedShiftsResult {
  // Every shift found in the window, oldest first.
  allShifts: WorkedShift[]
  // The shifts that overlap the asked range.
  shifts: WorkedShift[]
  days: WorkedDay[]
  // Compensations left out because they are not in the instance currency (logged by id by the caller).
  otherCurrencyCompensationIds: string[]
}

// € per hour is shown once work time reaches a minute (AC-6).
export const MIN_SECONDS_FOR_RATE = 60

export function centsPerHour(moneyCents: number, workSeconds: number): number | null {
  if (workSeconds < MIN_SECONDS_FOR_RATE) return null
  return Math.round((moneyCents * 3600) / workSeconds)
}

// ---- Intervals (milliseconds) ----

interface Interval {
  s: number
  e: number
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.e > i.s).sort((a, b) => a.s - b.s)
  const merged: Interval[] = []
  for (const i of sorted) {
    const last = merged[merged.length - 1]
    if (last && i.s <= last.e) last.e = Math.max(last.e, i.e)
    else merged.push({ ...i })
  }
  return merged
}

function overlapMs(intervals: Interval[], from: number, to: number): number {
  let total = 0
  for (const i of intervals) total += Math.max(0, Math.min(i.e, to) - Math.max(i.s, from))
  return total
}

// ---- Jobs (AC-4) ----

interface PairedJob {
  deliveryId: string
  acceptCreatedAt: number
  start: number
  end: number | null
  endEventType: EnumDeliveryEventType | null
  droppedOff: boolean
}

// Pairs this rider's accepts with the first later end on the same delivery, in the order the server
// received the events (createdAt), timed by occurredAt and never ending before they start.
export function pairJobs(
  courierId: string,
  events: JobEventRow[],
  deliveries: JobDeliveryRow[],
  recordedFrom: Date | null
): PairedJob[] {
  const deliveryById = new Map(deliveries.map((d) => [d.id, d]))
  const byDelivery = new Map<string, JobEventRow[]>()
  for (const ev of events) {
    const list = byDelivery.get(ev.deliveryId) ?? []
    list.push(ev)
    byDelivery.set(ev.deliveryId, list)
  }

  const jobs: PairedJob[] = []
  for (const [deliveryId, list] of byDelivery) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    let open: PairedJob | null = null
    let waitingForReturn = false
    // The cancel that started the trip back, so a return that never comes ends the job there.
    let cancelEvent: JobEventRow | null = null

    const close = (job: PairedJob, ev: JobEventRow) => {
      job.end = Math.max(ev.occurredAt.getTime(), job.start)
      job.endEventType = ev.type
      job.droppedOff = ev.type === EnumDeliveryEventType.DROPPED_OFF
      jobs.push(job)
    }

    for (const ev of list) {
      if (open) {
        if (waitingForReturn) {
          // The trip back ends at the return; a new accept (nobody should) ends it too.
          if (RETURN_TRIP_END_EVENT_TYPES.has(ev.type) || ev.type === EnumDeliveryEventType.ACCEPTED) {
            close(open, ev)
            open = null
            waitingForReturn = false
            cancelEvent = null
          }
        } else if (JOB_END_EVENT_TYPES.has(ev.type)) {
          if (
            ev.type === EnumDeliveryEventType.CANCELED &&
            ev.oldStatus &&
            DELIVERY_PICKED_UP_STATUSES.includes(ev.oldStatus)
          ) {
            waitingForReturn = true
            cancelEvent = ev
            open.endEventType = ev.type
          } else {
            close(open, ev)
            open = null
          }
        }
      }
      if (!open && ev.type === EnumDeliveryEventType.ACCEPTED && ev.courierId === courierId) {
        open = {
          deliveryId,
          acceptCreatedAt: ev.createdAt.getTime(),
          start: ev.occurredAt.getTime(),
          end: null,
          endEventType: null,
          droppedOff: false,
        }
      }
    }

    if (open) {
      const delivery = deliveryById.get(deliveryId)
      const stillHeld =
        !waitingForReturn &&
        delivery !== undefined &&
        delivery.courierId === courierId &&
        DELIVERY_ONGOING_STATUSES.includes(delivery.status)
      if (stillHeld) {
        jobs.push(open)
      } else if (waitingForReturn && cancelEvent) {
        // Cancelled after pickup and the rider never answered the return question: the job ends at
        // the cancel. Any later event on the delivery (a review answered days later, say) must not
        // stretch it (review 2026-11-20, major).
        close(open, cancelEvent)
      } else {
        // No matching end at all: the job ends at the delivery's last event.
        const lastEvent = list[list.length - 1]
        if (lastEvent) close(open, lastEvent)
      }
    }
  }

  // No job starts before recording began (AC-4); one that also ended before it is dropped. The
  // check reads the job's own times before clamping, so a clamped job can't slip through as a zero
  // length job at the floor (review 2026-11-20, minor).
  const floor = recordedFrom?.getTime()
  return jobs
    .filter((j) => floor === undefined || j.end === null || j.end > floor || (j.start >= floor && j.end === floor))
    .map((j) =>
      floor !== undefined && j.start < floor
        ? { ...j, start: floor, end: j.end === null ? null : Math.max(j.end, floor) }
        : j
    )
    .sort((a, b) => a.start - b.start)
}

// ---- Shifts ----

function dayOf(ms: number, timezone: string): string {
  return dayjs(ms).tz(timezone).format('YYYY-MM-DD')
}

function startOfDay(date: string, timezone: string): number {
  return dayjs.tz(date, timezone).valueOf()
}

function nextDate(date: string): string {
  return dayjs.utc(date).add(1, 'day').format('YYYY-MM-DD')
}

export function datesInRange(rangeStart: Date, rangeEnd: Date, timezone: string): string[] {
  const dates: string[] = []
  let date = dayOf(rangeStart.getTime(), timezone)
  while (startOfDay(date, timezone) < rangeEnd.getTime()) {
    dates.push(date)
    date = nextDate(date)
  }
  return dates
}

export function buildWorkedShifts(input: WorkedShiftsInput): WorkedShiftsResult {
  const { courierId, timezone, currencyCode } = input
  const windowStart = input.windowStart.getTime()
  const windowEnd = Math.min(input.windowEnd.getTime(), input.now.getTime())
  const now = input.now.getTime()
  const breakMs = input.shiftBreakMinutes * 60 * 1000

  // Work periods from the status record: every stretch the rider was not Offline.
  const statusPeriods: Interval[] = []
  const changes = [...input.statusChanges].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  let status = input.statusAtWindowStart
  let since = windowStart
  for (const change of changes) {
    const at = change.createdAt.getTime()
    if (status !== EnumCourierStatus.OFFLINE && change.toStatus === EnumCourierStatus.OFFLINE) {
      statusPeriods.push({ s: since, e: at })
    } else if (status === EnumCourierStatus.OFFLINE && change.toStatus !== EnumCourierStatus.OFFLINE) {
      since = at
    }
    status = change.toStatus
  }
  if (status !== EnumCourierStatus.OFFLINE) statusPeriods.push({ s: since, e: windowEnd })

  // Jobs, joined with the status periods: a held job keeps the shift going (36.11).
  // Every job is kept to attach compensations to the right one; only those inside the window count.
  const allJobs = pairJobs(courierId, input.events, input.deliveries, input.recordedFrom)
  const paired = allJobs.filter((j) => (j.end ?? now) >= windowStart && j.start <= windowEnd)
  const jobInterval = (j: PairedJob): Interval => ({
    s: Math.max(j.start, windowStart),
    e: Math.min(j.end ?? now, windowEnd),
  })
  const periods = mergeIntervals(
    [...statusPeriods, ...paired.map(jobInterval)].map((i) => ({
      s: Math.max(i.s, windowStart),
      e: Math.min(i.e, windowEnd),
    }))
  )

  // Group periods into shifts: a gap shorter than the break limit stays inside the shift.
  const groups: Interval[][] = []
  for (const p of periods) {
    const group = groups[groups.length - 1]
    const last = group?.[group.length - 1]
    if (group && last && p.s - last.e < breakMs) group.push(p)
    else groups.push([p])
  }

  const deliveryById = new Map(input.deliveries.map((d) => [d.id, d]))
  const otherCurrencyCompensationIds: string[] = []
  const compensationsByDelivery = new Map<string, CompensationRow[]>()
  for (const c of input.compensations) {
    if (c.currencyCode !== currencyCode) {
      otherCurrencyCompensationIds.push(c.id)
      continue
    }
    const list = compensationsByDelivery.get(c.deliveryId) ?? []
    list.push(c)
    compensationsByDelivery.set(c.deliveryId, list)
  }

  // A compensation belongs to this rider's latest job on its delivery accepted at or before it was
  // written, else their earliest job on it (AC-6).
  const jobsByDelivery = new Map<string, PairedJob[]>()
  for (const j of allJobs) {
    const list = jobsByDelivery.get(j.deliveryId) ?? []
    list.push(j)
    jobsByDelivery.set(j.deliveryId, list)
  }
  const compensationsByJob = new Map<PairedJob, CompensationRow[]>()
  for (const [deliveryId, list] of compensationsByDelivery) {
    const jobsOnDelivery = (jobsByDelivery.get(deliveryId) ?? []).sort((a, b) => a.acceptCreatedAt - b.acceptCreatedAt)
    if (jobsOnDelivery.length === 0) continue
    for (const c of list) {
      const written = c.createdAt.getTime()
      const before = jobsOnDelivery.filter((j) => j.acceptCreatedAt <= written)
      const job = before[before.length - 1] ?? jobsOnDelivery[0]
      if (!job) continue
      const attached = compensationsByJob.get(job) ?? []
      attached.push(c)
      compensationsByJob.set(job, attached)
    }
  }

  const allShifts: WorkedShift[] = []
  // Each job's paid waiting after the shift cap, kept for the day totals.
  const effectiveWait = new Map<PairedJob, number>()
  const shiftOfJob = new Map<PairedJob, WorkedShift>()

  groups.forEach((group, index) => {
    const first = group[0]
    const final = group[group.length - 1]
    if (!first || !final) return
    const start = first.s
    const lastEnd = final.e
    const isLast = index === groups.length - 1
    let endedAt: number | null = lastEnd
    let onBreakSince: number | null = null
    if (isLast && lastEnd >= windowEnd && windowEnd >= now) {
      endedAt = null
    } else if (isLast && windowEnd >= now && now - lastEnd < breakMs) {
      endedAt = null
      onBreakSince = lastEnd
    }
    const spanEnd = endedAt ?? onBreakSince ?? windowEnd

    const workMs = group.reduce((sum, p) => sum + (p.e - p.s), 0)
    const jobsInShift = paired.filter((j) => {
      const i = jobInterval(j)
      return i.s >= start && i.s <= spanEnd
    })
    const jobUnion = mergeIntervals(jobsInShift.map(jobInterval))
    const workSeconds = Math.floor(workMs / 1000)
    const jobUnionSeconds = Math.min(workSeconds, Math.floor(overlapMs(jobUnion, start, spanEnd) / 1000))

    let waitLeft = jobUnionSeconds
    let money = 0
    let lateMoney = 0
    const jobs: WorkedJob[] = jobsInShift.map((j) => {
      const delivery = deliveryById.get(j.deliveryId)
      const comps = (compensationsByJob.get(j) ?? []).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      const jobLengthSeconds = Math.floor(((j.end ?? now) - j.start) / 1000)
      const waitSeconds = comps
        .filter((c) => c.reason === EnumCourierCompensationReason.WAITING)
        .reduce((sum, c) => sum + (c.waitMinutes ?? 0) * 60, 0)
      // Capped at the job's length, and the shift's total at its job time (36.30).
      const paidWait = Math.min(Math.min(waitSeconds, jobLengthSeconds), waitLeft)
      waitLeft -= paidWait
      effectiveWait.set(j, paidWait)

      const deliveryMoneyCents = j.droppedOff && delivery ? (delivery.totalCompensation ?? 0) + delivery.tips : 0
      money += deliveryMoneyCents
      const compensations = comps.map((c) => {
        const addedLater = endedAt !== null && c.createdAt.getTime() > endedAt
        money += c.amount
        if (addedLater) lateMoney += c.amount
        return { id: c.id, reason: c.reason, amountCents: c.amount, createdAt: c.createdAt, addedLater }
      })
      return {
        deliveryId: j.deliveryId,
        pickupName: delivery?.pickupName ?? '',
        acceptedAt: new Date(j.start),
        endedAt: j.end === null ? null : new Date(j.end),
        endEventType: j.endEventType,
        droppedOff: j.droppedOff,
        deliveryMoneyCents,
        paidWaitSeconds: paidWait,
        compensations,
      }
    })
    const paidWaitSeconds = jobUnionSeconds - waitLeft

    const breaks: WorkedBreak[] = []
    group.forEach((period, i) => {
      const previous = group[i - 1]
      if (previous) breaks.push({ startedAt: new Date(previous.e), endedAt: new Date(period.s) })
    })

    const statusChanges = changes
      .filter((c) => c.createdAt.getTime() >= start && c.createdAt.getTime() <= spanEnd)
      .map((c) => ({
        at: c.createdAt,
        fromStatus: c.fromStatus,
        toStatus: c.toStatus,
        cause: c.cause,
        byAdmin: c.adminUserId !== null,
        ...(c.adminLabel !== undefined ? { adminLabel: c.adminLabel } : {}),
      }))

    const shift: WorkedShift = {
      startedAt: new Date(start),
      startedBeforeRange: start <= windowStart,
      endedAt: endedAt === null ? null : new Date(endedAt),
      onBreakSince: onBreakSince === null ? null : new Date(onBreakSince),
      workSeconds,
      jobSeconds: jobUnionSeconds - paidWaitSeconds,
      paidWaitSeconds,
      unpaidSeconds: workSeconds - jobUnionSeconds,
      breaks,
      moneyCents: money,
      lateMoneyCents: lateMoney,
      centsPerHour: centsPerHour(money, workSeconds),
      currencyCode,
      statusChanges,
      jobs,
    }
    for (const j of jobsInShift) shiftOfJob.set(j, shift)
    allShifts.push(shift)
  })

  const rangeStart = input.rangeStart.getTime()
  const rangeEnd = input.rangeEnd.getTime()
  const shifts = allShifts.filter(
    (s) => s.startedAt.getTime() < rangeEnd && (s.endedAt?.getTime() ?? now) >= rangeStart
  )

  // ---- Day totals (AC-7): time cut at midnight, paid waiting on its job's end day, money on its
  // job's accept day, unlinked money on the day it was written. ----
  const dates = datesInRange(input.rangeStart, input.rangeEnd, timezone)
  const inRange = new Set(dates)
  const allJobUnion = mergeIntervals(paired.filter((j) => shiftOfJob.has(j)).map(jobInterval))
  const waitByDay = new Map<string, number>()
  const moneyByDay = new Map<string, number>()
  const unlinkedByDay = new Map<string, number>()
  const add = (byDay: Map<string, number>, day: string, amount: number) => {
    if (inRange.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + amount)
  }

  for (const j of paired) {
    if (!shiftOfJob.has(j)) continue
    add(waitByDay, dayOf(j.end ?? now, timezone), effectiveWait.get(j) ?? 0)
    const acceptDay = dayOf(j.start, timezone)
    const delivery = deliveryById.get(j.deliveryId)
    if (j.droppedOff && delivery) add(moneyByDay, acceptDay, (delivery.totalCompensation ?? 0) + delivery.tips)
    for (const c of compensationsByJob.get(j) ?? []) add(moneyByDay, acceptDay, c.amount)
  }
  // A zero length job (clamped, AC-4) makes no work period, so when the rider was Offline at that
  // instant it sits in no shift. Its money still counts, as money not in a recorded shift, on its
  // accept day, so it never vanishes (review 2026-11-20, minor).
  for (const j of paired) {
    if (shiftOfJob.has(j)) continue
    const acceptDay = dayOf(j.start, timezone)
    const delivery = deliveryById.get(j.deliveryId)
    if (j.droppedOff && delivery) add(unlinkedByDay, acceptDay, (delivery.totalCompensation ?? 0) + delivery.tips)
    for (const c of compensationsByJob.get(j) ?? []) add(unlinkedByDay, acceptDay, c.amount)
  }
  for (const [deliveryId, list] of compensationsByDelivery) {
    if (input.deliveriesWithAnyJob.has(deliveryId)) continue
    for (const c of list) {
      const written = c.createdAt.getTime()
      if (written >= rangeStart && written < rangeEnd) add(unlinkedByDay, dayOf(written, timezone), c.amount)
    }
  }

  // Paid waiting can never exceed a day's job time: what does not fit moves to the next day.
  let carry = 0
  const days: WorkedDay[] = dates.map((date) => {
    const from = startOfDay(date, timezone)
    const to = Math.min(rangeEnd, startOfDay(nextDate(date), timezone))
    const workSeconds = Math.floor(overlapMs(periods, from, to) / 1000)
    const jobUnionSeconds = Math.min(workSeconds, Math.floor(overlapMs(allJobUnion, from, to) / 1000))
    const wanted = (waitByDay.get(date) ?? 0) + carry
    const paidWaitSeconds = Math.min(wanted, jobUnionSeconds)
    carry = wanted - paidWaitSeconds
    const linkedMoney = moneyByDay.get(date) ?? 0
    const unlinkedMoneyCents = unlinkedByDay.get(date) ?? 0
    return {
      date,
      workSeconds,
      jobSeconds: jobUnionSeconds - paidWaitSeconds,
      paidWaitSeconds,
      unpaidSeconds: workSeconds - jobUnionSeconds,
      moneyCents: linkedMoney + unlinkedMoneyCents,
      centsPerHour: centsPerHour(linkedMoney, workSeconds),
      unlinkedMoneyCents,
    }
  })

  return { allShifts, shifts, days, otherCurrencyCompensationIds }
}
