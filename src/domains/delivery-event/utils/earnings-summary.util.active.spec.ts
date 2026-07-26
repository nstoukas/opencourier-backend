import { CourierEarningsRow, CourierEarningsDeliveryRow } from '../types/earnings-summary.type'
import {
  isValidTimezone,
  summarizeEarningsByDay,
  dedupeEarliestDropOff,
  formatDropoffAddress,
  listEarningsDeliveriesForDay,
} from './earnings-summary.util'

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

  describe('dedupeEarliestDropOff', () => {
    // Test Plan Section 1: dedupeEarliestDropOff
    test('keeps the entire earlier row — not just its timestamp — when duplicates share a deliveryId', () => {
      // The rows differ in every field so this catches any mixing of fields
      // between rows: this function decides whose compensation and tips count.
      const earlier = {
        deliveryId: 'del-1',
        droppedOffAt: new Date('2026-07-10T10:00:00Z'),
        totalCompensation: 800,
        tips: 200,
      }
      const later = {
        deliveryId: 'del-1',
        droppedOffAt: new Date('2026-07-10T14:00:00Z'),
        totalCompensation: 999,
        tips: 50,
      }

      const result = dedupeEarliestDropOff([later, earlier])

      // Whole-row equality: timestamp, compensation and tips all from `earlier`.
      expect(result).toEqual([earlier])
    })

    test('passes through distinct delivery IDs without filtering', () => {
      // Setup rows for two separate deliveries
      const rows = [
        { deliveryId: 'del-1', droppedOffAt: new Date('2026-07-10T10:00:00Z') },
        { deliveryId: 'del-2', droppedOffAt: new Date('2026-07-10T11:00:00Z') },
      ]

      const result = dedupeEarliestDropOff(rows)

      expect(result).toHaveLength(2)
      expect(result.map((r) => r.deliveryId)).toEqual(['del-1', 'del-2'])
    })

    test('returns an empty array when given an empty list', () => {
      expect(dedupeEarliestDropOff([])).toEqual([])
    })
  })

  describe('formatDropoffAddress', () => {
    // Test Plan Section 2: formatDropoffAddress
    test('prefers formattedAddress over individual street/city/state fields when present', () => {
      const location = {
        formattedAddress: 'Leoforos Nikis 45, Thessaloniki 54623',
        street: 'Nikis 45',
        city: 'Thessaloniki',
        state: 'Central Macedonia',
      }

      expect(formatDropoffAddress(location)).toBe('Leoforos Nikis 45, Thessaloniki 54623')
    })

    test('composes address string from non-null street, city, and state when formattedAddress is null', () => {
      const location = {
        formattedAddress: null,
        street: 'Iasonos 12',
        city: 'Volos',
        state: 'Thessaly',
      }

      expect(formatDropoffAddress(location)).toBe('Iasonos 12, Volos, Thessaly')
    })

    test('skips empty address parts without adding dangling commas', () => {
      // Setup location with street only (city and state are null)
      const streetOnly = {
        formattedAddress: null,
        street: 'Iasonos 12',
        city: null,
        state: null,
      }

      expect(formatDropoffAddress(streetOnly)).toBe('Iasonos 12')

      // Setup location with street and city (state is empty string)
      const streetAndCity = {
        formattedAddress: null,
        street: 'Iasonos 12',
        city: 'Volos',
        state: '',
      }

      expect(formatDropoffAddress(streetAndCity)).toBe('Iasonos 12, Volos')
    })

    test('returns null when location is null or all address fields are empty', () => {
      expect(formatDropoffAddress(null)).toBeNull()

      const emptyLocation = {
        formattedAddress: null,
        street: null,
        city: null,
        state: null,
      }

      expect(formatDropoffAddress(emptyLocation)).toBeNull()
    })
  })

  describe('listEarningsDeliveriesForDay', () => {
    // Test Plan Section 3: listEarningsDeliveriesForDay
    test('filters deliveries to only those occurring on the specified date in the given timezone', () => {
      const rows: CourierEarningsDeliveryRow[] = [
        {
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-10T22:30:00Z'), // 22:30 UTC = July 10 UTC, July 11 in Europe/Athens (UTC+3)
          totalCompensation: 500,
          tips: 100,
          pickupBusinessName: 'Ta Koutsavakia',
          dropoffAddress: 'Iasonos 12, Volos',
        },
        {
          deliveryId: 'del-2',
          droppedOffAt: new Date('2026-07-10T14:00:00Z'), // July 10 in both UTC and Athens
          totalCompensation: 600,
          tips: 50,
          pickupBusinessName: 'O Gyros tis Elladas',
          dropoffAddress: 'Ermou 4, Volos',
        },
      ]

      // Querying for 2026-07-10 in UTC includes both deliveries
      const utcDeliveries = listEarningsDeliveriesForDay(rows, '2026-07-10', 'UTC')
      expect(utcDeliveries).toHaveLength(2)

      // Querying for 2026-07-10 in Europe/Athens includes only del-2 (del-1 shifted to July 11)
      const athensDeliveries = listEarningsDeliveriesForDay(rows, '2026-07-10', 'Europe/Athens')
      expect(athensDeliveries).toHaveLength(1)
      expect(athensDeliveries[0]?.deliveryId).toBe('del-2')

      // Querying for 2026-07-11 in Europe/Athens includes del-1
      const athensNextDay = listEarningsDeliveriesForDay(rows, '2026-07-11', 'Europe/Athens')
      expect(athensNextDay).toHaveLength(1)
      expect(athensNextDay[0]?.deliveryId).toBe('del-1')
    })

    test('deduplicates multiple events for the same delivery to the earliest timestamp', () => {
      const rows: CourierEarningsDeliveryRow[] = [
        {
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-10T14:00:00Z'), // Later duplicate
          totalCompensation: 500,
          tips: 100,
          pickupBusinessName: 'Ta Koutsavakia',
          dropoffAddress: 'Iasonos 12, Volos',
        },
        {
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-10T10:00:00Z'), // Earlier event
          totalCompensation: 500,
          tips: 100,
          pickupBusinessName: 'Ta Koutsavakia',
          dropoffAddress: 'Iasonos 12, Volos',
        },
      ]

      const deliveries = listEarningsDeliveriesForDay(rows, '2026-07-10', 'UTC')

      expect(deliveries).toHaveLength(1)
      expect(deliveries[0]?.droppedOffAt).toEqual(new Date('2026-07-10T10:00:00Z'))
    })

    test('sorts resulting deliveries in ascending order by droppedOffAt', () => {
      const rows: CourierEarningsDeliveryRow[] = [
        {
          deliveryId: 'del-late',
          droppedOffAt: new Date('2026-07-10T18:00:00Z'),
          totalCompensation: 500,
          tips: 0,
          pickupBusinessName: 'Rest A',
          dropoffAddress: 'Addr A',
        },
        {
          deliveryId: 'del-early',
          droppedOffAt: new Date('2026-07-10T09:00:00Z'),
          totalCompensation: 400,
          tips: 50,
          pickupBusinessName: 'Rest B',
          dropoffAddress: 'Addr B',
        },
      ]

      const result = listEarningsDeliveriesForDay(rows, '2026-07-10', 'UTC')

      expect(result.map((d) => d.deliveryId)).toEqual(['del-early', 'del-late'])
    })

    test('maps null totalCompensation to compensation 0 and computes total correctly', () => {
      const rows: CourierEarningsDeliveryRow[] = [
        {
          deliveryId: 'del-null-comp',
          droppedOffAt: new Date('2026-07-10T12:00:00Z'),
          totalCompensation: null, // Null compensation
          tips: 250, // 2.50 EUR tip
          pickupBusinessName: 'Cafe Central',
          dropoffAddress: 'Main St 1',
        },
      ]

      const result = listEarningsDeliveriesForDay(rows, '2026-07-10', 'UTC')

      expect(result[0]).toEqual({
        deliveryId: 'del-null-comp',
        droppedOffAt: new Date('2026-07-10T12:00:00Z'),
        dropoffAddress: 'Main St 1',
        pickupBusinessName: 'Cafe Central',
        compensation: 0,
        tips: 250,
        total: 250,
      })
    })

    test('returns empty array when given no rows', () => {
      expect(listEarningsDeliveriesForDay([], '2026-07-10', 'UTC')).toEqual([])
    })
  })

  describe('Consistency invariant (transparency guarantee)', () => {
    // Test Plan Section 4: Consistency invariant
    test('guarantees that day list details sum up exactly to summary totals for every day', () => {
      const rows: CourierEarningsDeliveryRow[] = [
        {
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-10T10:00:00Z'),
          totalCompensation: 500,
          tips: 100,
          pickupBusinessName: 'Store A',
          dropoffAddress: 'Street 1',
        },
        {
          deliveryId: 'del-2',
          droppedOffAt: new Date('2026-07-10T16:00:00Z'),
          totalCompensation: 750,
          tips: 200,
          pickupBusinessName: 'Store B',
          dropoffAddress: 'Street 2',
        },
        {
          deliveryId: 'del-3',
          droppedOffAt: new Date('2026-07-11T11:00:00Z'),
          totalCompensation: 600,
          tips: 0,
          pickupBusinessName: 'Store C',
          dropoffAddress: 'Street 3',
        },
        {
          // Duplicate event for del-1 to verify deduplication consistency across both
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-10T12:00:00Z'),
          totalCompensation: 500,
          tips: 100,
          pickupBusinessName: 'Store A',
          dropoffAddress: 'Street 1',
        },
      ]

      const timezone = 'Europe/Athens'
      const summaryDays = summarizeEarningsByDay(rows, timezone)

      for (const daySummary of summaryDays) {
        const dayDeliveries = listEarningsDeliveriesForDay(rows, daySummary.date, timezone)

        // Count match
        expect(dayDeliveries.length).toBe(daySummary.deliveryCount)

        // Sum matches
        const summedCompensation = dayDeliveries.reduce((sum, d) => sum + d.compensation, 0)
        const summedTips = dayDeliveries.reduce((sum, d) => sum + d.tips, 0)
        const summedTotal = dayDeliveries.reduce((sum, d) => sum + d.total, 0)

        expect(summedCompensation).toBe(daySummary.compensation)
        expect(summedTips).toBe(daySummary.tips)
        expect(summedTotal).toBe(daySummary.total)
      }
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

