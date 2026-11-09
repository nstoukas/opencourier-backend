import { EnumDeliveryEventType } from '@prisma/types'
import {
  DEFAULT_WAIT_RECORD_DAYS,
  WAIT_RECORD_DAYS,
  WaitRecordDelivery,
  waitMinutesOf,
  waitRecordOf,
} from './wait-record'

// Spec 0030: restaurant wait record calculations (AC-3, AC-4, AC-5, AC-6).
describe('wait-record domain logic (spec 0030)', () => {
  const BASE_TIME = new Date('2026-11-09T10:00:00.000Z')
  const at = (minutesOffset: number) => new Date(BASE_TIME.getTime() + minutesOffset * 60_000)

  describe('constants (AC-1)', () => {
    test('WAIT_RECORD_DAYS includes exactly 7, 30, 90 days', () => {
      expect(WAIT_RECORD_DAYS).toEqual([7, 30, 90])
    })

    test('DEFAULT_WAIT_RECORD_DAYS is 30', () => {
      expect(DEFAULT_WAIT_RECORD_DAYS).toBe(30)
    })
  })

  describe('waitMinutesOf (AC-3)', () => {
    test('returns null when delivery has no readyAt', () => {
      const delivery: WaitRecordDelivery = {
        id: 'del-1',
        createdAt: at(0),
        readyAt: null,
        foodReadyAt: at(20),
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(15) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(25) },
        ],
      }
      expect(waitMinutesOf(delivery)).toBeNull()
    })

    test('returns null when delivery has no PICKED_UP event', () => {
      const delivery: WaitRecordDelivery = {
        id: 'del-2',
        createdAt: at(0),
        readyAt: at(20),
        foodReadyAt: at(20),
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(15) },
        ],
      }
      expect(waitMinutesOf(delivery)).toBeNull()
    })

    test('returns null when delivery has no ARRIVED_AT_PICKUP_LOCATION event', () => {
      const delivery: WaitRecordDelivery = {
        id: 'del-3',
        createdAt: at(0),
        readyAt: at(20),
        foodReadyAt: at(20),
        events: [
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(25) },
        ],
      }
      expect(waitMinutesOf(delivery)).toBeNull()
    })

    test('when rider arrives before readyAt, wait is measured from readyAt (early rider does not count against restaurant)', () => {
      // Arrived at +10 min, readyAt at +20 min, picked up at +25 min.
      // Wait should be 25 - 20 = 5 minutes, NOT 25 - 10 = 15 minutes.
      const delivery: WaitRecordDelivery = {
        id: 'del-early-rider',
        createdAt: at(0),
        readyAt: at(20),
        foodReadyAt: at(20),
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(10) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(25) },
        ],
      }
      expect(waitMinutesOf(delivery)).toBe(5)
    })

    test('when rider arrives after readyAt, wait is measured from arrival', () => {
      // readyAt at +15 min, arrived at +20 min, picked up at +32 min.
      // Wait is 32 - 20 = 12 minutes.
      const delivery: WaitRecordDelivery = {
        id: 'del-late-rider',
        createdAt: at(0),
        readyAt: at(15),
        foodReadyAt: at(15),
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(20) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(32) },
        ],
      }
      expect(waitMinutesOf(delivery)).toBe(12)
    })

    test('wait is never below 0 even if pickup occurred before readyAt', () => {
      // readyAt at +20 min, arrived at +10 min, picked up at +18 min (e.g. food was ready early).
      // Wait is max(0, 18 - 20) = 0.
      const delivery: WaitRecordDelivery = {
        id: 'del-pickup-before-ready',
        createdAt: at(0),
        readyAt: at(20),
        foodReadyAt: at(15),
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(10) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(18) },
        ],
      }
      expect(waitMinutesOf(delivery)).toBe(0)
    })

    test('reassigned delivery with two arrivals and two pickups measures last pickup against last arrival at or before it', () => {
      // Rider 1 arrives at +10, pickup at +15, but then reassigned.
      // Rider 2 arrives at +25, pickup at +35. readyAt was +20.
      // The last pickup is +35. The last arrival at or before +35 is Rider 2 at +25.
      // Wait is 35 - max(25, 20) = 35 - 25 = 10 minutes.
      const delivery: WaitRecordDelivery = {
        id: 'del-reassigned',
        createdAt: at(0),
        readyAt: at(20),
        foodReadyAt: at(20),
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(10) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(15) },
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(25) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(35) },
        ],
      }
      expect(waitMinutesOf(delivery)).toBe(10)
    })

    test('ignores arrival event that occurred strictly after the last pickup', () => {
      // Last pickup at +25 min. readyAt at +15 min.
      // Valid arrival at +18 min.
      // Stray/late arrival event recorded at +30 min (after pickup).
      // Wait is 25 - max(18, 15) = 25 - 18 = 7 minutes.
      const delivery: WaitRecordDelivery = {
        id: 'del-stray-arrival',
        createdAt: at(0),
        readyAt: at(15),
        foodReadyAt: at(15),
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(18) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(25) },
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(30) },
        ],
      }
      expect(waitMinutesOf(delivery)).toBe(7)
    })
  })

  describe('waitRecordOf: wait statistics and order counting (AC-2, AC-3)', () => {
    test('delivery with no arrival event stays in orderCount but is excluded from waitSamples', () => {
      const delWithArrival: WaitRecordDelivery = {
        id: 'del-with-arrival',
        createdAt: at(0),
        readyAt: at(20),
        foodReadyAt: at(20),
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(20) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(30) },
        ],
      }
      const delWithoutArrival: WaitRecordDelivery = {
        id: 'del-no-arrival',
        createdAt: at(0),
        readyAt: at(20),
        foodReadyAt: at(20),
        events: [
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(30) },
        ],
      }

      const record = waitRecordOf([delWithArrival, delWithoutArrival], 15)
      expect(record.orderCount).toBe(2)
      expect(record.waitSamples).toBe(1)
      expect(record.averageWaitMinutes).toBe(10)
    })

    test('averageWaitMinutes is the mean rounded to one decimal place', () => {
      // 3 orders with waits: 4.1 min, 5.2 min, 6.4 min -> sum = 15.7 -> mean = 5.2333 -> 5.2
      const makeOrder = (id: string, waitMinutes: number): WaitRecordDelivery => ({
        id,
        createdAt: at(0),
        readyAt: at(10),
        foodReadyAt: at(10),
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(10) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: new Date(at(10).getTime() + waitMinutes * 60_000) },
        ],
      })

      const record = waitRecordOf(
        [makeOrder('d1', 4.1), makeOrder('d2', 5.2), makeOrder('d3', 6.4)],
        15
      )
      expect(record.waitSamples).toBe(3)
      expect(record.averageWaitMinutes).toBe(5.2)
    })

    test('averageWaitMinutes is null when there are no wait samples', () => {
      const delWithoutArrival: WaitRecordDelivery = {
        id: 'del-1',
        createdAt: at(0),
        readyAt: at(20),
        foodReadyAt: null,
        events: [
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(30) },
        ],
      }
      const record = waitRecordOf([delWithoutArrival], 15)
      expect(record.orderCount).toBe(1)
      expect(record.waitSamples).toBe(0)
      expect(record.averageWaitMinutes).toBeNull()
    })
  })

  describe('waitRecordOf: late delivery share (AC-4)', () => {
    test('counts delivery as late if it has a READY_DELAYED event', () => {
      const delDelayed: WaitRecordDelivery = {
        id: 'del-delayed',
        createdAt: at(0),
        readyAt: at(25),
        foodReadyAt: at(20), // foodReadyAt <= readyAt, but marked delayed by restaurant
        events: [
          { type: EnumDeliveryEventType.READY_DELAYED, occurredAt: at(10) },
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(20) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(25) },
        ],
      }
      const record = waitRecordOf([delDelayed], 15)
      expect(record.lateShare).toBe(1)
    })

    test('counts delivery as late if foodReadyAt is strictly later than readyAt', () => {
      const delLateFood: WaitRecordDelivery = {
        id: 'del-late-food',
        createdAt: at(0),
        readyAt: at(20),
        foodReadyAt: new Date(at(20).getTime() + 1), // 1 millisecond late
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(20) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(25) },
        ],
      }
      const record = waitRecordOf([delLateFood], 15)
      expect(record.lateShare).toBe(1)
    })

    test('does NOT count delivery as late when foodReadyAt equals readyAt exactly', () => {
      const delOnTime: WaitRecordDelivery = {
        id: 'del-on-time',
        createdAt: at(0),
        readyAt: at(20),
        foodReadyAt: at(20),
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(20) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(25) },
        ],
      }
      const record = waitRecordOf([delOnTime], 15)
      expect(record.lateShare).toBe(0)
    })

    test('does NOT count delivery as late when foodReadyAt is earlier than readyAt', () => {
      const delEarly: WaitRecordDelivery = {
        id: 'del-early',
        createdAt: at(0),
        readyAt: at(20),
        foodReadyAt: at(15),
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(15) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(20) },
        ],
      }
      const record = waitRecordOf([delEarly], 15)
      expect(record.lateShare).toBe(0)
    })

    test('computes lateShare as fraction of late deliveries over orderCount', () => {
      // 1 on-time, 1 delayed event, 1 late foodReadyAt, 1 on-time without foodReadyAt
      const deliveries: WaitRecordDelivery[] = [
        {
          id: 'd1',
          createdAt: at(0),
          readyAt: at(20),
          foodReadyAt: at(20),
          events: [
            { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(20) },
            { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(25) },
          ],
        },
        {
          id: 'd2',
          createdAt: at(0),
          readyAt: at(20),
          foodReadyAt: null,
          events: [
            { type: EnumDeliveryEventType.READY_DELAYED, occurredAt: at(10) },
            { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(20) },
            { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(25) },
          ],
        },
        {
          id: 'd3',
          createdAt: at(0),
          readyAt: at(20),
          foodReadyAt: at(30), // late
          events: [
            { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(20) },
            { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(35) },
          ],
        },
        {
          id: 'd4',
          createdAt: at(0),
          readyAt: at(20),
          foodReadyAt: null,
          events: [
            { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(20) },
            { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(25) },
          ],
        },
      ]

      const record = waitRecordOf(deliveries, 20)
      expect(record.orderCount).toBe(4)
      expect(record.lateShare).toBe(0.5) // 2 / 4 = 0.5
    })

    test('lateShare is null when orderCount is 0', () => {
      const record = waitRecordOf([], 15)
      expect(record.orderCount).toBe(0)
      expect(record.lateShare).toBeNull()
    })
  })

  describe('waitRecordOf: real prep time and median calculation (AC-5)', () => {
    test('measures real prep time as foodReadyAt minus createdAt in minutes', () => {
      const deliveries: WaitRecordDelivery[] = [
        {
          id: 'd1',
          createdAt: at(0),
          readyAt: at(15),
          foodReadyAt: at(18), // prep = 18 min
          events: [
            { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(20) },
            { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(25) },
          ],
        },
        {
          id: 'd2',
          createdAt: at(0),
          readyAt: at(20),
          foodReadyAt: null, // no foodReadyAt, excluded from prep
          events: [
            { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(20) },
            { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(25) },
          ],
        },
      ]

      const record = waitRecordOf(deliveries, 15)
      expect(record.prepSamples).toBe(1)
      expect(record.medianPrepMinutes).toBe(18)
    })

    test('median with an odd count picks the exact middle value', () => {
      const makePrepOrder = (id: string, prepMin: number): WaitRecordDelivery => ({
        id,
        createdAt: at(0),
        readyAt: at(30),
        foodReadyAt: at(prepMin),
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(30) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(35) },
        ],
      })

      // preps: 12, 15, 30 -> median = 15
      const deliveries = [
        makePrepOrder('d1', 30),
        makePrepOrder('d2', 12),
        makePrepOrder('d3', 15),
      ]
      const record = waitRecordOf(deliveries, 15)
      expect(record.prepSamples).toBe(3)
      expect(record.medianPrepMinutes).toBe(15)
    })

    test('median with an even count computes the mean of the two middle values and rounds with Math.round', () => {
      const makePrepOrder = (id: string, prepMin: number): WaitRecordDelivery => ({
        id,
        createdAt: at(0),
        readyAt: at(30),
        foodReadyAt: at(prepMin),
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(30) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(35) },
        ],
      })

      // Case A: 10, 14, 18, 22 -> middle two: 14, 18 -> mean = 16
      const deliveriesA = [
        makePrepOrder('d1', 22),
        makePrepOrder('d2', 10),
        makePrepOrder('d3', 18),
        makePrepOrder('d4', 14),
      ]
      expect(waitRecordOf(deliveriesA, 15).medianPrepMinutes).toBe(16)

      // Case B: 10, 15 -> mean = 12.5 -> Math.round(12.5) = 13
      const deliveriesB = [
        makePrepOrder('d1', 10),
        makePrepOrder('d2', 15),
      ]
      expect(waitRecordOf(deliveriesB, 15).medianPrepMinutes).toBe(13)
    })

    test('medianPrepMinutes is null when there are no prep samples', () => {
      const delWithoutFoodReady: WaitRecordDelivery = {
        id: 'd1',
        createdAt: at(0),
        readyAt: at(20),
        foodReadyAt: null,
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(20) },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(25) },
        ],
      }
      const record = waitRecordOf([delWithoutFoodReady], 15)
      expect(record.prepSamples).toBe(0)
      expect(record.medianPrepMinutes).toBeNull()
    })
  })

  describe('waitRecordOf: privacy and rider field exclusion (AC-6, Value 5)', () => {
    test('carries usualPrepMinutes and contains no rider field in the result', () => {
      const record = waitRecordOf([], 25)
      expect(record.usualPrepMinutes).toBe(25)

      // Ensure no courier/rider property exists on the record
      const keys = Object.keys(record)
      expect(keys.some((k) => /courier|rider/i.test(k))).toBe(false)
      expect(record).toEqual({
        orderCount: 0,
        waitSamples: 0,
        averageWaitMinutes: null,
        lateShare: null,
        prepSamples: 0,
        medianPrepMinutes: null,
        usualPrepMinutes: 25,
      })
    })
  })
})
