import { CourierEarningsRow } from '../types/earnings-summary.type'
import { isValidTimezone, summarizeEarningsByDay } from './earnings-summary.util'

describe('earnings-summary.util', () => {
  describe('summarizeEarningsByDay', () => {
    // Test Plan Case 1: Groups same-day deliveries
    test('groups multiple deliveries on the same day into a single day summary', () => {
      // Setup two completed delivery rows on 2026-07-10 UTC
      const rows: CourierEarningsRow[] = [
        {
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-10T10:00:00Z'),
          totalCompensation: 500, // 500 cents = 5.00 EUR
          tips: 100, // 100 cents = 1.00 EUR
        },
        {
          deliveryId: 'del-2',
          droppedOffAt: new Date('2026-07-10T14:30:00Z'),
          totalCompensation: 700, // 700 cents = 7.00 EUR
          tips: 0,
        },
      ]

      const result = summarizeEarningsByDay(rows, 'UTC')

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        date: '2026-07-10',
        deliveryCount: 2,
        compensation: 1200, // 500 + 700
        tips: 100, // 100 + 0
        total: 1300, // 1200 + 100
      })
    })

    // Test Plan Case 2: Timezone shifts the day boundary
    test('shifts delivery date boundary based on the requested timezone', () => {
      // Delivery occurred at 22:30 UTC on July 10
      const rows: CourierEarningsRow[] = [
        {
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-10T22:30:00Z'),
          totalCompensation: 600,
          tips: 150,
        },
      ]

      // In UTC, 22:30 is still July 10
      const utcResult = summarizeEarningsByDay(rows, 'UTC')
      expect(utcResult[0]?.date).toBe('2026-07-10')

      // In Europe/Athens (UTC+3 in July DST), 22:30 UTC is 01:30 July 11
      const athensResult = summarizeEarningsByDay(rows, 'Europe/Athens')
      expect(athensResult[0]?.date).toBe('2026-07-11')
    })

    // Test Plan Case 3: Deduplicates by deliveryId
    test('deduplicates multiple events for the same deliveryId keeping the earlier drop-off timestamp', () => {
      // Setup duplicate events for delivery 'del-1' (defensive check against duplicate event rows)
      const rows: CourierEarningsRow[] = [
        {
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-11T12:00:00Z'), // Later event
          totalCompensation: 800,
          tips: 200,
        },
        {
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-10T08:00:00Z'), // Earlier event
          totalCompensation: 800,
          tips: 200,
        },
      ]

      const result = summarizeEarningsByDay(rows, 'UTC')

      // Should count delivery only once and attribute it to the earlier date
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        date: '2026-07-10',
        deliveryCount: 1,
        compensation: 800,
        tips: 200,
        total: 1000,
      })
    })

    // Test Plan Case 4: null compensation counts as 0 but delivery stays visible
    test('treats null compensation as 0 while preserving delivery count for audit visibility', () => {
      // Setup a delivery where compensation calculation was missing or incomplete (null)
      const rows: CourierEarningsRow[] = [
        {
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-10T12:00:00Z'),
          totalCompensation: null, // Missing pay calculation
          tips: 200,
        },
      ]

      const result = summarizeEarningsByDay(rows, 'UTC')

      expect(result[0]).toEqual({
        date: '2026-07-10',
        deliveryCount: 1,
        compensation: 0, // null mapped to 0
        tips: 200,
        total: 200, // 0 + 200
      })
    })

    // Test Plan Case 5: Empty input
    test('returns an empty array when given no delivery rows', () => {
      const result = summarizeEarningsByDay([], 'UTC')
      expect(result).toEqual([])
    })

    // Test Plan Case 6: Days are sorted ascending
    test('sorts output day summaries in ascending chronological order', () => {
      // Setup deliveries delivered out of chronological order
      const rows: CourierEarningsRow[] = [
        {
          deliveryId: 'del-3',
          droppedOffAt: new Date('2026-07-12T10:00:00Z'),
          totalCompensation: 500,
          tips: 0,
        },
        {
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-10T10:00:00Z'),
          totalCompensation: 500,
          tips: 0,
        },
        {
          deliveryId: 'del-2',
          droppedOffAt: new Date('2026-07-11T10:00:00Z'),
          totalCompensation: 500,
          tips: 0,
        },
      ]

      const result = summarizeEarningsByDay(rows, 'UTC')

      const dates = result.map((day) => day.date)
      expect(dates).toEqual(['2026-07-10', '2026-07-11', '2026-07-12'])
    })
  })

  describe('isValidTimezone', () => {
    // Test Plan Case 7: Valid and invalid timezones
    test('validates IANA timezone strings correctly', () => {
      // Valid IANA timezone names should return true
      expect(isValidTimezone('Europe/Athens')).toBe(true)
      expect(isValidTimezone('UTC')).toBe(true)
      expect(isValidTimezone('America/New_York')).toBe(true)

      // Invalid timezone names or empty strings should return false
      expect(isValidTimezone('Not/AZone')).toBe(false)
      expect(isValidTimezone('')).toBe(false)
      expect(isValidTimezone('Invalid/Timezone_Name')).toBe(false)
    })
  })
})
