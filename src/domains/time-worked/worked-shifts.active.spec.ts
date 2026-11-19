import {
  EnumCourierCompensationReason,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
} from '@prisma/types'
import {
  CompensationRow,
  JobDeliveryRow,
  JobEventRow,
  StatusChangeRow,
  WorkedShiftsInput,
  buildWorkedShifts,
  centsPerHour,
  datesInRange,
  pairJobs,
} from './worked-shifts'

describe('WorkedShifts (spec 0040, AC-4 to AC-7)', () => {
  const courierId = 'courier-test-1'
  const timezone = 'Europe/Athens'
  const currencyCode = 'EUR'

  const makeDate = (isoStr: string) => new Date(isoStr)

  const createInput = (overrides: Partial<WorkedShiftsInput> = {}): WorkedShiftsInput => {
    const rangeStart = makeDate('2026-11-19T00:00:00+02:00')
    const rangeEnd = makeDate('2026-11-20T00:00:00+02:00')
    return {
      courierId,
      now: makeDate('2026-11-19T23:59:59+02:00'),
      windowStart: rangeStart,
      windowEnd: rangeEnd,
      rangeStart,
      rangeEnd,
      statusAtWindowStart: EnumCourierStatus.OFFLINE,
      statusChanges: [],
      events: [],
      deliveries: [],
      compensations: [],
      deliveriesWithAnyJob: new Set(),
      recordedFrom: makeDate('2026-01-01T00:00:00+02:00'),
      shiftBreakMinutes: 30,
      currencyCode,
      timezone,
      ...overrides,
    }
  }

  describe('Happy path (AC-4, AC-5, AC-6)', () => {
    test('18:00 to 19:00: work 3600, job 1500, paid wait 300, unpaid 1800, money = totalComp + tips + wait comp', () => {
      // 18:00 Online, 19:00 Offline
      const statusChanges: StatusChangeRow[] = [
        {
          id: 'sc-1',
          createdAt: makeDate('2026-11-19T18:00:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-2',
          createdAt: makeDate('2026-11-19T19:00:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ]

      // Accept at 18:10, Dropoff at 18:40 (30 min = 1800 s job union)
      const events: JobEventRow[] = [
        {
          id: 'ev-1',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-19T18:10:00+02:00'),
          createdAt: makeDate('2026-11-19T18:10:00+02:00'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
          courierId,
          occurredAt: makeDate('2026-11-19T18:40:00+02:00'),
          createdAt: makeDate('2026-11-19T18:40:00+02:00'),
        },
      ]

      const deliveries: JobDeliveryRow[] = [
        {
          id: 'del-1',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 1200,
          tips: 300,
          pickupName: 'Taverna Volos',
        },
      ]

      // 5 min paid waiting (300 s) with 200 cents compensation
      const compensations: CompensationRow[] = [
        {
          id: 'comp-1',
          deliveryId: 'del-1',
          amount: 200,
          currencyCode: 'EUR',
          reason: EnumCourierCompensationReason.WAITING,
          waitMinutes: 5,
          createdAt: makeDate('2026-11-19T18:30:00+02:00'),
        },
      ]

      const input = createInput({
        statusChanges,
        events,
        deliveries,
        compensations,
        deliveriesWithAnyJob: new Set(['del-1']),
        now: makeDate('2026-11-19T20:00:00+02:00'),
      })

      const result = buildWorkedShifts(input)

      expect(result.shifts).toHaveLength(1)
      const shift = result.shifts[0]!
      expect(shift.workSeconds).toBe(3600)
      expect(shift.paidWaitSeconds).toBe(300)
      expect(shift.jobSeconds).toBe(1500) // 1800 job union - 300 paid wait
      expect(shift.unpaidSeconds).toBe(1800) // 3600 work - 1800 job union
      expect(shift.workSeconds).toBe(shift.jobSeconds + shift.paidWaitSeconds + shift.unpaidSeconds)
      // money = totalCompensation (1200) + tips (300) + wait compensation (200) = 1700
      expect(shift.moneyCents).toBe(1700)
      expect(shift.lateMoneyCents).toBe(0)
      expect(shift.breaks).toEqual([])
    })
  })

  describe('Breaks and shift limits (AC-4)', () => {
    test('a 20 minute Offline is a break (listed, not counted) and a 30 minute one ends the shift (limit 30)', () => {
      // 18:00 Online -> 18:20 Offline -> 18:40 Online (20m gap: break) -> 19:00 Offline -> 19:30 Online (30m gap: new shift) -> 20:00 Offline
      const statusChanges: StatusChangeRow[] = [
        {
          id: 'sc-1',
          createdAt: makeDate('2026-11-19T18:00:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-2',
          createdAt: makeDate('2026-11-19T18:20:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-3',
          createdAt: makeDate('2026-11-19T18:40:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-4',
          createdAt: makeDate('2026-11-19T19:00:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-5',
          createdAt: makeDate('2026-11-19T19:30:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-6',
          createdAt: makeDate('2026-11-19T20:00:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ]

      const input = createInput({
        statusChanges,
        shiftBreakMinutes: 30,
        now: makeDate('2026-11-19T21:00:00+02:00'),
      })

      const result = buildWorkedShifts(input)

      expect(result.shifts).toHaveLength(2)
      const [shift1, shift2] = result.shifts
      // Shift 1 has 20 min + 20 min = 2400 s work time, break of 20 min
      expect(shift1!.startedAt).toEqual(makeDate('2026-11-19T18:00:00+02:00'))
      expect(shift1!.endedAt).toEqual(makeDate('2026-11-19T19:00:00+02:00'))
      expect(shift1!.workSeconds).toBe(2400)
      expect(shift1!.breaks).toHaveLength(1)
      expect(shift1!.breaks[0]).toEqual({
        startedAt: makeDate('2026-11-19T18:20:00+02:00'),
        endedAt: makeDate('2026-11-19T18:40:00+02:00'),
      })

      // Shift 2 starts at 19:30, ends at 20:00, 1800 s work
      expect(shift2!.startedAt).toEqual(makeDate('2026-11-19T19:30:00+02:00'))
      expect(shift2!.endedAt).toEqual(makeDate('2026-11-19T20:00:00+02:00'))
      expect(shift2!.workSeconds).toBe(1800)
      expect(shift2!.breaks).toHaveLength(0)
    })

    test('shiftBreakMinutes 0 ends the shift on any Offline with no job', () => {
      // 18:00 Online -> 18:20 Offline -> 18:25 Online
      const statusChanges: StatusChangeRow[] = [
        {
          id: 'sc-1',
          createdAt: makeDate('2026-11-19T18:00:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-2',
          createdAt: makeDate('2026-11-19T18:20:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-3',
          createdAt: makeDate('2026-11-19T18:25:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-4',
          createdAt: makeDate('2026-11-19T19:00:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ]

      const input = createInput({
        statusChanges,
        shiftBreakMinutes: 0,
        now: makeDate('2026-11-19T20:00:00+02:00'),
      })

      const result = buildWorkedShifts(input)

      expect(result.shifts).toHaveLength(2)
      expect(result.shifts[0]!.endedAt).toEqual(makeDate('2026-11-19T18:20:00+02:00'))
      expect(result.shifts[1]!.startedAt).toEqual(makeDate('2026-11-19T18:25:00+02:00'))
    })

    test('Offline while holding a job keeps the shift until the drop off', () => {
      // Online 18:00, accept 18:10, Offline 18:15, dropoff 18:45
      const statusChanges: StatusChangeRow[] = [
        {
          id: 'sc-1',
          createdAt: makeDate('2026-11-19T18:00:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-2',
          createdAt: makeDate('2026-11-19T18:15:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ]

      const events: JobEventRow[] = [
        {
          id: 'ev-1',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-19T18:10:00+02:00'),
          createdAt: makeDate('2026-11-19T18:10:00+02:00'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
          courierId,
          occurredAt: makeDate('2026-11-19T18:45:00+02:00'),
          createdAt: makeDate('2026-11-19T18:45:00+02:00'),
        },
      ]

      const deliveries: JobDeliveryRow[] = [
        {
          id: 'del-1',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Restaurant',
        },
      ]

      const input = createInput({
        statusChanges,
        events,
        deliveries,
        deliveriesWithAnyJob: new Set(['del-1']),
        now: makeDate('2026-11-19T20:00:00+02:00'),
      })

      const result = buildWorkedShifts(input)

      expect(result.shifts).toHaveLength(1)
      const shift = result.shifts[0]!
      // Shift started at 18:00, stayed alive until job ended at 18:45
      expect(shift.startedAt).toEqual(makeDate('2026-11-19T18:00:00+02:00'))
      expect(shift.endedAt).toEqual(makeDate('2026-11-19T18:45:00+02:00'))
      expect(shift.workSeconds).toBe(2700) // 45 minutes
      expect(shift.jobSeconds).toBe(2100) // 18:10 to 18:45 = 35 minutes
      expect(shift.unpaidSeconds).toBe(600) // 18:00 to 18:10 = 10 minutes
    })
  })

  describe('Cancellations and Return Trips (AC-4)', () => {
    test('a CANCELED whose oldStatus is PICKED_UP or later runs to FOOD_RETURNED / FOOD_NOT_RETURNED', () => {
      const events: JobEventRow[] = [
        {
          id: 'ev-1',
          deliveryId: 'del-c1',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-19T18:00:00+02:00'),
          createdAt: makeDate('2026-11-19T18:00:00+02:00'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-c1',
          type: EnumDeliveryEventType.CANCELED,
          oldStatus: EnumDeliveryStatus.PICKED_UP,
          courierId,
          occurredAt: makeDate('2026-11-19T18:15:00+02:00'),
          createdAt: makeDate('2026-11-19T18:15:00+02:00'),
        },
        {
          id: 'ev-3',
          deliveryId: 'del-c1',
          type: EnumDeliveryEventType.FOOD_RETURNED,
          oldStatus: EnumDeliveryStatus.CANCELED,
          courierId,
          occurredAt: makeDate('2026-11-19T18:35:00+02:00'),
          createdAt: makeDate('2026-11-19T18:35:00+02:00'),
        },
      ]

      const deliveries: JobDeliveryRow[] = [
        {
          id: 'del-c1',
          status: EnumDeliveryStatus.CANCELED,
          courierId,
          totalCompensation: 0,
          tips: 0,
          pickupName: 'Restaurant',
        },
      ]

      const paired = pairJobs(courierId, events, deliveries, null)
      expect(paired).toHaveLength(1)
      expect(paired[0]!.start).toBe(makeDate('2026-11-19T18:00:00+02:00').getTime())
      expect(paired[0]!.end).toBe(makeDate('2026-11-19T18:35:00+02:00').getTime())
      expect(paired[0]!.endEventType).toBe(EnumDeliveryEventType.FOOD_RETURNED)
    })

    test('a cancel before pickup ends the job at the cancel', () => {
      const events: JobEventRow[] = [
        {
          id: 'ev-1',
          deliveryId: 'del-c2',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-19T18:00:00+02:00'),
          createdAt: makeDate('2026-11-19T18:00:00+02:00'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-c2',
          type: EnumDeliveryEventType.CANCELED,
          oldStatus: EnumDeliveryStatus.DISPATCHED, // before pickup
          courierId,
          occurredAt: makeDate('2026-11-19T18:10:00+02:00'),
          createdAt: makeDate('2026-11-19T18:10:00+02:00'),
        },
      ]

      const deliveries: JobDeliveryRow[] = [
        {
          id: 'del-c2',
          status: EnumDeliveryStatus.CANCELED,
          courierId,
          totalCompensation: 0,
          tips: 0,
          pickupName: 'Restaurant',
        },
      ]

      const paired = pairJobs(courierId, events, deliveries, null)
      expect(paired).toHaveLength(1)
      expect(paired[0]!.start).toBe(makeDate('2026-11-19T18:00:00+02:00').getTime())
      expect(paired[0]!.end).toBe(makeDate('2026-11-19T18:10:00+02:00').getTime())
      expect(paired[0]!.endEventType).toBe(EnumDeliveryEventType.CANCELED)
    })
  })

  describe('Overlapping jobs and paid waiting caps (AC-5)', () => {
    test('two overlapping jobs count once and paid waiting is capped at the job length and shift job time, nothing negative', () => {
      // Shift from 18:00 to 19:00 (3600s)
      const statusChanges: StatusChangeRow[] = [
        {
          id: 'sc-1',
          createdAt: makeDate('2026-11-19T18:00:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-2',
          createdAt: makeDate('2026-11-19T19:00:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ]

      // Job 1: 18:10 to 18:40 (30 min = 1800 s)
      // Job 2: 18:20 to 18:50 (30 min = 1800 s)
      // Overlap: 18:10 to 18:50 = 40 min = 2400 s union
      const events: JobEventRow[] = [
        {
          id: 'ev-1',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-19T18:10:00+02:00'),
          createdAt: makeDate('2026-11-19T18:10:00+02:00'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
          courierId,
          occurredAt: makeDate('2026-11-19T18:40:00+02:00'),
          createdAt: makeDate('2026-11-19T18:40:00+02:00'),
        },
        {
          id: 'ev-3',
          deliveryId: 'del-2',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-19T18:20:00+02:00'),
          createdAt: makeDate('2026-11-19T18:20:00+02:00'),
        },
        {
          id: 'ev-4',
          deliveryId: 'del-2',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
          courierId,
          occurredAt: makeDate('2026-11-19T18:50:00+02:00'),
          createdAt: makeDate('2026-11-19T18:50:00+02:00'),
        },
      ]

      const deliveries: JobDeliveryRow[] = [
        {
          id: 'del-1',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Store 1',
        },
        {
          id: 'del-2',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Store 2',
        },
      ]

      // Wait on del-1 claims 40 minutes (2400 s), but job 1 length is 1800 s, so capped at 1800 s
      // Wait on del-2 claims 20 minutes (1200 s). Together 1800 + 1200 = 3000 s > jobUnion 2400 s.
      // So total paidWaitSeconds must be capped at 2400 s!
      const compensations: CompensationRow[] = [
        {
          id: 'comp-1',
          deliveryId: 'del-1',
          amount: 500,
          currencyCode: 'EUR',
          reason: EnumCourierCompensationReason.WAITING,
          waitMinutes: 40,
          createdAt: makeDate('2026-11-19T18:30:00+02:00'),
        },
        {
          id: 'comp-2',
          deliveryId: 'del-2',
          amount: 300,
          currencyCode: 'EUR',
          reason: EnumCourierCompensationReason.WAITING,
          waitMinutes: 20,
          createdAt: makeDate('2026-11-19T18:40:00+02:00'),
        },
      ]

      const input = createInput({
        statusChanges,
        events,
        deliveries,
        compensations,
        deliveriesWithAnyJob: new Set(['del-1', 'del-2']),
        now: makeDate('2026-11-19T20:00:00+02:00'),
      })

      const result = buildWorkedShifts(input)

      expect(result.shifts).toHaveLength(1)
      const shift = result.shifts[0]!
      expect(shift.workSeconds).toBe(3600)
      // jobUnion is 2400 s. Paid wait is capped at 2400 s.
      expect(shift.paidWaitSeconds).toBe(2400)
      expect(shift.jobSeconds).toBe(0) // 2400 - 2400 = 0, never negative!
      expect(shift.unpaidSeconds).toBe(1200) // 3600 - 2400 = 1200
      expect(shift.workSeconds).toBe(shift.jobSeconds + shift.paidWaitSeconds + shift.unpaidSeconds)
    })
  })

  describe('Edge cases: clamping, hand-back, late additions (AC-4, AC-6)', () => {
    test('a drop off whose occurredAt is before its accept is clamped', () => {
      const events: JobEventRow[] = [
        {
          id: 'ev-1',
          deliveryId: 'del-clamp',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-19T18:10:00+02:00'),
          createdAt: makeDate('2026-11-19T18:10:00+02:00'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-clamp',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
          courierId,
          occurredAt: makeDate('2026-11-19T18:05:00+02:00'), // 5 minutes before accept!
          createdAt: makeDate('2026-11-19T18:12:00+02:00'),
        },
      ]

      const deliveries: JobDeliveryRow[] = [
        {
          id: 'del-clamp',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 400,
          tips: 0,
          pickupName: 'Restaurant',
        },
      ]

      const paired = pairJobs(courierId, events, deliveries, null)
      expect(paired).toHaveLength(1)
      expect(paired[0]!.start).toBe(makeDate('2026-11-19T18:10:00+02:00').getTime())
      // Clamped to accept time
      expect(paired[0]!.end).toBe(makeDate('2026-11-19T18:10:00+02:00').getTime())
    })

    test('a delivery handed back and accepted again by the same rider gets its compensation on the right job', () => {
      // Delivery del-hb: accepted at 18:00, handed back at 18:15. Accepted again at 18:30, dropped off at 19:00.
      const statusChanges: StatusChangeRow[] = [
        {
          id: 'sc-1',
          createdAt: makeDate('2026-11-19T17:50:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-2',
          createdAt: makeDate('2026-11-19T19:10:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ]

      const events: JobEventRow[] = [
        {
          id: 'ev-1',
          deliveryId: 'del-hb',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-19T18:00:00+02:00'),
          createdAt: makeDate('2026-11-19T18:00:00+02:00'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-hb',
          type: EnumDeliveryEventType.HANDED_BACK,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          courierId,
          occurredAt: makeDate('2026-11-19T18:15:00+02:00'),
          createdAt: makeDate('2026-11-19T18:15:00+02:00'),
        },
        {
          id: 'ev-3',
          deliveryId: 'del-hb',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-19T18:30:00+02:00'),
          createdAt: makeDate('2026-11-19T18:30:00+02:00'),
        },
        {
          id: 'ev-4',
          deliveryId: 'del-hb',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
          courierId,
          occurredAt: makeDate('2026-11-19T19:00:00+02:00'),
          createdAt: makeDate('2026-11-19T19:00:00+02:00'),
        },
      ]

      const deliveries: JobDeliveryRow[] = [
        {
          id: 'del-hb',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Restaurant',
        },
      ]

      const compensations: CompensationRow[] = [
        // c-early: written at 17:55 before any accept -> belongs to earliest job (Job 1)
        {
          id: 'c-early',
          deliveryId: 'del-hb',
          amount: 50,
          currencyCode: 'EUR',
          reason: EnumCourierCompensationReason.CANCELLATION,
          waitMinutes: null,
          createdAt: makeDate('2026-11-19T17:55:00+02:00'),
        },
        // c-mid: written at 18:20 (after 1st accept 18:00, before 2nd 18:30) -> belongs to Job 1
        {
          id: 'c-mid',
          deliveryId: 'del-hb',
          amount: 100,
          currencyCode: 'EUR',
          reason: EnumCourierCompensationReason.CANCELLATION,
          waitMinutes: null,
          createdAt: makeDate('2026-11-19T18:20:00+02:00'),
        },
        // c-late: written at 18:40 (after 2nd accept 18:30) -> belongs to Job 2
        {
          id: 'c-late',
          deliveryId: 'del-hb',
          amount: 200,
          currencyCode: 'EUR',
          reason: EnumCourierCompensationReason.CANCELLATION,
          waitMinutes: null,
          createdAt: makeDate('2026-11-19T18:40:00+02:00'),
        },
      ]

      const input = createInput({
        statusChanges,
        events,
        deliveries,
        compensations,
        deliveriesWithAnyJob: new Set(['del-hb']),
        now: makeDate('2026-11-19T20:00:00+02:00'),
      })

      const result = buildWorkedShifts(input)
      const shift = result.shifts[0]!
      expect(shift.jobs).toHaveLength(2)
      const [job1, job2] = shift.jobs
      expect(job1!.acceptedAt).toEqual(makeDate('2026-11-19T18:00:00+02:00'))
      expect(job1!.compensations.map((c) => c.id)).toEqual(['c-early', 'c-mid'])

      expect(job2!.acceptedAt).toEqual(makeDate('2026-11-19T18:30:00+02:00'))
      expect(job2!.compensations.map((c) => c.id)).toEqual(['c-late'])
    })

    test('a correction written two days after the shift is in the old shift, addedLater true, inside moneyCents and lateMoneyCents', () => {
      // Shift on 2026-11-17 18:00 to 19:00
      const statusChanges: StatusChangeRow[] = [
        {
          id: 'sc-1',
          createdAt: makeDate('2026-11-17T18:00:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-2',
          createdAt: makeDate('2026-11-17T19:00:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ]

      const events: JobEventRow[] = [
        {
          id: 'ev-1',
          deliveryId: 'del-rev',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-17T18:10:00+02:00'),
          createdAt: makeDate('2026-11-17T18:10:00+02:00'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-rev',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
          courierId,
          occurredAt: makeDate('2026-11-17T18:40:00+02:00'),
          createdAt: makeDate('2026-11-17T18:40:00+02:00'),
        },
      ]

      const deliveries: JobDeliveryRow[] = [
        {
          id: 'del-rev',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Restaurant',
        },
      ]

      // Review correction compensation written 2 days later: 2026-11-19
      const compensations: CompensationRow[] = [
        {
          id: 'comp-rev-1',
          deliveryId: 'del-rev',
          amount: 300,
          currencyCode: 'EUR',
          reason: EnumCourierCompensationReason.REVIEW,
          waitMinutes: null,
          createdAt: makeDate('2026-11-19T10:00:00+02:00'),
        },
      ]

      const input = createInput({
        windowStart: makeDate('2026-11-17T00:00:00+02:00'),
        windowEnd: makeDate('2026-11-20T00:00:00+02:00'),
        rangeStart: makeDate('2026-11-17T00:00:00+02:00'),
        rangeEnd: makeDate('2026-11-20T00:00:00+02:00'),
        statusChanges,
        events,
        deliveries,
        compensations,
        deliveriesWithAnyJob: new Set(['del-rev']),
        now: makeDate('2026-11-20T12:00:00+02:00'),
      })

      const result = buildWorkedShifts(input)
      expect(result.shifts).toHaveLength(1)
      const shift = result.shifts[0]!
      expect(shift.moneyCents).toBe(800) // 500 delivery + 300 correction
      expect(shift.lateMoneyCents).toBe(300)
      expect(shift.jobs[0]!.compensations[0]!.addedLater).toBe(true)
      expect(shift.jobs[0]!.compensations[0]!.amountCents).toBe(300)
    })
  })

  describe('Midnight crossing and day totals (AC-7, decision 36.36, 36.40)', () => {
    test('a shift 22:00 to 01:00 Europe/Athens is one shift with day totals 7200 and 3600', () => {
      // 22:00 on Nov 19 to 01:00 on Nov 20 Athens time
      const statusChanges: StatusChangeRow[] = [
        {
          id: 'sc-1',
          createdAt: makeDate('2026-11-19T22:00:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-2',
          createdAt: makeDate('2026-11-20T01:00:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ]

      const input = createInput({
        windowStart: makeDate('2026-11-19T00:00:00+02:00'),
        windowEnd: makeDate('2026-11-21T00:00:00+02:00'),
        rangeStart: makeDate('2026-11-19T00:00:00+02:00'),
        rangeEnd: makeDate('2026-11-21T00:00:00+02:00'),
        statusChanges,
        now: makeDate('2026-11-20T12:00:00+02:00'),
      })

      const result = buildWorkedShifts(input)

      // One shift overall
      expect(result.shifts).toHaveLength(1)
      expect(result.shifts[0]!.workSeconds).toBe(10800) // 3 hours

      // Day totals: Nov 19 has 2 hours (7200 s), Nov 20 has 1 hour (3600 s)
      expect(result.days).toHaveLength(2)
      const day1 = result.days.find((d) => d.date === '2026-11-19')!
      const day2 = result.days.find((d) => d.date === '2026-11-20')!
      expect(day1.workSeconds).toBe(7200)
      expect(day2.workSeconds).toBe(3600)
    })

    test('a compensation for a delivery the rider never accepted with a recorded rider counts on the day written as unlinkedMoneyCents and not in centsPerHour (36.36)', () => {
      // Rider was Online on Nov 19 for 1 hour (3600 s)
      const statusChanges: StatusChangeRow[] = [
        {
          id: 'sc-1',
          createdAt: makeDate('2026-11-19T10:00:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-2',
          createdAt: makeDate('2026-11-19T11:00:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ]

      // Compensation for del-unlinked written on Nov 19. Rider never accepted del-unlinked (not in deliveriesWithAnyJob).
      const compensations: CompensationRow[] = [
        {
          id: 'comp-unlinked-1',
          deliveryId: 'del-unlinked',
          amount: 400,
          currencyCode: 'EUR',
          reason: EnumCourierCompensationReason.CANCELLATION,
          waitMinutes: null,
          createdAt: makeDate('2026-11-19T10:30:00+02:00'),
        },
      ]

      const input = createInput({
        statusChanges,
        compensations,
        deliveriesWithAnyJob: new Set(), // not in set -> unlinked
        now: makeDate('2026-11-19T20:00:00+02:00'),
      })

      const result = buildWorkedShifts(input)
      const day = result.days.find((d) => d.date === '2026-11-19')!
      expect(day.unlinkedMoneyCents).toBe(400)
      // moneyCents includes unlinkedMoneyCents (36.36)
      expect(day.moneyCents).toBe(400)
      // centsPerHour leaves out unlinkedMoneyCents -> linked money is 0 -> 0 cents/hour
      expect(day.centsPerHour).toBe(0)

      // Shift itself never holds unlinked money (36.36)
      expect(result.shifts[0]!.moneyCents).toBe(0)
    })
  })

  describe('Other currency compensations (AC-6)', () => {
    test('a compensation in another currency is left out and its id returned in otherCurrencyCompensationIds', () => {
      const compensations: CompensationRow[] = [
        {
          id: 'comp-usd-1',
          deliveryId: 'del-1',
          amount: 500,
          currencyCode: 'USD', // not EUR!
          reason: EnumCourierCompensationReason.WAITING,
          waitMinutes: 10,
          createdAt: makeDate('2026-11-19T18:20:00+02:00'),
        },
      ]

      const input = createInput({
        compensations,
        now: makeDate('2026-11-19T20:00:00+02:00'),
      })

      const result = buildWorkedShifts(input)
      expect(result.otherCurrencyCompensationIds).toEqual(['comp-usd-1'])
    })
  })

  describe('Open shifts and shifts on break (AC-4, AC-10)', () => {
    test('an open shift has endedAt null; a shift on break has onBreakSince set until gap reaches limit, then endedAt', () => {
      const now = makeDate('2026-11-19T19:00:00+02:00')

      // Case 1: Online right now -> open shift, endedAt null, onBreakSince null
      const inputOpen = createInput({
        windowEnd: now,
        now,
        statusChanges: [
          {
            id: 'sc-1',
            createdAt: makeDate('2026-11-19T18:00:00+02:00'),
            fromStatus: EnumCourierStatus.OFFLINE,
            toStatus: EnumCourierStatus.ONLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
        ],
      })
      const resultOpen = buildWorkedShifts(inputOpen)
      expect(resultOpen.shifts[0]!.endedAt).toBeNull()
      expect(resultOpen.shifts[0]!.onBreakSince).toBeNull()

      // Case 2: Went Offline 15 minutes ago (18:45) with break limit 30m -> on break!
      const inputBreak = createInput({
        windowEnd: now,
        now,
        shiftBreakMinutes: 30,
        statusChanges: [
          {
            id: 'sc-1',
            createdAt: makeDate('2026-11-19T18:00:00+02:00'),
            fromStatus: EnumCourierStatus.OFFLINE,
            toStatus: EnumCourierStatus.ONLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
          {
            id: 'sc-2',
            createdAt: makeDate('2026-11-19T18:45:00+02:00'),
            fromStatus: EnumCourierStatus.ONLINE,
            toStatus: EnumCourierStatus.OFFLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
        ],
      })
      const resultBreak = buildWorkedShifts(inputBreak)
      expect(resultBreak.shifts[0]!.endedAt).toBeNull()
      expect(resultBreak.shifts[0]!.onBreakSince).toEqual(makeDate('2026-11-19T18:45:00+02:00'))

      // Case 3: Went Offline 40 minutes ago (18:20) with break limit 30m -> ended!
      const inputEnded = createInput({
        windowEnd: now,
        now,
        shiftBreakMinutes: 30,
        statusChanges: [
          {
            id: 'sc-1',
            createdAt: makeDate('2026-11-19T18:00:00+02:00'),
            fromStatus: EnumCourierStatus.OFFLINE,
            toStatus: EnumCourierStatus.ONLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
          {
            id: 'sc-2',
            createdAt: makeDate('2026-11-19T18:20:00+02:00'),
            fromStatus: EnumCourierStatus.ONLINE,
            toStatus: EnumCourierStatus.OFFLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
        ],
      })
      const resultEnded = buildWorkedShifts(inputEnded)
      expect(resultEnded.shifts[0]!.endedAt).toEqual(makeDate('2026-11-19T18:20:00+02:00'))
      expect(resultEnded.shifts[0]!.onBreakSince).toBeNull()
    })
  })

  describe('Window boundary conditions and recordedFrom (AC-4, AC-11)', () => {
    test('a shift begun before windowStart is startedBeforeRange', () => {
      const windowStart = makeDate('2026-11-19T06:00:00+02:00')
      const input = createInput({
        windowStart,
        statusAtWindowStart: EnumCourierStatus.ONLINE, // was already Online before windowStart
        statusChanges: [
          {
            id: 'sc-1',
            createdAt: makeDate('2026-11-19T10:00:00+02:00'),
            fromStatus: EnumCourierStatus.ONLINE,
            toStatus: EnumCourierStatus.OFFLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
        ],
        now: makeDate('2026-11-19T12:00:00+02:00'),
      })

      const result = buildWorkedShifts(input)
      expect(result.shifts[0]!.startedBeforeRange).toBe(true)
    })

    test('a job still ongoing with this rider runs to now, one whose delivery left the rider with no end event ends at the delivery last event', () => {
      const now = makeDate('2026-11-19T19:00:00+02:00')

      // Delivery ongoing: delivery.status is ONGOING, delivery.courierId is this rider
      const eventsOngoing: JobEventRow[] = [
        {
          id: 'ev-1',
          deliveryId: 'del-ong',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-19T18:00:00+02:00'),
          createdAt: makeDate('2026-11-19T18:00:00+02:00'),
        },
      ]
      const deliveriesOngoing: JobDeliveryRow[] = [
        {
          id: 'del-ong',
          status: EnumDeliveryStatus.DISPATCHED,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Restaurant',
        },
      ]

      const pairedOngoing = pairJobs(courierId, eventsOngoing, deliveriesOngoing, null)
      expect(pairedOngoing[0]!.end).toBeNull() // ongoing!

      // Delivery left rider with no end event: status is DROPPED_OFF by another rider, last event was at 18:30
      const eventsLeft: JobEventRow[] = [
        {
          id: 'ev-10',
          deliveryId: 'del-left',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-19T18:00:00+02:00'),
          createdAt: makeDate('2026-11-19T18:00:00+02:00'),
        },
        {
          id: 'ev-11',
          deliveryId: 'del-left',
          type: EnumDeliveryEventType.PRODUCT_REPORTED,
          oldStatus: EnumDeliveryStatus.DISPATCHED,
          courierId: 'other-rider',
          occurredAt: makeDate('2026-11-19T18:30:00+02:00'),
          createdAt: makeDate('2026-11-19T18:30:00+02:00'),
        },
      ]
      const deliveriesLeft: JobDeliveryRow[] = [
        {
          id: 'del-left',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId: 'other-rider',
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Restaurant',
        },
      ]

      const pairedLeft = pairJobs(courierId, eventsLeft, deliveriesLeft, null)
      expect(pairedLeft[0]!.end).toBe(makeDate('2026-11-19T18:30:00+02:00').getTime())
    })

    test('no job starts before recordedFrom', () => {
      const recordedFrom = makeDate('2026-11-19T18:00:00+02:00')

      // Job started at 17:30, ended at 18:30 -> clamped start to 18:00
      const events: JobEventRow[] = [
        {
          id: 'ev-1',
          deliveryId: 'del-clamp-start',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-19T17:30:00+02:00'),
          createdAt: makeDate('2026-11-19T17:30:00+02:00'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-clamp-start',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
          courierId,
          occurredAt: makeDate('2026-11-19T18:30:00+02:00'),
          createdAt: makeDate('2026-11-19T18:30:00+02:00'),
        },
      ]

      const deliveries: JobDeliveryRow[] = [
        {
          id: 'del-clamp-start',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Restaurant',
        },
      ]

      const paired = pairJobs(courierId, events, deliveries, recordedFrom)
      expect(paired).toHaveLength(1)
      expect(paired[0]!.deliveryId).toBe('del-clamp-start')
      expect(paired[0]!.start).toBe(recordedFrom.getTime())
      for (const j of paired) {
        expect(j.start).toBeGreaterThanOrEqual(recordedFrom.getTime())
      }
    })

    test('centsPerHour is null under 60 s of work (AC-6)', () => {
      expect(centsPerHour(1000, 59)).toBeNull()
      expect(centsPerHour(1000, 60)).toBe(60000)
    })
  })

  describe('Property-style test: workSeconds = jobSeconds + paidWaitSeconds + unpaidSeconds for every shift and every day, and none negative', () => {
    test('invariants hold across multiple configurations and overlapping schedules', () => {
      const fixtures: WorkedShiftsInput[] = [
        // Fixture A: simple shift with 1 job and waiting
        createInput({
          statusChanges: [
            {
              id: 'sc-1',
              createdAt: makeDate('2026-11-19T08:00:00+02:00'),
              fromStatus: EnumCourierStatus.OFFLINE,
              toStatus: EnumCourierStatus.ONLINE,
              cause: EnumCourierStatusChangeCause.RIDER,
              adminUserId: null,
            },
            {
              id: 'sc-2',
              createdAt: makeDate('2026-11-19T12:00:00+02:00'),
              fromStatus: EnumCourierStatus.ONLINE,
              toStatus: EnumCourierStatus.OFFLINE,
              cause: EnumCourierStatusChangeCause.RIDER,
              adminUserId: null,
            },
          ],
          events: [
            {
              id: 'ev-1',
              deliveryId: 'del-prop-1',
              type: EnumDeliveryEventType.ACCEPTED,
              oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
              courierId,
              occurredAt: makeDate('2026-11-19T09:00:00+02:00'),
              createdAt: makeDate('2026-11-19T09:00:00+02:00'),
            },
            {
              id: 'ev-2',
              deliveryId: 'del-prop-1',
              type: EnumDeliveryEventType.DROPPED_OFF,
              oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
              courierId,
              occurredAt: makeDate('2026-11-19T10:30:00+02:00'),
              createdAt: makeDate('2026-11-19T10:30:00+02:00'),
            },
          ],
          deliveries: [
            {
              id: 'del-prop-1',
              status: EnumDeliveryStatus.DROPPED_OFF,
              courierId,
              totalCompensation: 800,
              tips: 100,
              pickupName: 'Prop Deli',
            },
          ],
          compensations: [
            {
              id: 'comp-p1',
              deliveryId: 'del-prop-1',
              amount: 200,
              currencyCode: 'EUR',
              reason: EnumCourierCompensationReason.WAITING,
              waitMinutes: 15,
              createdAt: makeDate('2026-11-19T09:45:00+02:00'),
            },
          ],
          deliveriesWithAnyJob: new Set(['del-prop-1']),
          now: makeDate('2026-11-19T15:00:00+02:00'),
        }),
        // Fixture B: multi-day shift crossing midnight with multiple breaks and 3 overlapping jobs
        createInput({
          windowStart: makeDate('2026-11-19T00:00:00+02:00'),
          windowEnd: makeDate('2026-11-21T00:00:00+02:00'),
          rangeStart: makeDate('2026-11-19T00:00:00+02:00'),
          rangeEnd: makeDate('2026-11-21T00:00:00+02:00'),
          statusChanges: [
            {
              id: 'sc-1',
              createdAt: makeDate('2026-11-19T20:00:00+02:00'),
              fromStatus: EnumCourierStatus.OFFLINE,
              toStatus: EnumCourierStatus.ONLINE,
              cause: EnumCourierStatusChangeCause.RIDER,
              adminUserId: null,
            },
            {
              id: 'sc-2',
              createdAt: makeDate('2026-11-19T21:00:00+02:00'),
              fromStatus: EnumCourierStatus.ONLINE,
              toStatus: EnumCourierStatus.OFFLINE,
              cause: EnumCourierStatusChangeCause.RIDER,
              adminUserId: null,
            },
            {
              id: 'sc-3',
              createdAt: makeDate('2026-11-19T21:15:00+02:00'), // 15m break
              fromStatus: EnumCourierStatus.OFFLINE,
              toStatus: EnumCourierStatus.ONLINE,
              cause: EnumCourierStatusChangeCause.RIDER,
              adminUserId: null,
            },
            {
              id: 'sc-4',
              createdAt: makeDate('2026-11-20T03:00:00+02:00'),
              fromStatus: EnumCourierStatus.ONLINE,
              toStatus: EnumCourierStatus.OFFLINE,
              cause: EnumCourierStatusChangeCause.RIDER,
              adminUserId: null,
            },
          ],
          events: [
            {
              id: 'ev-1',
              deliveryId: 'del-o1',
              type: EnumDeliveryEventType.ACCEPTED,
              oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
              courierId,
              occurredAt: makeDate('2026-11-19T22:00:00+02:00'),
              createdAt: makeDate('2026-11-19T22:00:00+02:00'),
            },
            {
              id: 'ev-2',
              deliveryId: 'del-o1',
              type: EnumDeliveryEventType.DROPPED_OFF,
              oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
              courierId,
              occurredAt: makeDate('2026-11-20T00:30:00+02:00'),
              createdAt: makeDate('2026-11-20T00:30:00+02:00'),
            },
            {
              id: 'ev-3',
              deliveryId: 'del-o2',
              type: EnumDeliveryEventType.ACCEPTED,
              oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
              courierId,
              occurredAt: makeDate('2026-11-19T23:30:00+02:00'),
              createdAt: makeDate('2026-11-19T23:30:00+02:00'),
            },
            {
              id: 'ev-4',
              deliveryId: 'del-o2',
              type: EnumDeliveryEventType.DROPPED_OFF,
              oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
              courierId,
              occurredAt: makeDate('2026-11-20T01:00:00+02:00'),
              createdAt: makeDate('2026-11-20T01:00:00+02:00'),
            },
          ],
          deliveries: [
            {
              id: 'del-o1',
              status: EnumDeliveryStatus.DROPPED_OFF,
              courierId,
              totalCompensation: 600,
              tips: 50,
              pickupName: 'Restaurant 1',
            },
            {
              id: 'del-o2',
              status: EnumDeliveryStatus.DROPPED_OFF,
              courierId,
              totalCompensation: 700,
              tips: 0,
              pickupName: 'Restaurant 2',
            },
          ],
          compensations: [
            {
              id: 'comp-o1',
              deliveryId: 'del-o1',
              amount: 150,
              currencyCode: 'EUR',
              reason: EnumCourierCompensationReason.WAITING,
              waitMinutes: 20,
              createdAt: makeDate('2026-11-19T22:30:00+02:00'),
            },
          ],
          deliveriesWithAnyJob: new Set(['del-o1', 'del-o2']),
          now: makeDate('2026-11-20T10:00:00+02:00'),
        }),
      ]

      for (const fixture of fixtures) {
        const result = buildWorkedShifts(fixture)

        for (const shift of result.shifts) {
          expect(shift.workSeconds).toBeGreaterThanOrEqual(0)
          expect(shift.jobSeconds).toBeGreaterThanOrEqual(0)
          expect(shift.paidWaitSeconds).toBeGreaterThanOrEqual(0)
          expect(shift.unpaidSeconds).toBeGreaterThanOrEqual(0)
          expect(shift.workSeconds).toBe(shift.jobSeconds + shift.paidWaitSeconds + shift.unpaidSeconds)
        }

        for (const day of result.days) {
          expect(day.workSeconds).toBeGreaterThanOrEqual(0)
          expect(day.jobSeconds).toBeGreaterThanOrEqual(0)
          expect(day.paidWaitSeconds).toBeGreaterThanOrEqual(0)
          expect(day.unpaidSeconds).toBeGreaterThanOrEqual(0)
          expect(day.workSeconds).toBe(day.jobSeconds + day.paidWaitSeconds + day.unpaidSeconds)
        }
      }
    })
  })
})
