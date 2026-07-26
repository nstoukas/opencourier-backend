import { dayjs } from 'src/core/utils/time'
import { CourierEarningsRow, EarningsDaySummary } from '../types/earnings-summary.type'

export function isValidTimezone(tz: string): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    // Also check with dayjs, since it is what actually computes the day boundaries and it
    // rejects some values Intl accepts (offset forms like '+03:00').
    dayjs().tz(tz)
    return true
  } catch {
    return false
  }
}

// Precondition: `timezone` must be a value `isValidTimezone` accepts — dayjs throws a
// RangeError on anything else.
export function summarizeEarningsByDay(rows: CourierEarningsRow[], timezone: string): EarningsDaySummary[] {
  const dedupedMap = new Map<string, CourierEarningsRow>()

  for (const row of rows) {
    const existing = dedupedMap.get(row.deliveryId)
    if (!existing || row.droppedOffAt.getTime() < existing.droppedOffAt.getTime()) {
      dedupedMap.set(row.deliveryId, row)
    }
  }

  const byDayMap = new Map<string, EarningsDaySummary>()

  for (const row of dedupedMap.values()) {
    const dateStr = dayjs(row.droppedOffAt).tz(timezone).format('YYYY-MM-DD')
    const comp = row.totalCompensation ?? 0
    const tips = row.tips

    const daySummary = byDayMap.get(dateStr)
    if (!daySummary) {
      byDayMap.set(dateStr, {
        date: dateStr,
        deliveryCount: 1,
        compensation: comp,
        tips: tips,
        total: comp + tips,
      })
    } else {
      daySummary.deliveryCount += 1
      daySummary.compensation += comp
      daySummary.tips += tips
      daySummary.total += comp + tips
    }
  }

  return Array.from(byDayMap.values()).sort((a, b) => a.date.localeCompare(b.date))
}
