import { EnumCourierCompensationReason } from '@prisma/types'
import { PeriodFigures, summarisePeriod } from 'src/domains/time-worked/period-figures'
import { EnumJobEndLabel, WorkedDay, WorkedJob } from 'src/domains/time-worked/worked-shifts'
import { StatementLang } from './statement-labels'

// Spec 0050 (row 76): a rider's month as a statement. Pure: built from the Earnings view of the month
// (`TimeWorkedService.earnings` with no reach), so its totals are the screen's by construction (AC-3).

// Cross check 8: the fixed money columns, the same every month.
export interface StatementJobRow {
  deliveryId: string
  acceptedAt: Date
  pickupName: string
  // Never the house number (spec 0042 AC-12): the repository works out the area.
  dropoffArea: string | null
  paidKm: number | null
  minutes: number
  end: EnumJobEndLabel | 'DELIVERED'
  deliveryPayCents: number
  tipsCents: number
  waitingCents: number
  cancellationCents: number
  removalCents: number
  returnTripCents: number
  reviewCents: number
  otherCents: number
  // The compensation types summed into Other (cross check 8), for the note column.
  otherReasons: EnumCourierCompensationReason[]
  totalCents: number
}

export interface StatementTotals {
  moneyCents: number
  dropOffCount: number
  paidKm: number
  // Null when time was not recorded for the whole month (cross check 3).
  workSeconds: number | null
  jobSeconds: number | null
  paidWaitSeconds: number | null
  unpaidSeconds: number | null
  centsPerHour: number | null
  centsPerPaidKm: number | null
}

export interface StatementModel {
  month: string
  lang: StatementLang
  coopName: string
  riderName: string
  madeAt: Date
  currencyCode: string
  jobs: StatementJobRow[]
  // Cross check 9: money that belongs to no recorded job, per day.
  unlinked: Array<{ date: string; amountCents: number }>
  totals: StatementTotals
  // Cross check 3: false when the time record began after the month's first moment (or never).
  timeRecorded: boolean
  // Cross check 5: money on this month's jobs added after the month ended; 0 when none.
  addedLaterCents: number
  // The last day of the month, YYYY-MM-DD, for the "Added after" line.
  monthEnd: string
}

// What the model reads from the Earnings view (a subset, so a test can build it by hand).
export interface StatementSource {
  days: Array<WorkedDay & PeriodFigures>
  // Jobs accepted in the month that sit in a recorded shift: they feed € per hour (spec 0042 AC-2).
  jobsInShifts: WorkedJob[]
  // Jobs accepted in the month in no recorded shift: listed like any job, their money is unlinked.
  jobsInNoShift: WorkedJob[]
  recordedFrom: Date | null
  currencyCode: string
}

// The money columns a compensation can land in (a union of keys, so `row[column]` is known to be a number).
type MoneyColumn = 'waitingCents' | 'cancellationCents' | 'removalCents' | 'returnTripCents' | 'reviewCents'

const COLUMN_OF: Partial<Record<EnumCourierCompensationReason, MoneyColumn>> = {
  WAITING: 'waitingCents',
  CANCELLATION: 'cancellationCents',
  REMOVAL: 'removalCents',
  RETURN_TRIP: 'returnTripCents',
  REVIEW: 'reviewCents',
}

// One job as a row (cross check 7: the pay parts plus tips equal the job total).
export function jobRow(job: WorkedJob, tipsCents: number, now: Date): StatementJobRow {
  // deliveryMoneyCents is the delivery's pay plus tips, and only when the job ended in this rider's drop off.
  const tips = job.droppedOff ? Math.min(tipsCents, job.deliveryMoneyCents) : 0
  const row: StatementJobRow = {
    deliveryId: job.deliveryId,
    acceptedAt: job.acceptedAt,
    pickupName: job.pickupName,
    dropoffArea: job.dropoffArea,
    paidKm: job.paidKm,
    minutes: Math.round(((job.endedAt ?? now).getTime() - job.acceptedAt.getTime()) / 60000),
    end: job.endLabel ?? 'DELIVERED',
    deliveryPayCents: job.deliveryMoneyCents - tips,
    tipsCents: tips,
    waitingCents: 0,
    cancellationCents: 0,
    removalCents: 0,
    returnTripCents: 0,
    reviewCents: 0,
    otherCents: 0,
    otherReasons: [],
    totalCents: job.deliveryMoneyCents,
  }
  for (const compensation of job.compensations) {
    const column = COLUMN_OF[compensation.reason]
    if (column) {
      row[column] += compensation.amountCents
    } else {
      row.otherCents += compensation.amountCents
      if (!row.otherReasons.includes(compensation.reason)) row.otherReasons.push(compensation.reason)
    }
    row.totalCents += compensation.amountCents
  }
  return row
}

// Cross check 6: the sums come from the days (money, drop offs, km, seconds), € per hour and € per paid km
// from summarisePeriod over the whole month, exactly as the screen's own figures are made.
export function statementTotals(source: StatementSource, timeRecorded: boolean): StatementTotals {
  const sum = (pick: (day: PeriodFigures) => number) => source.days.reduce((total, day) => total + pick(day), 0)
  const month = summarisePeriod(source.jobsInShifts, source.days)
  return {
    moneyCents: sum((day) => day.moneyCents),
    dropOffCount: sum((day) => day.dropOffCount),
    paidKm: sum((day) => day.paidKm),
    workSeconds: timeRecorded ? sum((day) => day.workSeconds) : null,
    jobSeconds: timeRecorded ? sum((day) => day.jobSeconds) : null,
    paidWaitSeconds: timeRecorded ? sum((day) => day.paidWaitSeconds) : null,
    unpaidSeconds: timeRecorded ? sum((day) => day.unpaidSeconds) : null,
    centsPerHour: timeRecorded ? month.centsPerHour : null,
    centsPerPaidKm: month.centsPerPaidKm,
  }
}

export function buildStatement(input: {
  month: string
  monthStart: Date
  monthEnd: string
  nextMonthStart: Date
  lang: StatementLang
  coopName: string
  riderName: string
  madeAt: Date
  source: StatementSource
  tipsByDelivery: Map<string, number>
}): StatementModel {
  const { source } = input
  const timeRecorded = source.recordedFrom !== null && source.recordedFrom.getTime() <= input.monthStart.getTime()
  const allJobs = [...source.jobsInShifts, ...source.jobsInNoShift].sort(
    (a, b) => a.acceptedAt.getTime() - b.acceptedAt.getTime() || (a.deliveryId < b.deliveryId ? -1 : 1)
  )
  const jobs = allJobs.map((job) => jobRow(job, input.tipsByDelivery.get(job.deliveryId) ?? 0, input.madeAt))
  const addedLaterCents = allJobs
    .flatMap((job) => job.compensations)
    .filter((c) => c.createdAt.getTime() >= input.nextMonthStart.getTime())
    .reduce((total, c) => total + c.amountCents, 0)
  return {
    month: input.month,
    lang: input.lang,
    coopName: input.coopName,
    riderName: input.riderName,
    madeAt: input.madeAt,
    currencyCode: source.currencyCode,
    jobs,
    unlinked: source.days
      .filter((day) => day.noJobMoneyCents !== 0)
      .map((day) => ({ date: day.date, amountCents: day.noJobMoneyCents })),
    totals: statementTotals(source, timeRecorded),
    timeRecorded,
    addedLaterCents,
    monthEnd: input.monthEnd,
  }
}
