import {
  MIN_KM_FOR_RATE,
  PeriodFigures,
  medianOf,
  summarisePeriod,
} from './period-figures'
import {
  EnumCourierCompensationReason,
  EnumDeliveryEventType,
} from '@prisma/types'
import {
  EnumJobEndLabel,
  MIN_SECONDS_FOR_RATE,
  WorkedDay,
  WorkedJob,
} from './worked-shifts'

describe('Period Figures (spec 0042 AC-1, AC-5, decision 75.34)', () => {
  function makeWorkedDay(overrides: Partial<WorkedDay> = {}): WorkedDay {
    return {
      date: '2026-11-20',
      workSeconds: 3600,
      jobSeconds: 2400,
      paidWaitSeconds: 600,
      unpaidSeconds: 600,
      moneyCents: 1500,
      unlinkedMoneyCents: 200,
      noJobMoneyCents: 100,
      centsPerHour: 1300,
      ...overrides,
    }
  }

  function makeWorkedJob(overrides: Partial<WorkedJob> = {}): WorkedJob {
    return {
      deliveryId: 'del-1',
      pickupName: 'Taverna Nosh',
      acceptedAt: new Date('2026-11-20T10:00:00.000Z'),
      endedAt: new Date('2026-11-20T10:30:00.000Z'),
      endEventType: EnumDeliveryEventType.DROPPED_OFF,
      droppedOff: true,
      deliveryMoneyCents: 500,
      paidWaitSeconds: 300,
      compensations: [],
      paidKm: 2.5,
      dropoffArea: 'Iasonos',
      pickupWaitSeconds: 120,
      cancelledAfterPickup: false,
      endLabel: null,
      ...overrides,
    }
  }

  describe('medianOf', () => {
    test('returns null for empty array', () => {
      expect(medianOf([])).toBeNull()
    })

    test('returns the middle element for odd count', () => {
      expect(medianOf([42])).toBe(42)
      expect(medianOf([100, 30, 70])).toBe(70) // sorted: [30, 70, 100] -> 70
      expect(medianOf([9, 1, 5, 3, 7])).toBe(5) // sorted: [1, 3, 5, 7, 9] -> 5
    })

    test('averages the two middle values rounded to whole seconds for even count', () => {
      // [10, 20] -> 15
      expect(medianOf([10, 20])).toBe(15)
      // [10, 21] -> (10 + 21) / 2 = 15.5 -> rounds to 16
      expect(medianOf([10, 21])).toBe(16)
      // [10, 22] -> 16
      expect(medianOf([10, 22])).toBe(16)
      // [100, 20, 80, 50] -> sorted [20, 50, 80, 100] -> (50 + 80) / 2 = 65
      expect(medianOf([100, 20, 80, 50])).toBe(65)
    })
  })

  describe('summarisePeriod', () => {
    test('sums time and money from days, computes rates from sums, and derives km, wait and dropoff metrics from jobs', () => {
      const days: WorkedDay[] = [
        makeWorkedDay({
          date: '2026-11-19',
          workSeconds: 7200,
          jobSeconds: 5000,
          paidWaitSeconds: 1000,
          unpaidSeconds: 1200,
          moneyCents: 3500,
          unlinkedMoneyCents: 500,
          noJobMoneyCents: 200,
        }),
        makeWorkedDay({
          date: '2026-11-20',
          workSeconds: 3600,
          jobSeconds: 2000,
          paidWaitSeconds: 600,
          unpaidSeconds: 1000,
          moneyCents: 2500,
          unlinkedMoneyCents: 200,
          noJobMoneyCents: 100,
        }),
      ]

      const jobs: WorkedJob[] = [
        makeWorkedJob({
          deliveryId: 'del-1',
          droppedOff: true,
          deliveryMoneyCents: 600,
          compensations: [
            {
              id: 'comp-1',
              reason: EnumCourierCompensationReason.WAITING,
              amountCents: 150,
              waitMinutes: 10,
              createdAt: new Date('2026-11-19T10:30:00Z'),
              addedLater: false,
            },
          ],
          paidKm: 3.0,
          pickupWaitSeconds: 90,
        }),
        makeWorkedJob({
          deliveryId: 'del-2',
          droppedOff: true,
          deliveryMoneyCents: 800,
          compensations: [],
          paidKm: 2.0,
          pickupWaitSeconds: 150,
        }),
        makeWorkedJob({
          deliveryId: 'del-3',
          droppedOff: false,
          endLabel: EnumJobEndLabel.CANCELLED,
          deliveryMoneyCents: 0,
          compensations: [
            {
              id: 'comp-2',
              reason: EnumCourierCompensationReason.CANCELLATION,
              amountCents: 300,
              waitMinutes: null,
              createdAt: new Date('2026-11-20T11:00:00Z'),
              addedLater: false,
            },
          ],
          paidKm: 4.0, // Should NOT count because droppedOff is false
          pickupWaitSeconds: 60,
        }),
      ]

      const figures: PeriodFigures = summarisePeriod(jobs, days)

      // Time sums from days:
      expect(figures.workSeconds).toBe(7200 + 3600) // 10800
      expect(figures.jobSeconds).toBe(5000 + 2000) // 7000
      expect(figures.paidWaitSeconds).toBe(1000 + 600) // 1600
      expect(figures.unpaidSeconds).toBe(1200 + 1000) // 2200

      // Money sums from days:
      expect(figures.moneyCents).toBe(3500 + 2500) // 6000
      expect(figures.unlinkedMoneyCents).toBe(500 + 200) // 700
      expect(figures.noJobMoneyCents).toBe(200 + 100) // 300

      // linkedMoney = 6000 - 700 = 5300
      // centsPerHour = (5300 * 3600) / 10800 = 1766.666... -> Math.round -> 1767
      expect(figures.centsPerHour).toBe(1767)

      // activeSeconds = 7000 + 1600 = 8600
      // activeCentsPerHour = (5300 * 3600) / 8600 = 2218.604... -> Math.round -> 2219
      expect(figures.activeCentsPerHour).toBe(2219)

      // € per paid km:
      // del-1: droppedOff=true, paidKm=3.0, jobMoney = 600 + 150 = 750
      // del-2: droppedOff=true, paidKm=2.0, jobMoney = 800
      // del-3: droppedOff=false -> km and money excluded from centsPerPaidKm
      // Total paidKm = 3.0 + 2.0 = 5.0
      // Total deliveredMoney = 750 + 800 = 1550
      // centsPerPaidKm = 1550 / 5.0 = 310
      expect(figures.paidKm).toBe(5.0)
      expect(figures.centsPerPaidKm).toBe(310)

      // Dropoff count: del-1 and del-2
      expect(figures.dropOffCount).toBe(2)

      // Waits: [90, 150, 60] -> sorted [60, 90, 150] -> middle is 90
      expect(figures.pickupWaitCount).toBe(3)
      expect(figures.medianPickupWaitSeconds).toBe(90)
    })

    test('jobs with paidKm null add to neither side of centsPerPaidKm', () => {
      const days = [
        makeWorkedDay({
          workSeconds: 3600,
          jobSeconds: 1800,
          paidWaitSeconds: 600,
          moneyCents: 2000,
          unlinkedMoneyCents: 0,
        }),
      ]

      const jobs = [
        makeWorkedJob({
          droppedOff: true,
          deliveryMoneyCents: 500,
          paidKm: 2.0,
        }),
        makeWorkedJob({
          droppedOff: true,
          deliveryMoneyCents: 800,
          paidKm: null, // Should add to neither paidKm nor deliveredMoney
        }),
      ]

      const figures = summarisePeriod(jobs, days)

      expect(figures.paidKm).toBe(2.0)
      // centsPerPaidKm = 500 / 2.0 = 250 (not (500+800)/2.0 = 650)
      expect(figures.centsPerPaidKm).toBe(250)
      expect(figures.dropOffCount).toBe(2)
    })

    test('each rate is null when its divisor is below threshold', () => {
      // 1. workSeconds < 60 -> centsPerHour is null
      // 2. activeSeconds < 60 -> activeCentsPerHour is null
      // 3. paidKm < 0.1 -> centsPerPaidKm is null
      const days = [
        makeWorkedDay({
          workSeconds: 59,
          jobSeconds: 30,
          paidWaitSeconds: 20, // activeSeconds = 50 < 60
          moneyCents: 1000,
          unlinkedMoneyCents: 0,
        }),
      ]

      const jobs = [
        makeWorkedJob({
          droppedOff: true,
          deliveryMoneyCents: 500,
          paidKm: 0.08, // < MIN_KM_FOR_RATE (0.1)
          pickupWaitSeconds: null,
        }),
      ]

      expect(MIN_KM_FOR_RATE).toBe(0.1)
      expect(MIN_SECONDS_FOR_RATE).toBe(60)

      const figures = summarisePeriod(jobs, days)

      expect(figures.workSeconds).toBe(59)
      expect(figures.centsPerHour).toBeNull()
      expect(figures.activeCentsPerHour).toBeNull()
      expect(figures.paidKm).toBe(0.08)
      expect(figures.centsPerPaidKm).toBeNull()
      expect(figures.medianPickupWaitSeconds).toBeNull()
      expect(figures.pickupWaitCount).toBe(0)
    })

    test('rates become non-null at exactly 60 s and 0.1 km', () => {
      const days = [
        makeWorkedDay({
          workSeconds: 60,
          jobSeconds: 40,
          paidWaitSeconds: 20, // activeSeconds = 60
          moneyCents: 1000,
          unlinkedMoneyCents: 0,
        }),
      ]

      const jobs = [
        makeWorkedJob({
          droppedOff: true,
          deliveryMoneyCents: 500,
          paidKm: 0.1, // exactly MIN_KM_FOR_RATE
        }),
      ]

      const figures = summarisePeriod(jobs, days)

      expect(figures.centsPerHour).not.toBeNull()
      expect(figures.activeCentsPerHour).not.toBeNull()
      expect(figures.centsPerPaidKm).not.toBeNull()
      expect(figures.centsPerPaidKm).toBe(Math.round(500 / 0.1)) // 5000
    })

    test('a week median differs from any mix of its day medians (AC-5)', () => {
      // Day 1 has waits: [10, 20] -> median is Math.round((10+20)/2) = 15
      // Day 2 has waits: [100, 200] -> median is Math.round((100+200)/2) = 150
      // Day medians: 15 and 150.
      // Average of day medians = 82.5.
      // Combined week waits: [10, 20, 100, 200] -> median is Math.round((20+100)/2) = 60.
      // 60 differs from Day 1 median (15), Day 2 median (150), and average of day medians (82.5 or 83).
      const day1Jobs = [
        makeWorkedJob({ pickupWaitSeconds: 10 }),
        makeWorkedJob({ pickupWaitSeconds: 20 }),
      ]
      const day2Jobs = [
        makeWorkedJob({ pickupWaitSeconds: 100 }),
        makeWorkedJob({ pickupWaitSeconds: 200 }),
      ]

      const day1Figures = summarisePeriod(day1Jobs, [makeWorkedDay({ date: '2026-11-19' })])
      const day2Figures = summarisePeriod(day2Jobs, [makeWorkedDay({ date: '2026-11-20' })])

      expect(day1Figures.medianPickupWaitSeconds).toBe(15)
      expect(day2Figures.medianPickupWaitSeconds).toBe(150)

      const weekFigures = summarisePeriod(
        [...day1Jobs, ...day2Jobs],
        [makeWorkedDay({ date: '2026-11-19' }), makeWorkedDay({ date: '2026-11-20' })]
      )

      expect(weekFigures.medianPickupWaitSeconds).toBe(60)
      expect(weekFigures.medianPickupWaitSeconds).not.toBe(day1Figures.medianPickupWaitSeconds)
      expect(weekFigures.medianPickupWaitSeconds).not.toBe(day2Figures.medianPickupWaitSeconds)
      expect(weekFigures.medianPickupWaitSeconds).not.toBe(
        Math.round((day1Figures.medianPickupWaitSeconds! + day2Figures.medianPickupWaitSeconds!) / 2)
      )
    })
  })
})
