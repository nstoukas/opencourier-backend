import { WorkedDay, WorkedJob, MIN_SECONDS_FOR_RATE, centsPerHour, jobMoneyCents } from './worked-shifts'

// Spec 0042 (AC-1, decision 75.29): the Earnings figures for one period, a day or a week, worked out
// from that period's days and the jobs accepted in it. Pure, like buildWorkedShifts: the same days and
// jobs always give the same figures. Days, weeks and the admin page all call this one function, so a
// week is never added up from day figures (a median can't be).

// € per km is shown once the paid km reach a tenth of a km (decision 75.20): below that, one short job
// would give a huge, meaningless rate.
export const MIN_KM_FOR_RATE = 0.1

export interface PeriodFigures {
  workSeconds: number
  jobSeconds: number
  paidWaitSeconds: number
  unpaidSeconds: number
  // Row 36's money: includes unlinkedMoneyCents, which every figure below leaves out.
  moneyCents: number
  unlinkedMoneyCents: number
  noJobMoneyCents: number
  // € per hour worked (row 36's centsPerHour).
  centsPerHour: number | null
  // € per hour on a job: the same money over job time plus paid waiting (decision 75.5).
  activeCentsPerHour: number | null
  // Restaurant to customer km of the jobs that ended in this rider's drop off (AC-3), unrounded.
  paidKm: number
  centsPerPaidKm: number | null
  // The median arrival to pickup wait, whole seconds, and how many waits it covers (AC-4).
  medianPickupWaitSeconds: number | null
  pickupWaitCount: number
  dropOffCount: number
}

// The middle value; with an even count, the average of the two middle values, rounded to whole seconds.
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? null
  const low = sorted[middle - 1]
  const high = sorted[middle]
  if (low === undefined || high === undefined) return null
  return Math.round((low + high) / 2)
}

// `jobs` are the jobs in a recorded shift whose accept falls in the period (jobs in no shift are unlinked
// money and stay out of every figure, AC-2); `days` are the period's days from buildWorkedShifts.
export function summarisePeriod(jobs: WorkedJob[], days: WorkedDay[]): PeriodFigures {
  let workSeconds = 0
  let jobSeconds = 0
  let paidWaitSeconds = 0
  let unpaidSeconds = 0
  let moneyCents = 0
  let unlinkedMoneyCents = 0
  let noJobMoneyCents = 0
  for (const day of days) {
    workSeconds += day.workSeconds
    jobSeconds += day.jobSeconds
    paidWaitSeconds += day.paidWaitSeconds
    unpaidSeconds += day.unpaidSeconds
    moneyCents += day.moneyCents
    unlinkedMoneyCents += day.unlinkedMoneyCents
    noJobMoneyCents += day.noJobMoneyCents
  }
  const linkedMoney = moneyCents - unlinkedMoneyCents
  const activeSeconds = jobSeconds + paidWaitSeconds

  // € per paid km: only jobs that ended in this rider's drop off, with their linked compensations
  // (decision 75.17); a job with no km known adds to neither side. `dropOffCount` counts the same jobs,
  // so a drop off in no recorded shift is listed as a row but not counted here (its money is unlinked, AC-2).
  let paidKm = 0
  let deliveredMoney = 0
  let dropOffCount = 0
  const waits: number[] = []
  for (const job of jobs) {
    if (job.droppedOff) {
      dropOffCount += 1
      if (job.paidKm !== null) {
        paidKm += job.paidKm
        deliveredMoney += jobMoneyCents(job)
      }
    }
    if (job.pickupWaitSeconds !== null) waits.push(job.pickupWaitSeconds)
  }

  return {
    workSeconds,
    jobSeconds,
    paidWaitSeconds,
    unpaidSeconds,
    moneyCents,
    unlinkedMoneyCents,
    noJobMoneyCents,
    centsPerHour: centsPerHour(linkedMoney, workSeconds),
    activeCentsPerHour: activeSeconds < MIN_SECONDS_FOR_RATE ? null : Math.round((linkedMoney * 3600) / activeSeconds),
    paidKm,
    centsPerPaidKm: paidKm < MIN_KM_FOR_RATE ? null : Math.round(deliveredMoney / paidKm),
    medianPickupWaitSeconds: medianOf(waits),
    pickupWaitCount: waits.length,
    dropOffCount,
  }
}
