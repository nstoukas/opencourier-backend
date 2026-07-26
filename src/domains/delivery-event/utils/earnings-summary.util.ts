import { dayjs } from 'src/core/utils/time'
import {
  CourierEarningsRow,
  EarningsDaySummary,
  CourierEarningsDeliveryRow,
  EarningsDelivery,
} from '../types/earnings-summary.type'

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

// Keeps one row per delivery: the EARLIEST successful drop-off event. This is the single
// rule that defines "when a delivery counts", shared by summary and drill-down.
export function dedupeEarliestDropOff<T extends { deliveryId: string; droppedOffAt: Date }>(rows: T[]): T[] {
  const dedupedMap = new Map<string, T>()

  for (const row of rows) {
    const existing = dedupedMap.get(row.deliveryId)
    if (!existing || row.droppedOffAt.getTime() < existing.droppedOffAt.getTime()) {
      dedupedMap.set(row.deliveryId, row)
    }
  }

  return Array.from(dedupedMap.values())
}

// Composes a display address: prefer the geocoder's formattedAddress, else 'street, city, state'.
export function formatDropoffAddress(
  location: { formattedAddress: string | null; street: string | null; city: string | null; state: string | null } | null
): string | null {
  if (!location) return null
  if (location.formattedAddress) return location.formattedAddress

  const parts = [location.street, location.city, location.state].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

// Maps one repository row to the API shape (compensation = totalCompensation ?? 0).
export function toEarningsDelivery(row: CourierEarningsDeliveryRow): EarningsDelivery {
  const compensation = row.totalCompensation ?? 0
  const tips = row.tips
  return {
    deliveryId: row.deliveryId,
    droppedOffAt: row.droppedOffAt,
    dropoffAddress: row.dropoffAddress,
    pickupBusinessName: row.pickupBusinessName,
    compensation,
    tips,
    total: compensation + tips,
  }
}

// Precondition: timezone already validated by isValidTimezone (same note as summarizeEarningsByDay).
// Dedupes (step 2), keeps only rows whose droppedOffAt falls on `date` in `timezone`
// (dayjs(row.droppedOffAt).tz(timezone).format('YYYY-MM-DD') === date), sorts by
// droppedOffAt ascending, maps with toEarningsDelivery.
export function listEarningsDeliveriesForDay(
  rows: CourierEarningsDeliveryRow[],
  date: string, // 'YYYY-MM-DD'
  timezone: string
): EarningsDelivery[] {
  const dedupedRows = dedupeEarliestDropOff(rows)
  const matchingRows = dedupedRows.filter(
    (row) => dayjs(row.droppedOffAt).tz(timezone).format('YYYY-MM-DD') === date
  )
  matchingRows.sort((a, b) => a.droppedOffAt.getTime() - b.droppedOffAt.getTime())
  return matchingRows.map(toEarningsDelivery)
}

// Precondition: `timezone` must be a value `isValidTimezone` accepts — dayjs throws a
// RangeError on anything else.
export function summarizeEarningsByDay(rows: CourierEarningsRow[], timezone: string): EarningsDaySummary[] {
  const dedupedRows = dedupeEarliestDropOff(rows)
  const byDayMap = new Map<string, EarningsDaySummary>()

  for (const row of dedupedRows) {
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

