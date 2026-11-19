import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { EnumCourierStatus } from '@prisma/types'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { dayjs } from 'src/core/utils/time'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import {
  WorkedDay,
  WorkedShift,
  buildWorkedShifts,
  centsPerHour,
  datesInRange,
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

@Injectable()
export class TimeWorkedService {
  private readonly logger = new Logger(TimeWorkedService.name)

  constructor(
    private readonly timeWorkedRepository: TimeWorkedRepository,
    private readonly configDomainService: ConfigDomainService
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
  ): Map<string, { shifts: WorkedShift[]; allShifts: WorkedShift[]; days: WorkedDay[] }> {
    const results = new Map<string, { shifts: WorkedShift[]; allShifts: WorkedShift[]; days: WorkedDay[] }>()
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
  async forRider(courierId: string, range: DayRange, options: { withAdminLabels: boolean }, now = new Date()) {
    const settings = await this.settings()
    const recordedFrom = await this.timeWorkedRepository.findRecordedFrom()
    const window = this.windowFor(range, now)
    const records = await this.timeWorkedRepository.findRecords({
      courierId,
      ...window,
      withAdminLabels: options.withAdminLabels,
    })
    const result = this.computePerRider(records, [courierId], window, now, settings, recordedFrom).get(courierId)
    return {
      recordedFrom,
      currencyCode: settings.currencyCode,
      days: result?.days ?? [],
      shifts: result?.shifts ?? [],
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
