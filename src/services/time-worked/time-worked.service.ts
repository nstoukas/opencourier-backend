import { OfferReasonRepository } from 'src/persistence/repositories/offer-reason.repository'
import { WhyYou, whyYouFrom } from 'src/domains/matching/why-you'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { EnumCourierCompensationReason, EnumCourierStatus } from '@prisma/types'
import { INSTANCE_TIMEZONE } from 'src/constants'
import * as errors from 'src/errors'
import { dayjs } from 'src/core/utils/time'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { TimelineLine, buildTimeline } from 'src/domains/time-worked/delivery-timeline'
import { PeriodFigures, summarisePeriod } from 'src/domains/time-worked/period-figures'
import {
  EnumJobEndLabel,
  WorkedDay,
  WorkedJob,
  WorkedShift,
  WorkedShiftsResult,
  buildWorkedShifts,
  centsPerHour,
  datesInRange,
  pairJobs,
} from 'src/domains/time-worked/worked-shifts'
import { TimeWorkedRecords, TimeWorkedRepository } from 'src/persistence/repositories/time-worked.repository'

// Spec 0040 (AC-18): the longest ranges a request may ask for.
export const RIDER_RANGE_MAX_DAYS = 31
export const TOTALS_RANGE_MAX_DAYS = 92
// Spec 0040 (AC-12, decision 36.15): below this many riders in a week, a rider sees no co-op figure at
// all, so a small week can never be read back to one person's hours. Admins see every week.
export const COOP_TOTALS_MIN_RIDERS = 3
// The records are read from this long before the range, so a shift that began the evening before is
// whole; a shift that began earlier still is cut there and marked "started before" (AC-11).
const LOOK_BACK_MS = 24 * 60 * 60 * 1000

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MONTH_PATTERN = /^\d{4}-\d{2}$/

// Spec 0042 (AC-9, decision 75.9): a rider opens their own work back to the same date 2 calendar
// months ago; older work is the co-op's to answer (and row 76's statements'). Admins have no limit.
// A code constant, not a co-op setting: it shapes what a rider sees, never pay or assignment.
export const RIDER_REACH_MONTHS = 2

// Spec 0042: one day's or one week's Earnings figures (AC-1).
export type EarningsDay = PeriodFigures & { date: string }
export type EarningsWeek = PeriodFigures & {
  weekStart: string
  // The week holds today, so it runs to now (AC-5).
  soFar: boolean
  // The week holds the rider's first reachable day, so its figures start there (AC-5).
  cutAtReach: boolean
}

export interface EarningsView {
  from: string
  to: string
  recordedFrom: Date | null
  currencyCode: string
  days: EarningsDay[]
  weeks: EarningsWeek[]
  // Shifts that overlap [from, to], each with only the jobs accepted inside it.
  shifts: WorkedShift[]
  jobsInNoShift: WorkedJob[]
}

export interface EarningsDeliveryDetail {
  deliveryId: string
  currencyCode: string
  // Spec 0045: why this job came to the rider, own figures only; null before spec 0044 or on a failed write.
  whyYou: WhyYou | null
  pickupName: string
  dropoffArea: string | null
  paidKm: number
  jobs: Array<{
    acceptedAt: Date
    endedAt: Date | null
    endLabel: EnumJobEndLabel | null
    minutes: number
    pickupWaitSeconds: number | null
  }>
  breakdown: {
    baseFeeCents: number | null
    distanceFeeCents: number | null
    deliveryPayCents: number
    tipsCents: number
    compensations: Array<{
      reason: EnumCourierCompensationReason
      amountCents: number
      waitMinutes: number | null
      createdAt: Date
      addedLater: boolean
    }>
    totalCents: number
  }
  timeline: TimelineLine[]
}

export interface DayRange {
  from: string
  to: string
  rangeStart: Date
  rangeEnd: Date
}

export interface TotalsRow {
  period: string
  riderCount: number
  workSeconds: number
  jobSeconds: number
  paidWaitSeconds: number
  unpaidSeconds: number
  moneyCents: number
  unlinkedMoneyCents: number
  centsPerHour: number | null
}

export type CoopWeek =
  | { weekStart: string; tooFewRiders: true }
  | {
      weekStart: string
      tooFewRiders: false
      workSeconds: number
      unpaidShare: number | null
      centsPerHour: number | null
    }

function nextDate(date: string): string {
  return dayjs.utc(date).add(1, 'day').format('YYYY-MM-DD')
}

function isRealDate(date: string): boolean {
  return DATE_PATTERN.test(date) && dayjs.utc(date).format('YYYY-MM-DD') === date
}

// Monday of the week a date falls in (weeks start on Monday, spec 0040).
export function weekStartOf(date: string): string {
  const day = dayjs.utc(date).day() // 0 = Sunday
  return dayjs
    .utc(date)
    .subtract((day + 6) % 7, 'day')
    .format('YYYY-MM-DD')
}

export function todayIn(now: Date, timezone = INSTANCE_TIMEZONE): string {
  return dayjs(now).tz(timezone).format('YYYY-MM-DD')
}

// Spec 0042 (AC-9): the first day a rider can open. dayjs keeps the day of the month and falls back to
// the month's last day when it doesn't exist, so on 31 January it is 30 November.
export function reachFromOf(today: string): string {
  return dayjs.utc(today).subtract(RIDER_REACH_MONTHS, 'month').format('YYYY-MM-DD')
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b
}

function minDate(a: string, b: string): string {
  return a < b ? a : b
}

function dayStart(date: string): Date {
  return dayjs.tz(date, INSTANCE_TIMEZONE).toDate()
}

function dateOf(at: Date): string {
  return dayjs(at).tz(INSTANCE_TIMEZONE).format('YYYY-MM-DD')
}

// Accept to the job's end (or now, while held), in whole minutes (spec 0042 AC-8). The app rounds a
// row's minutes the same way.
export function jobMinutes(job: Pick<WorkedJob, 'acceptedAt' | 'endedAt'>, now: Date): number {
  return Math.round(((job.endedAt ?? now).getTime() - job.acceptedAt.getTime()) / 60000)
}

// `YYYY-MM`, a real month (spec 0042 AC-17). Returns its first and last day.
export function parseMonth(month: unknown): { first: string; last: string } {
  if (typeof month !== 'string' || !MONTH_PATTERN.test(month)) {
    throw new BadRequestException('month must be a month written as YYYY-MM.')
  }
  const first = `${month}-01`
  if (dayjs.utc(first).format('YYYY-MM-DD') !== first) {
    throw new BadRequestException('month must be a month written as YYYY-MM.')
  }
  return { first, last: dayjs.utc(first).endOf('month').format('YYYY-MM-DD') }
}

// `YYYY-MM-DD` days in the instance timezone; 400 with a sentence naming the limit (AC-18).
export function parseDayRange(from: unknown, to: unknown, maxDays: number): DayRange {
  if (typeof from !== 'string' || typeof to !== 'string' || !isRealDate(from) || !isRealDate(to)) {
    throw new BadRequestException('from and to must be days written as YYYY-MM-DD.')
  }
  if (from > to) throw new BadRequestException('from must be on or before to.')
  const days = dayjs.utc(to).diff(dayjs.utc(from), 'day') + 1
  if (days > maxDays) throw new BadRequestException(`A range may cover at most ${maxDays} days.`)
  return {
    from,
    to,
    rangeStart: dayjs.tz(from, INSTANCE_TIMEZONE).toDate(),
    rangeEnd: dayjs.tz(nextDate(to), INSTANCE_TIMEZONE).toDate(),
  }
}

// Spec 0044: one rider's figures for today, as the fairness matcher reads them.
// The start of `now`'s day in the instance's zone (Athens).
export function instanceDayStart(now: Date): Date {
  return dayjs.tz(todayIn(now), INSTANCE_TIMEZONE).toDate()
}

export interface FairnessDayFigures {
  workSeconds: number
  // Linked money per hour worked today, tips left out; null under a minute of work.
  centsPerHour: number | null
  lastJobEndAt: Date | null
  onlineSpellStartAt: Date
}

@Injectable()
export class TimeWorkedService {
  private readonly logger = new Logger(TimeWorkedService.name)

  constructor(
    private readonly timeWorkedRepository: TimeWorkedRepository,
    private readonly configDomainService: ConfigDomainService,
    // Spec 0045: last and optional for TypeScript only, like decision 12.6; Nest always injects it.
    private readonly offerReasonRepository?: OfferReasonRepository
  ) {}

  private async settings() {
    const config = this.configDomainService.instanceConfig
    const [shiftBreakMinutes, currencyCode] = await Promise.all([config.getShiftBreakMinutes(), config.getCurrency()])
    return { shiftBreakMinutes, currencyCode: String(currencyCode) }
  }

  // Runs the one pure function for each rider found in the records. Logs only ids (AC-19).
  private computePerRider(
    records: TimeWorkedRecords,
    riders: string[],
    range: { windowStart: Date; windowEnd: Date; rangeStart: Date; rangeEnd: Date },
    now: Date,
    settings: { shiftBreakMinutes: number; currencyCode: string },
    recordedFrom: Date | null
  ): Map<string, WorkedShiftsResult> {
    const results = new Map<string, WorkedShiftsResult>()
    for (const courierId of riders) {
      const deliveryIds = records.acceptedDeliveries.get(courierId) ?? new Set<string>()
      const compensations = records.compensations.filter((c) => c.courierId === courierId)
      const result = buildWorkedShifts({
        courierId,
        now,
        windowStart: range.windowStart,
        windowEnd: range.windowEnd,
        rangeStart: range.rangeStart,
        rangeEnd: range.rangeEnd,
        statusAtWindowStart: records.statusBefore.get(courierId) ?? EnumCourierStatus.OFFLINE,
        statusChanges: records.statusChanges.filter((c) => c.courierId === courierId),
        events: records.events.filter((e) => deliveryIds.has(e.deliveryId)),
        deliveries: records.deliveries.filter((d) => deliveryIds.has(d.id)),
        compensations,
        deliveriesWithAnyJob: new Set(
          compensations.filter((c) => records.everAccepted.has(`${courierId}:${c.deliveryId}`)).map((c) => c.deliveryId)
        ),
        recordedFrom,
        shiftBreakMinutes: settings.shiftBreakMinutes,
        currencyCode: settings.currencyCode,
        timezone: INSTANCE_TIMEZONE,
      })
      for (const id of result.otherCurrencyCompensationIds) {
        this.logger.warn(`Time worked left out compensation ${id}: it is not in the instance currency`)
      }
      results.set(courierId, result)
    }
    return results
  }

  private windowFor(range: { rangeStart: Date; rangeEnd: Date }, now: Date) {
    return {
      windowStart: new Date(range.rangeStart.getTime() - LOOK_BACK_MS),
      windowEnd: new Date(Math.min(now.getTime(), range.rangeEnd.getTime() + LOOK_BACK_MS)),
      rangeStart: range.rangeStart,
      rangeEnd: range.rangeEnd,
    }
  }

  // One rider's days and shifts over a range (AC-11, AC-15). The admin view adds admin labels.
  async forRider(
    courierId: string,
    range: { rangeStart: Date; rangeEnd: Date },
    options: { withAdminLabels: boolean; withJobDetails?: boolean },
    now = new Date()
  ) {
    const settings = await this.settings()
    const recordedFrom = await this.timeWorkedRepository.findRecordedFrom()
    const window = this.windowFor(range, now)
    const records = await this.timeWorkedRepository.findRecords({
      courierId,
      ...window,
      withAdminLabels: options.withAdminLabels,
      withJobDetails: options.withJobDetails ?? false,
    })
    const result = this.computePerRider(records, [courierId], window, now, settings, recordedFrom).get(courierId)
    return {
      recordedFrom,
      currencyCode: settings.currencyCode,
      days: result?.days ?? [],
      shifts: result?.shifts ?? [],
      jobsInNoShift: result?.jobsInNoShift ?? [],
    }
  }

  // Spec 0042: the Earnings view over the days [from, to]. Records are read for the whole weeks around
  // them (decision 75.25), cut at `reachFrom` for a rider (null for an admin), so each week's figures are
  // worked out over its own days on the server; the days, shifts and jobs returned are then cut back to
  // [from, to].
  async earnings(
    courierId: string,
    days: { from: string; to: string; reachFrom: string | null },
    options: { withAdminLabels: boolean },
    now = new Date()
  ): Promise<EarningsView> {
    const { from, to, reachFrom } = days
    const today = todayIn(now)
    const firstWeek = weekStartOf(from)
    const lastWeekEnd = dayjs.utc(weekStartOf(to)).add(6, 'day').format('YYYY-MM-DD')
    const readFrom = reachFrom ? maxDate(firstWeek, reachFrom) : firstWeek
    const result = await this.forRider(
      courierId,
      { rangeStart: dayStart(readFrom), rangeEnd: dayStart(nextDate(lastWeekEnd)) },
      { withAdminLabels: options.withAdminLabels, withJobDetails: true },
      now
    )

    // Jobs in a recorded shift, by accept day: they feed the figures (jobs in no shift are unlinked
    // money, AC-2). A job sits in exactly one shift.
    const jobsByDate = new Map<string, WorkedJob[]>()
    for (const shift of result.shifts) {
      for (const job of shift.jobs) {
        const date = dateOf(job.acceptedAt)
        jobsByDate.set(date, [...(jobsByDate.get(date) ?? []), job])
      }
    }
    const figuresOf = (period: WorkedDay[]) =>
      summarisePeriod(
        period.flatMap((day) => jobsByDate.get(day.date) ?? []),
        period
      )

    const weekStarts = [...new Set(result.days.map((day) => weekStartOf(day.date)))]
    const weeks = weekStarts
      .filter((weekStart) => weekStart <= to && dayjs.utc(weekStart).add(6, 'day').format('YYYY-MM-DD') >= from)
      .map((weekStart) => {
        const weekEnd = dayjs.utc(weekStart).add(6, 'day').format('YYYY-MM-DD')
        return {
          ...figuresOf(result.days.filter((day) => weekStartOf(day.date) === weekStart)),
          weekStart,
          soFar: weekStart <= today && today <= weekEnd,
          cutAtReach: reachFrom !== null && weekStart < reachFrom,
        }
      })

    const inDays = (at: Date) => {
      const date = dateOf(at)
      return date >= from && date <= to
    }
    const fromStart = dayStart(from).getTime()
    const toEnd = dayStart(nextDate(to)).getTime()
    // A shift that crosses `from` (the reach, or a month's first day) is returned whole: its start, split,
    // money and breaks cover the whole shift, and only its job rows are cut to the asked days (decision 75.35).
    const shifts = result.shifts
      .filter((s) => s.startedAt.getTime() < toEnd && (s.endedAt?.getTime() ?? now.getTime()) >= fromStart)
      .map((s) => ({ ...s, jobs: s.jobs.filter((j) => inDays(j.acceptedAt)) }))

    return {
      from,
      to,
      recordedFrom: result.recordedFrom,
      currencyCode: result.currencyCode,
      days: result.days
        .filter((day) => day.date >= from && day.date <= to)
        .map((day) => ({ ...figuresOf([day]), date: day.date })),
      weeks,
      shifts,
      jobsInNoShift: result.jobsInNoShift.filter((j) => inDays(j.acceptedAt)),
    }
  }

  // Spec 0042 (AC-9, AC-17): a rider's own month, clamped to [reachFrom, today]. A month wholly outside
  // that answers 400 with a sentence naming the limit.
  async riderMonth(courierId: string, month: unknown, now = new Date()) {
    const { first, last } = parseMonth(month)
    const today = todayIn(now)
    const reachFrom = reachFromOf(today)
    if (last < reachFrom) {
      throw new BadRequestException(
        `You can open your work from ${reachFrom} on, ${RIDER_REACH_MONTHS} months back. For older work, ask the co-op.`
      )
    }
    if (first > today) throw new BadRequestException('That month has not started yet.')
    const view = await this.earnings(
      courierId,
      { from: maxDate(first, reachFrom), to: minDate(last, today), reachFrom },
      { withAdminLabels: false },
      now
    )
    return { ...view, month: first.slice(0, 7), reachFrom }
  }

  // Spec 0042 (AC-10, AC-11, AC-17, decision 75.28): one delivery as this rider held it. The rider's jobs
  // on it are worked out over each job's accept day with the same function the rows use, so its minutes
  // and "added later" always match the row. 404 when the rider never held a recorded job on it, or their
  // last job on it was accepted before their reach.
  async deliveryDetail(courierId: string, deliveryId: string, now = new Date()): Promise<EarningsDeliveryDetail> {
    // The project's own NotFoundException (src/errors), not Nest's: ErrorLoggingInterceptor skips this one,
    // so a rider opening a job outside their reach is not logged as an error, and Swagger's shape is true.
    const notFound = () => new errors.NotFoundException('Delivery not found')
    const acceptTimes = await this.timeWorkedRepository.findAcceptTimes(courierId, deliveryId)
    if (acceptTimes.length === 0) throw notFound()
    const reachFrom = reachFromOf(todayIn(now))

    // One full forRider read per accept day, in turn, on purpose (decision 75.28): the detail must reuse the
    // exact computation the row used. A rider holds a delivery once or twice, so this is one or two reads.
    const jobs = new Map<number, WorkedJob>()
    for (const date of new Set(acceptTimes.map(dateOf))) {
      const result = await this.forRider(
        courierId,
        { rangeStart: dayStart(date), rangeEnd: dayStart(nextDate(date)) },
        { withAdminLabels: false, withJobDetails: true },
        now
      )
      const found = [...result.shifts.flatMap((s) => s.jobs), ...result.jobsInNoShift]
      for (const job of found) if (job.deliveryId === deliveryId) jobs.set(job.acceptedAt.getTime(), job)
    }
    const held = [...jobs.values()].sort((a, b) => a.acceptedAt.getTime() - b.acceptedAt.getTime())
    const last = held[held.length - 1]
    if (!last || dateOf(last.acceptedAt) < reachFrom) throw notFound()

    // Spec 0045 (AC-1, cross check 4): the reason for the offer this rider accepted last, read up to their
    // accept (a minute's grace for a tap whose time was set on the phone). Own figures only (AC-5).
    const upTo = new Date(last.acceptedAt.getTime() + 60_000)
    const [pay, events, settings, ownReason] = await Promise.all([
      this.timeWorkedRepository.findDeliveryPay(deliveryId),
      this.timeWorkedRepository.findTimelineEvents(deliveryId),
      this.settings(),
      this.offerReasonRepository ? this.offerReasonRepository.findOwnLatest(courierId, deliveryId, upTo) : null,
    ])
    if (!pay) throw notFound()

    // Delivery pay and tips only when one of this rider's jobs ended in their drop off (spec 0040 AC-6);
    // base and distance only when they add up to what was paid, else one "Delivery pay" line.
    const delivered = held.some((j) => j.droppedOff)
    const deliveryPayCents = delivered ? pay.totalCompensation ?? 0 : 0
    const tipsCents = delivered ? pay.tips : 0
    const partsAddUp = delivered && pay.baseFee + pay.distanceFee === deliveryPayCents
    const compensations = held
      .flatMap((j) => j.compensations)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((c) => ({
        reason: c.reason,
        amountCents: c.amountCents,
        waitMinutes: c.waitMinutes,
        createdAt: c.createdAt,
        addedLater: c.addedLater,
      }))

    // The rider's holds as the server received them, for the timeline (no recordedFrom floor: a hold
    // from before recording still decides which steps were theirs).
    const holds = pairJobs(courierId, events, [pay], null).map((j) => ({
      acceptCreatedAt: j.acceptCreatedAt,
      endCreatedAt: j.endCreatedAt,
    }))

    return {
      deliveryId,
      currencyCode: settings.currencyCode,
      whyYou: whyYouFrom(ownReason),
      pickupName: pay.pickupName,
      dropoffArea: pay.dropoffArea,
      paidKm: pay.paidKm,
      jobs: held.map((j) => ({
        acceptedAt: j.acceptedAt,
        endedAt: j.endedAt,
        endLabel: j.endLabel,
        minutes: jobMinutes(j, now),
        pickupWaitSeconds: j.pickupWaitSeconds,
      })),
      breakdown: {
        baseFeeCents: partsAddUp ? pay.baseFee : null,
        distanceFeeCents: partsAddUp ? pay.distanceFee : null,
        deliveryPayCents,
        tipsCents,
        compensations,
        totalCents: compensations.reduce((sum, c) => sum + c.amountCents, deliveryPayCents + tipsCents),
      },
      timeline: buildTimeline(courierId, events, holds),
    }
  }

  // The open shift, or the one on a break, for the home counter (AC-10). Null once a break reaches the limit.
  // It reads from the start of yesterday (36.39), so a shift left Online longer than that shows less
  // work time here than in the full list. Accepted: the counter is for the shift in hand.
  async current(courierId: string, now = new Date()) {
    const settings = await this.settings()
    const recordedFrom = await this.timeWorkedRepository.findRecordedFrom()
    const today = todayIn(now)
    const range = { rangeStart: dayjs.tz(today, INSTANCE_TIMEZONE).toDate(), rangeEnd: now }
    const window = { ...this.windowFor(range, now), windowEnd: now }
    const records = await this.timeWorkedRepository.findRecords({ courierId, ...window, withAdminLabels: false })
    const result = this.computePerRider(records, [courierId], window, now, settings, recordedFrom).get(courierId)
    const last = result?.allShifts[result.allShifts.length - 1]
    return {
      asOf: now,
      shiftBreakMinutes: settings.shiftBreakMinutes,
      shift: last && last.endedAt === null ? last : null,
    }
  }

  // Spec 0044 (AC-2, AC-3): what the fairness matcher reads about every rider today (Athens day): time
  // worked, what the co-op paid them per hour (tips left out, cross check 1: the same builder run with
  // every delivery's tips at 0, so no second money rule), their last job's end today, and when their
  // current Online spell began. One read for every rider, because the co-op mean needs them all. Worked
  // out fresh for each offer (decision 12.3): a rider's figures change the moment a job ends.
  async todayForFairness(now = new Date()): Promise<Map<string, FairnessDayFigures>> {
    const settings = await this.settings()
    const recordedFrom = await this.timeWorkedRepository.findRecordedFrom()
    const today = todayIn(now)
    const todayStart = dayjs.tz(today, INSTANCE_TIMEZONE).toDate()
    const range = { rangeStart: todayStart, rangeEnd: now }
    const window = { ...this.windowFor(range, now), windowEnd: now }
    const records = await this.timeWorkedRepository.findRecords({ ...window, withAdminLabels: false })
    const withoutTips = { ...records, deliveries: records.deliveries.map((d) => ({ ...d, tips: 0 })) }
    const riders = new Set<string>([
      ...records.statusChanges.map((c) => c.courierId),
      ...records.acceptedDeliveries.keys(),
    ])
    for (const [courierId] of records.statusBefore) riders.add(courierId)
    const results = this.computePerRider(withoutTips, [...riders], window, now, settings, recordedFrom)

    const figures = new Map<string, FairnessDayFigures>()
    for (const [courierId, result] of results) {
      const day = result.days.find((d) => d.date === today)
      const jobs = [...result.allShifts.flatMap((shift) => shift.jobs), ...result.jobsInNoShift]
      // Review fix: the newest job end in the look back, not only today's. Earnings reset at midnight
      // (cross check 2), waiting does not: a rider who dropped off at 23:55 has waited minutes at 00:10.
      const endsToday = jobs.map((job) => job.endedAt).filter((at): at is Date => at !== null)
      // Cross check 5: the spell is the last move to Online from Offline; Last Call continues it.
      const spellStarts = records.statusChanges
        .filter(
          (c) =>
            c.courierId === courierId &&
            // agy review: a move from Offline straight to Last Call starts a spell too.
            (c.toStatus === EnumCourierStatus.ONLINE || c.toStatus === EnumCourierStatus.LAST_CALL) &&
            c.fromStatus === EnumCourierStatus.OFFLINE
        )
        .map((c) => c.createdAt)
      figures.set(courierId, {
        workSeconds: day?.workSeconds ?? 0,
        centsPerHour: day?.centsPerHour ?? null,
        lastJobEndAt: endsToday.length > 0 ? new Date(Math.max(...endsToday.map((at) => at.getTime()))) : null,
        // agy review: Online since before the look back (no move recorded) waits from today's start, not
        // from yesterday's, so waiting never reaches into a past day.
        onlineSpellStartAt: new Date(
          Math.max(
            spellStarts.length > 0 ? Math.max(...spellStarts.map((at) => at.getTime())) : 0,
            todayStart.getTime()
          )
        ),
      })
    }
    return figures
  }

  // Co-op totals over a range, by day or by Monday week (AC-14). Never carries a rider id.
  async totals(
    range: DayRange,
    by: 'day' | 'week',
    now = new Date()
  ): Promise<{ currencyCode: string; rows: TotalsRow[] }> {
    const settings = await this.settings()
    const recordedFrom = await this.timeWorkedRepository.findRecordedFrom()
    const window = this.windowFor(range, now)
    const records = await this.timeWorkedRepository.findRecords({ ...window, withAdminLabels: false })
    const riders = new Set<string>([
      ...records.statusChanges.map((c) => c.courierId),
      ...records.acceptedDeliveries.keys(),
      ...records.compensations.map((c) => c.courierId),
    ])
    for (const [courierId, status] of records.statusBefore) {
      if (status !== EnumCourierStatus.OFFLINE) riders.add(courierId)
    }
    const perRider = this.computePerRider(records, [...riders], window, now, settings, recordedFrom)

    const periods = new Map<string, TotalsRow & { riders: Set<string> }>()
    const periodOf = (date: string) => (by === 'week' ? weekStartOf(date) : date)
    for (const date of datesInRange(range.rangeStart, range.rangeEnd, INSTANCE_TIMEZONE)) {
      const period = periodOf(date)
      if (!periods.has(period)) {
        periods.set(period, {
          period,
          riderCount: 0,
          workSeconds: 0,
          jobSeconds: 0,
          paidWaitSeconds: 0,
          unpaidSeconds: 0,
          moneyCents: 0,
          unlinkedMoneyCents: 0,
          centsPerHour: null,
          riders: new Set(),
        })
      }
    }
    perRider.forEach((result, courierId) => {
      for (const day of result.days) {
        const row = periods.get(periodOf(day.date))
        if (!row) continue
        row.workSeconds += day.workSeconds
        row.jobSeconds += day.jobSeconds
        row.paidWaitSeconds += day.paidWaitSeconds
        row.unpaidSeconds += day.unpaidSeconds
        row.moneyCents += day.moneyCents
        row.unlinkedMoneyCents += day.unlinkedMoneyCents
        if (day.workSeconds > 0) row.riders.add(courierId)
      }
    })
    const rows = [...periods.values()].map(({ riders: ridersInPeriod, ...row }) => ({
      ...row,
      riderCount: ridersInPeriod.size,
      centsPerHour: centsPerHour(row.moneyCents - row.unlinkedMoneyCents, row.workSeconds),
    }))
    return { currencyCode: settings.currencyCode, rows }
  }

  // This week and last week for the rider's Co-op this week card (AC-12). A week with fewer than
  // COOP_TOTALS_MIN_RIDERS riders carries no figure at all, not even the count.
  async coopWeeks(now = new Date()): Promise<{ thisWeek: CoopWeek; lastWeek: CoopWeek }> {
    const today = todayIn(now)
    const thisMonday = weekStartOf(today)
    const lastMonday = dayjs.utc(thisMonday).subtract(7, 'day').format('YYYY-MM-DD')
    const range: DayRange = {
      from: lastMonday,
      to: today,
      rangeStart: dayjs.tz(lastMonday, INSTANCE_TIMEZONE).toDate(),
      rangeEnd: dayjs.tz(nextDate(today), INSTANCE_TIMEZONE).toDate(),
    }
    const { rows } = await this.totals(range, 'week', now)
    const toCard = (weekStart: string): CoopWeek => {
      const row = rows.find((r) => r.period === weekStart)
      if (!row || row.riderCount < COOP_TOTALS_MIN_RIDERS) return { weekStart, tooFewRiders: true }
      return {
        weekStart,
        tooFewRiders: false,
        workSeconds: row.workSeconds,
        unpaidShare: row.workSeconds > 0 ? row.unpaidSeconds / row.workSeconds : null,
        centsPerHour: row.centsPerHour,
      }
    }
    return { thisWeek: toCard(thisMonday), lastWeek: toCard(lastMonday) }
  }
}
