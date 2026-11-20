import {
  EnumCourierCompensationReason,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
} from '@prisma/types'
import {
  EnumJobEndLabel,
  WorkedShiftsInput,
  buildWorkedShifts,
  endLabelOf,
  jobMoneyCents,
  pairJobs,
  pickupWaitSecondsOf,
} from './worked-shifts'

describe('Worked Shifts - Earnings & History (Spec 0042 AC-2, AC-4, AC-8, decisions 75.23, 75.31, 75.33)', () => {
  const courierId = 'courier-test-1'
  const timezone = 'Europe/Athens'
  const currencyCode = 'EUR'

  function makeDate(isoAthens: string): Date {
    return new Date(isoAthens)
  }

  describe('Item 2: AC-4 - Pickup wait pairing and timing', () => {
    test('pickupWaitSecondsOf returns whole seconds between arrivedAt and pickedUpAt, never below 0, and null without both', () => {
      // Normal: 10:00:00 to 10:02:15 -> 135 seconds
      const t1 = makeDate('2026-11-20T10:00:00.000Z').getTime()
      const t2 = makeDate('2026-11-20T10:02:15.000Z').getTime()
      expect(pickupWaitSecondsOf({ arrivedAt: t1, pickedUpAt: t2 })).toBe(135)

      // Null when either is missing:
      expect(pickupWaitSecondsOf({ arrivedAt: t1, pickedUpAt: null })).toBeNull()
      expect(pickupWaitSecondsOf({ arrivedAt: null, pickedUpAt: t2 })).toBeNull()
      expect(pickupWaitSecondsOf({ arrivedAt: null, pickedUpAt: null })).toBeNull()

      // Never below 0 if clock skew occurred
      expect(pickupWaitSecondsOf({ arrivedAt: t2, pickedUpAt: t1 })).toBe(0)
    })

    test('pairJobs pairs by createdAt order and times wait by occurredAt', () => {
      // Arrival tapped at 10:00:00 (occurredAt) but received at 10:05:00 (createdAt)
      // Pickup tapped at 10:04:00 (occurredAt) and received at 10:06:00 (createdAt)
      // Pickup wait should be 10:04:00 - 10:00:00 = 240 seconds (4 minutes)
      const events = [
        {
          id: 'ev-1',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-20T09:50:00.000Z'),
          createdAt: makeDate('2026-11-20T09:50:00.000Z'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          oldStatus: EnumDeliveryStatus.DISPATCHED,
          courierId: null,
          occurredAt: makeDate('2026-11-20T10:00:00.000Z'),
          createdAt: makeDate('2026-11-20T10:05:00.000Z'),
        },
        {
          id: 'ev-3',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.PICKED_UP,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          courierId: null,
          occurredAt: makeDate('2026-11-20T10:04:00.000Z'),
          createdAt: makeDate('2026-11-20T10:06:00.000Z'),
        },
        {
          id: 'ev-4',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          courierId: null,
          occurredAt: makeDate('2026-11-20T10:30:00.000Z'),
          createdAt: makeDate('2026-11-20T10:30:00.000Z'),
        },
      ]

      const deliveries = [
        {
          id: 'del-1',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Taverna',
        },
      ]

      const jobs = pairJobs(courierId, events, deliveries, null)
      expect(jobs).toHaveLength(1)
      const job = jobs[0]!
      expect(job.arrivedAt).toBe(makeDate('2026-11-20T10:00:00.000Z').getTime())
      expect(job.pickedUpAt).toBe(makeDate('2026-11-20T10:04:00.000Z').getTime())
      expect(pickupWaitSecondsOf(job)).toBe(240)
    })

    test('an arrival received after the job ended is outside it (arrivedAt remains null)', () => {
      // The job ends at 10:30:00 (DROPPED_OFF, createdAt 10:30:00).
      // A delayed ARRIVED_AT_PICKUP_LOCATION event arrives with createdAt 10:35:00.
      const events = [
        {
          id: 'ev-1',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-20T10:00:00.000Z'),
          createdAt: makeDate('2026-11-20T10:00:00.000Z'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          courierId: null,
          occurredAt: makeDate('2026-11-20T10:30:00.000Z'),
          createdAt: makeDate('2026-11-20T10:30:00.000Z'),
        },
        {
          id: 'ev-3',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          oldStatus: EnumDeliveryStatus.DISPATCHED,
          courierId: null,
          occurredAt: makeDate('2026-11-20T10:10:00.000Z'),
          createdAt: makeDate('2026-11-20T10:35:00.000Z'), // received after DROPPED_OFF
        },
      ]

      const deliveries = [
        {
          id: 'del-1',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Taverna',
        },
      ]

      const jobs = pairJobs(courierId, events, deliveries, null)
      expect(jobs).toHaveLength(1)
      expect(jobs[0]!.arrivedAt).toBeNull()
      expect(jobs[0]!.pickedUpAt).toBeNull()
      expect(pickupWaitSecondsOf(jobs[0]!)).toBeNull()
    })

    test('a job moved up to recordedFrom keeps its wait only when both taps are at or after recordedFrom', () => {
      const recordedFrom = makeDate('2026-11-20T10:00:00.000Z')

      // Case A: accept at 09:30, arrival at 09:45 (< recordedFrom), pickup at 10:05 (>= recordedFrom)
      // -> arrivedAt is before recordedFrom -> wait must be cleared to null
      const eventsA = [
        {
          id: 'ev-1',
          deliveryId: 'del-A',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-20T09:30:00.000Z'),
          createdAt: makeDate('2026-11-20T09:30:00.000Z'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-A',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          oldStatus: EnumDeliveryStatus.DISPATCHED,
          courierId: null,
          occurredAt: makeDate('2026-11-20T09:45:00.000Z'),
          createdAt: makeDate('2026-11-20T09:45:00.000Z'),
        },
        {
          id: 'ev-3',
          deliveryId: 'del-A',
          type: EnumDeliveryEventType.PICKED_UP,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          courierId: null,
          occurredAt: makeDate('2026-11-20T10:05:00.000Z'),
          createdAt: makeDate('2026-11-20T10:05:00.000Z'),
        },
        {
          id: 'ev-4',
          deliveryId: 'del-A',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          courierId: null,
          occurredAt: makeDate('2026-11-20T10:30:00.000Z'),
          createdAt: makeDate('2026-11-20T10:30:00.000Z'),
        },
      ]

      const deliveriesA = [
        {
          id: 'del-A',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Taverna',
        },
      ]

      const jobsA = pairJobs(courierId, eventsA, deliveriesA, recordedFrom)
      expect(jobsA).toHaveLength(1)
      expect(jobsA[0]!.start).toBe(recordedFrom.getTime())
      expect(jobsA[0]!.arrivedAt).toBeNull() // Cleared because < recordedFrom
      expect(jobsA[0]!.pickedUpAt).toBe(makeDate('2026-11-20T10:05:00.000Z').getTime())
      expect(pickupWaitSecondsOf(jobsA[0]!)).toBeNull()

      // Case B: accept at 09:30, arrival at 10:05 (>= recordedFrom), pickup at 10:15 (>= recordedFrom)
      // -> both taps >= recordedFrom -> wait is kept!
      const eventsB = [
        {
          id: 'ev-1',
          deliveryId: 'del-B',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-20T09:30:00.000Z'),
          createdAt: makeDate('2026-11-20T09:30:00.000Z'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-B',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          oldStatus: EnumDeliveryStatus.DISPATCHED,
          courierId: null,
          occurredAt: makeDate('2026-11-20T10:05:00.000Z'),
          createdAt: makeDate('2026-11-20T10:05:00.000Z'),
        },
        {
          id: 'ev-3',
          deliveryId: 'del-B',
          type: EnumDeliveryEventType.PICKED_UP,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          courierId: null,
          occurredAt: makeDate('2026-11-20T10:15:00.000Z'),
          createdAt: makeDate('2026-11-20T10:15:00.000Z'),
        },
        {
          id: 'ev-4',
          deliveryId: 'del-B',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          courierId: null,
          occurredAt: makeDate('2026-11-20T10:30:00.000Z'),
          createdAt: makeDate('2026-11-20T10:30:00.000Z'),
        },
      ]

      const deliveriesB = [
        {
          id: 'del-B',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Taverna',
        },
      ]

      const jobsB = pairJobs(courierId, eventsB, deliveriesB, recordedFrom)
      expect(jobsB).toHaveLength(1)
      expect(jobsB[0]!.arrivedAt).toBe(makeDate('2026-11-20T10:05:00.000Z').getTime())
      expect(jobsB[0]!.pickedUpAt).toBe(makeDate('2026-11-20T10:15:00.000Z').getTime())
      expect(pickupWaitSecondsOf(jobsB[0]!)).toBe(600) // 10 minutes
    })
  })

  describe('Item 3: AC-8, decision 75.23 - endLabelOf for every label', () => {
    test('returns null for this rider drop off', () => {
      expect(
        endLabelOf({
          end: 1000,
          endEventType: EnumDeliveryEventType.DROPPED_OFF,
          droppedOff: true,
          cancelledAfterPickup: false,
        })
      ).toBeNull()
    })

    test('returns IN_PROGRESS while job is held (end is null)', () => {
      expect(
        endLabelOf({
          end: null,
          endEventType: null,
          droppedOff: false,
          cancelledAfterPickup: false,
        })
      ).toBe(EnumJobEndLabel.IN_PROGRESS)
    })

    test('returns CANCELLED_AFTER_PICKUP when cancelledAfterPickup is true (CANCELED from PICKED_UP or later)', () => {
      // 1. CANCELED from PICKED_UP
      expect(
        endLabelOf({
          end: 1000,
          endEventType: EnumDeliveryEventType.CANCELED,
          droppedOff: false,
          cancelledAfterPickup: true,
        })
      ).toBe(EnumJobEndLabel.CANCELLED_AFTER_PICKUP)

      // 2. FOOD_RETURNED / FOOD_NOT_RETURNED
      expect(
        endLabelOf({
          end: 1000,
          endEventType: EnumDeliveryEventType.FOOD_RETURNED,
          droppedOff: false,
          cancelledAfterPickup: false,
        })
      ).toBe(EnumJobEndLabel.CANCELLED_AFTER_PICKUP)

      expect(
        endLabelOf({
          end: 1000,
          endEventType: EnumDeliveryEventType.FOOD_NOT_RETURNED,
          droppedOff: false,
          cancelledAfterPickup: false,
        })
      ).toBe(EnumJobEndLabel.CANCELLED_AFTER_PICKUP)
    })

    test('returns CANCELLED for CANCELED before pickup', () => {
      expect(
        endLabelOf({
          end: 1000,
          endEventType: EnumDeliveryEventType.CANCELED,
          droppedOff: false,
          cancelledAfterPickup: false,
        })
      ).toBe(EnumJobEndLabel.CANCELLED)
    })

    test('returns REMOVED for REMOVAL_APPROVED', () => {
      expect(
        endLabelOf({
          end: 1000,
          endEventType: EnumDeliveryEventType.REMOVAL_APPROVED,
          droppedOff: false,
          cancelledAfterPickup: false,
        })
      ).toBe(EnumJobEndLabel.REMOVED)
    })

    test('returns HANDED_BACK for HANDED_BACK', () => {
      expect(
        endLabelOf({
          end: 1000,
          endEventType: EnumDeliveryEventType.HANDED_BACK,
          droppedOff: false,
          cancelledAfterPickup: false,
        })
      ).toBe(EnumJobEndLabel.HANDED_BACK)
    })

    test('returns REASSIGNED for REASSIGNED, RETURNED_TO_WAITING, WAIT_UNDISPATCHED, and another rider ACCEPTED', () => {
      const reassignedEvents = [
        EnumDeliveryEventType.REASSIGNED,
        EnumDeliveryEventType.RETURNED_TO_WAITING,
        EnumDeliveryEventType.WAIT_UNDISPATCHED,
        EnumDeliveryEventType.ACCEPTED, // another rider took it
      ]

      for (const endEventType of reassignedEvents) {
        expect(
          endLabelOf({
            end: 1000,
            endEventType,
            droppedOff: false,
            cancelledAfterPickup: false,
          })
        ).toBe(EnumJobEndLabel.REASSIGNED)
      }
    })

    test('returns FAILED for FAILED', () => {
      expect(
        endLabelOf({
          end: 1000,
          endEventType: EnumDeliveryEventType.FAILED,
          droppedOff: false,
          cancelledAfterPickup: false,
        })
      ).toBe(EnumJobEndLabel.FAILED)
    })

    test('returns ENDED for any other end event', () => {
      expect(
        endLabelOf({
          end: 1000,
          endEventType: EnumDeliveryEventType.CREATED,
          droppedOff: false,
          cancelledAfterPickup: false,
        })
      ).toBe(EnumJobEndLabel.ENDED)
    })

    test('pairJobs correctly marks cancelledAfterPickup when CANCELED occurs after PICKED_UP, and when a new ACCEPTED ends the return trip', () => {
      const events = [
        {
          id: 'ev-1',
          deliveryId: 'del-trip',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-20T10:00:00.000Z'),
          createdAt: makeDate('2026-11-20T10:00:00.000Z'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-trip',
          type: EnumDeliveryEventType.PICKED_UP,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          courierId: null,
          occurredAt: makeDate('2026-11-20T10:10:00.000Z'),
          createdAt: makeDate('2026-11-20T10:10:00.000Z'),
        },
        {
          id: 'ev-3',
          deliveryId: 'del-trip',
          type: EnumDeliveryEventType.CANCELED,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY, // PICKED_UP status
          courierId: null,
          occurredAt: makeDate('2026-11-20T10:15:00.000Z'),
          createdAt: makeDate('2026-11-20T10:15:00.000Z'),
        },
        {
          id: 'ev-4',
          deliveryId: 'del-trip',
          type: EnumDeliveryEventType.ACCEPTED, // e.g. Reoffered or reaccepted
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: 'courier-other',
          occurredAt: makeDate('2026-11-20T10:25:00.000Z'),
          createdAt: makeDate('2026-11-20T10:25:00.000Z'),
        },
      ]

      const deliveries = [
        {
          id: 'del-trip',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: 'courier-other',
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Taverna',
        },
      ]

      const jobs = pairJobs(courierId, events, deliveries, null)
      expect(jobs).toHaveLength(1)
      expect(jobs[0]!.cancelledAfterPickup).toBe(true)
      expect(endLabelOf(jobs[0]!)).toBe(EnumJobEndLabel.CANCELLED_AFTER_PICKUP)
    })
  })

  describe('Item 4: AC-2, AC-8 - Day job rows, noJobMoneyCents invariant, accept day rule, and addedLater', () => {
    test('a day job rows plus its noJobMoneyCents equal its moneyCents, and jobsInNoShift accepted that day are included', () => {
      // Setup a day with:
      // - One shift (10:00 to 14:00 Athens) holding one job (del-1, accept 10:30, dropped off, pay 600, tip 100) -> 700 cents
      // - One zero-length job while Offline (not in recorded shift: del-2, accept 15:00, pay 400) -> 400 cents
      // - One unlinked compensation with no delivery at all (review adjustment: 250 cents) -> noJobMoneyCents = 250
      // Expected:
      // day.moneyCents = 700 + 400 + 250 = 1350
      // shift jobs money (700) + jobsInNoShift money (400) + day.noJobMoneyCents (250) = 1350!
      const statusChanges = [
        {
          id: 'sc-1',
          courierId,
          createdAt: makeDate('2026-11-20T08:00:00.000Z'), // 10:00 Athens
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-2',
          courierId,
          createdAt: makeDate('2026-11-20T12:00:00.000Z'), // 14:00 Athens
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ]

      const events = [
        // Job 1 (in shift)
        {
          id: 'ev-1',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-20T08:30:00.000Z'),
          createdAt: makeDate('2026-11-20T08:30:00.000Z'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          courierId: null,
          occurredAt: makeDate('2026-11-20T09:00:00.000Z'),
          createdAt: makeDate('2026-11-20T09:00:00.000Z'),
        },
        // Job 2 (zero-length job while Offline: start === end at 06:00 UTC = 08:00 Athens, before shift started at 08:00 UTC)
        {
          id: 'ev-3',
          deliveryId: 'del-2',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-20T06:00:00.000Z'),
          createdAt: makeDate('2026-11-20T06:00:00.000Z'),
        },
        {
          id: 'ev-4',
          deliveryId: 'del-2',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          courierId: null,
          occurredAt: makeDate('2026-11-20T06:00:00.000Z'),
          createdAt: makeDate('2026-11-20T06:00:00.000Z'),
        },
      ]

      const deliveries = [
        {
          id: 'del-1',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 600,
          tips: 100,
          pickupName: 'Restaurant 1',
        },
        {
          id: 'del-2',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 400,
          tips: 0,
          pickupName: 'Restaurant 2',
        },
      ]

      const compensations = [
        // Pure unlinked compensation (not tied to any delivery)
        {
          id: 'comp-unlinked-1',
          courierId,
          deliveryId: 'del-no-job-at-all',
          amount: 250,
          currencyCode,
          reason: EnumCourierCompensationReason.REVIEW,
          waitMinutes: null,
          createdAt: makeDate('2026-11-20T14:00:00.000Z'),
        },
      ]

      const input: WorkedShiftsInput = {
        courierId,
        windowStart: makeDate('2026-11-19T22:00:00.000Z'),
        windowEnd: makeDate('2026-11-20T22:00:00.000Z'),
        rangeStart: makeDate('2026-11-19T22:00:00.000Z'), // 2026-11-20 00:00 Athens
        rangeEnd: makeDate('2026-11-20T22:00:00.000Z'), // 2026-11-21 00:00 Athens
        statusAtWindowStart: EnumCourierStatus.OFFLINE,
        statusChanges,
        events,
        deliveries,
        compensations,
        deliveriesWithAnyJob: new Set(['del-1', 'del-2']),
        now: makeDate('2026-11-21T10:00:00.000Z'),
        recordedFrom: makeDate('2026-01-01T00:00:00.000Z'),
        shiftBreakMinutes: 30,
        currencyCode,
        timezone,
      }

      const result = buildWorkedShifts(input)

      expect(result.days).toHaveLength(1)
      const day = result.days[0]!
      expect(day.date).toBe('2026-11-20')

      // Check shift jobs
      const shiftJobs = result.shifts.flatMap((s) => s.jobs)
      expect(shiftJobs).toHaveLength(1)
      expect(shiftJobs[0]!.deliveryId).toBe('del-1')
      const shiftJobMoney = jobMoneyCents(shiftJobs[0]!)
      expect(shiftJobMoney).toBe(700)

      // Check jobsInNoShift
      expect(result.jobsInNoShift).toHaveLength(1)
      expect(result.jobsInNoShift[0]!.deliveryId).toBe('del-2')
      const noShiftJobMoney = jobMoneyCents(result.jobsInNoShift[0]!)
      expect(noShiftJobMoney).toBe(400)

      // Check noJobMoneyCents
      expect(day.noJobMoneyCents).toBe(250)

      // Invariant: shift jobs + jobsInNoShift + noJobMoneyCents === day.moneyCents
      const totalDayJobRowsMoney = shiftJobMoney + noShiftJobMoney
      expect(totalDayJobRowsMoney + day.noJobMoneyCents).toBe(day.moneyCents)
      expect(day.moneyCents).toBe(1350)
    })

    test('a job accepted at 23:50 Athens and dropped off after midnight counts on the accept day (AC-2)', () => {
      // 23:50 Athens is 21:50 UTC (UTC+2 in November).
      // Dropoff at 00:20 Athens next day (22:20 UTC).
      const statusChanges = [
        {
          id: 'sc-1',
          courierId,
          createdAt: makeDate('2026-11-19T21:00:00.000Z'), // 23:00 Athens
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-2',
          courierId,
          createdAt: makeDate('2026-11-19T23:00:00.000Z'), // 01:00 Athens next day
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ]

      const events = [
        {
          id: 'ev-1',
          deliveryId: 'del-midnight',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-19T21:50:00.000Z'), // 23:50 Athens on 2026-11-19
          createdAt: makeDate('2026-11-19T21:50:00.000Z'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-midnight',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          courierId: null,
          occurredAt: makeDate('2026-11-19T22:20:00.000Z'), // 00:20 Athens on 2026-11-20
          createdAt: makeDate('2026-11-19T22:20:00.000Z'),
        },
      ]

      const deliveries = [
        {
          id: 'del-midnight',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 850,
          tips: 50,
          pickupName: 'Late Night Diner',
        },
      ]

      const input: WorkedShiftsInput = {
        courierId,
        windowStart: makeDate('2026-11-18T22:00:00.000Z'),
        windowEnd: makeDate('2026-11-20T22:00:00.000Z'),
        rangeStart: makeDate('2026-11-18T22:00:00.000Z'), // 2026-11-19 00:00 Athens
        rangeEnd: makeDate('2026-11-20T22:00:00.000Z'), // 2026-11-21 00:00 Athens
        statusAtWindowStart: EnumCourierStatus.OFFLINE,
        statusChanges,
        events,
        deliveries,
        compensations: [],
        deliveriesWithAnyJob: new Set(['del-midnight']),
        now: makeDate('2026-11-21T10:00:00.000Z'),
        recordedFrom: makeDate('2026-01-01T00:00:00.000Z'),
        shiftBreakMinutes: 30,
        currencyCode,
        timezone,
      }

      const result = buildWorkedShifts(input)

      // Money must be on 2026-11-19 (the accept day), NOT 2026-11-20!
      const day19 = result.days.find((d) => d.date === '2026-11-19')
      const day20 = result.days.find((d) => d.date === '2026-11-20')

      expect(day19).toBeDefined()
      expect(day19!.moneyCents).toBe(900) // 850 + 50

      expect(day20).toBeDefined()
      expect(day20!.moneyCents).toBe(0)
    })

    test('"added later" is true only for a compensation written after the shift ended, false while open, false for job in no shift (AC-2)', () => {
      // Shift 1: ended at 12:00 UTC (14:00 Athens).
      // Comp 1: written at 11:30 UTC (during shift) -> addedLater = false
      // Comp 2: written at 13:00 UTC (after shift ended) -> addedLater = true
      // Shift 2: open (endedAt is null)
      // Comp 3: written while shift is open -> addedLater = false
      // Job in no shift (del-no-shift)
      // Comp 4: compensation for job in no shift -> addedLater = false
      const statusChanges = [
        // Closed shift
        {
          id: 'sc-1',
          courierId,
          createdAt: makeDate('2026-11-20T08:00:00.000Z'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-2',
          courierId,
          createdAt: makeDate('2026-11-20T12:00:00.000Z'), // Shift ended
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        // Open shift
        {
          id: 'sc-3',
          courierId,
          createdAt: makeDate('2026-11-20T14:00:00.000Z'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ]

      const events = [
        // del-closed in Shift 1
        {
          id: 'ev-1',
          deliveryId: 'del-closed',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-20T09:00:00.000Z'),
          createdAt: makeDate('2026-11-20T09:00:00.000Z'),
        },
        {
          id: 'ev-2',
          deliveryId: 'del-closed',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          courierId: null,
          occurredAt: makeDate('2026-11-20T09:30:00.000Z'),
          createdAt: makeDate('2026-11-20T09:30:00.000Z'),
        },
        // del-open in Shift 2
        {
          id: 'ev-3',
          deliveryId: 'del-open',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-20T14:30:00.000Z'),
          createdAt: makeDate('2026-11-20T14:30:00.000Z'),
        },
        // del-noshift (zero-length job while offline between shifts: start === end at 13:00)
        {
          id: 'ev-4',
          deliveryId: 'del-noshift',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: makeDate('2026-11-20T13:00:00.000Z'),
          createdAt: makeDate('2026-11-20T13:00:00.000Z'),
        },
        {
          id: 'ev-5',
          deliveryId: 'del-noshift',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          courierId: null,
          occurredAt: makeDate('2026-11-20T13:00:00.000Z'),
          createdAt: makeDate('2026-11-20T13:00:00.000Z'),
        },
      ]

      const deliveries = [
        {
          id: 'del-closed',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Taverna',
        },
        {
          id: 'del-open',
          status: EnumDeliveryStatus.ACCEPTED,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Taverna',
        },
        {
          id: 'del-noshift',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Taverna',
        },
      ]

      const compensations = [
        // Comp 1: written at 11:30 (< shift endedAt 12:00) -> addedLater = false
        {
          id: 'comp-during-shift',
          courierId,
          deliveryId: 'del-closed',
          amount: 100,
          currencyCode,
          reason: EnumCourierCompensationReason.WAITING,
          waitMinutes: 10,
          createdAt: makeDate('2026-11-20T11:30:00.000Z'),
        },
        // Comp 2: written at 13:00 (> shift endedAt 12:00) -> addedLater = true
        {
          id: 'comp-after-shift',
          courierId,
          deliveryId: 'del-closed',
          amount: 200,
          currencyCode,
          reason: EnumCourierCompensationReason.REVIEW,
          waitMinutes: null,
          createdAt: makeDate('2026-11-20T13:00:00.000Z'),
        },
        // Comp 3: written while shift is open -> addedLater = false
        {
          id: 'comp-open-shift',
          courierId,
          deliveryId: 'del-open',
          amount: 150,
          currencyCode,
          reason: EnumCourierCompensationReason.WAITING,
          waitMinutes: 15,
          createdAt: makeDate('2026-11-20T15:00:00.000Z'),
        },
        // Comp 4: for job in no shift -> addedLater = false
        {
          id: 'comp-noshift',
          courierId,
          deliveryId: 'del-noshift',
          amount: 300,
          currencyCode,
          reason: EnumCourierCompensationReason.REVIEW,
          waitMinutes: null,
          createdAt: makeDate('2026-11-20T16:00:00.000Z'),
        },
      ]

      const input: WorkedShiftsInput = {
        courierId,
        windowStart: makeDate('2026-11-19T22:00:00.000Z'),
        windowEnd: makeDate('2026-11-20T18:00:00.000Z'),
        rangeStart: makeDate('2026-11-19T22:00:00.000Z'),
        rangeEnd: makeDate('2026-11-20T18:00:00.000Z'),
        statusAtWindowStart: EnumCourierStatus.OFFLINE,
        statusChanges,
        events,
        deliveries,
        compensations,
        deliveriesWithAnyJob: new Set(['del-closed', 'del-open', 'del-noshift']),
        now: makeDate('2026-11-20T18:00:00.000Z'),
        recordedFrom: makeDate('2026-01-01T00:00:00.000Z'),
        shiftBreakMinutes: 30,
        currencyCode,
        timezone,
      }

      const result = buildWorkedShifts(input)

      // Closed shift jobs
      const closedShift = result.shifts[0]!
      const closedJob = closedShift.jobs[0]!
      const comp1 = closedJob.compensations.find((c) => c.id === 'comp-during-shift')!
      const comp2 = closedJob.compensations.find((c) => c.id === 'comp-after-shift')!
      expect(comp1.addedLater).toBe(false)
      expect(comp2.addedLater).toBe(true)

      // Open shift jobs
      const openShift = result.shifts[1]!
      const openJob = openShift.jobs[0]!
      const comp3 = openJob.compensations.find((c) => c.id === 'comp-open-shift')!
      expect(comp3.addedLater).toBe(false)

      // Job in no shift
      expect(result.jobsInNoShift).toHaveLength(1)
      const noShiftJob = result.jobsInNoShift[0]!
      const comp4 = noShiftJob.compensations.find((c) => c.id === 'comp-noshift')!
      expect(comp4.addedLater).toBe(false)
    })
  })
})
