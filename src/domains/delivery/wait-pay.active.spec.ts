import { EnumDeliveryEventType } from '@prisma/types'
import {
  paidWaitMinutes,
  waitPaidFrom,
  waitLeaveFrom,
  completedWaits,
  latestCompletedWait,
  waitOfKey,
  WAIT_END_EVENTS,
  WaitEvent,
} from './wait-pay'
import { HAND_OVER_EVENTS } from 'src/domains/partner/wait-record'

describe('wait-pay domain logic (Spec 0033 AC-1, AC-2, AC-3, AC-6)', () => {
  const at = (hours: number, minutes: number, seconds = 0): Date =>
    new Date(Date.UTC(2026, 10, 9, hours, minutes, seconds))

  describe('waitPaidFrom and paidWaitMinutes (AC-2)', () => {
    // Spec 0033 AC-2 Example 1:
    // Promise 10:00, free 10, arrival 09:58, food 10:20, pickup 10:22: paid 12 minutes.
    it('spec example 1: promise 10:00, free 10, arrival 09:58, food 10:20, pickup 10:22 => paid 12', () => {
      const times = {
        promisedReadyAt: at(10, 0),
        freeMinutes: 10,
        arrivedAt: at(9, 58),
        foodReadyAt: at(10, 20),
      }
      expect(waitPaidFrom(times)).toEqual(at(10, 10))
      expect(paidWaitMinutes({ ...times, endedAt: at(10, 22) })).toBe(12)
    })

    // Spec 0033 AC-2 Example 2:
    // Arrival 10:15, food 10:25, pickup 10:27: paid 12 minutes.
    it('spec example 2: promise 10:00, free 10, arrival 10:15, food 10:25, pickup 10:27 => paid 12', () => {
      const times = {
        promisedReadyAt: at(10, 0),
        freeMinutes: 10,
        arrivedAt: at(10, 15),
        foodReadyAt: at(10, 25),
      }
      expect(waitPaidFrom(times)).toEqual(at(10, 15))
      expect(paidWaitMinutes({ ...times, endedAt: at(10, 27) })).toBe(12)
    })

    // Spec 0033 AC-2 Example 3:
    // Arrival 10:15, food marked ready 10:05, pickup 10:17: nothing.
    it('spec example 3: promise 10:00, free 10, arrival 10:15, food 10:05, pickup 10:17 => nothing', () => {
      const times = {
        promisedReadyAt: at(10, 0),
        freeMinutes: 10,
        arrivedAt: at(10, 15),
        foodReadyAt: at(10, 5),
      }
      expect(waitPaidFrom(times)).toBeNull()
      expect(paidWaitMinutes({ ...times, endedAt: at(10, 17) })).toBe(0)
    })

    describe('boundaries (decision 23.14, 23.17)', () => {
      it('arriving exactly at promise plus free is not late', () => {
        // Promise 10:00, free 10 => free until 10:10.
        // Arrived exactly at 10:10:00. Even if food was ready at 10:05, rider is NOT late.
        const times = {
          promisedReadyAt: at(10, 0),
          freeMinutes: 10,
          arrivedAt: at(10, 10),
          foodReadyAt: at(10, 5),
        }
        expect(waitPaidFrom(times)).toEqual(at(10, 10))
        expect(paidWaitMinutes({ ...times, endedAt: at(10, 20) })).toBe(10)
      })

      it('food marked ready exactly at arrival counts as ready', () => {
        // Promise 10:00, free 10 => free until 10:10. Rider arrived late at 10:15.
        // Food marked ready exactly at 10:15:00. Food was ready at arrival -> nothing paid.
        const times = {
          promisedReadyAt: at(10, 0),
          freeMinutes: 10,
          arrivedAt: at(10, 15),
          foodReadyAt: at(10, 15),
        }
        expect(waitPaidFrom(times)).toBeNull()
        expect(paidWaitMinutes({ ...times, endedAt: at(10, 25) })).toBe(0)
      })

      it('no food ready tap counts as not ready', () => {
        // Promise 10:00, free 10. Rider arrived at 10:15. Restaurant never tapped Food ready (foodReadyAt = null).
        // Late rider still earns handover wait pay.
        const times = {
          promisedReadyAt: at(10, 0),
          freeMinutes: 10,
          arrivedAt: at(10, 15),
          foodReadyAt: null,
        }
        expect(waitPaidFrom(times)).toEqual(at(10, 15))
        expect(paidWaitMinutes({ ...times, endedAt: at(10, 27) })).toBe(12)
      })
    })

    it('rounds down to whole minutes (e.g. 10 minutes 59 seconds rounds down to 10)', () => {
      const minutes = paidWaitMinutes({
        promisedReadyAt: at(10, 0),
        foodReadyAt: null,
        freeMinutes: 5,
        arrivedAt: at(9, 58),
        endedAt: at(10, 15, 59), // 10 min 59 sec after 10:05
      })
      expect(minutes).toBe(10)
    })

    it('never returns below 0 when pickup occurs before the free window expires', () => {
      // Arrived 09:50, promised 10:00, free 5 min (10:05), picked up at 10:02
      const minutes = paidWaitMinutes({
        promisedReadyAt: at(10, 0),
        foodReadyAt: null,
        freeMinutes: 5,
        arrivedAt: at(9, 50),
        endedAt: at(10, 2),
      })
      expect(minutes).toBe(0)
    })

    it('never returns below 0 when pickup occurs before arrival (e.g. clock discrepancy)', () => {
      const minutes = paidWaitMinutes({
        promisedReadyAt: at(10, 0),
        foodReadyAt: null,
        freeMinutes: 5,
        arrivedAt: at(10, 15),
        endedAt: at(10, 10),
      })
      expect(minutes).toBe(0)
    })

    it('returns 0 when pickup occurs exactly at the end of the free window', () => {
      const minutes = paidWaitMinutes({
        promisedReadyAt: at(10, 0),
        foodReadyAt: null,
        freeMinutes: 5,
        arrivedAt: at(9, 55),
        endedAt: at(10, 5),
      })
      expect(minutes).toBe(0)
    })

    it('freeMinutes of 0 pays immediately from the promised ready time (or arrival)', () => {
      // Promised 10:00, free 0, arrived 09:55, picked up 10:10 -> paid 10 minutes
      const minutes = paidWaitMinutes({
        promisedReadyAt: at(10, 0),
        foodReadyAt: null,
        freeMinutes: 0,
        arrivedAt: at(9, 55),
        endedAt: at(10, 10),
      })
      expect(minutes).toBe(10)
    })
  })

  describe('waitLeaveFrom (AC-6, decision 23.15)', () => {
    // Decision 23.15: runs from the later of the first promise and the rider's arrival
    it('arrived before the promise: leave from promise plus the limit', () => {
      // Promise 10:00, arrival 09:50, leave limit 10 minutes -> leave from 10:10
      const leave = waitLeaveFrom(at(10, 0), at(9, 50), 10)
      expect(leave).toEqual(at(10, 10))
    })

    it('arrived after the promise (10:20 for 10:00, limit 10): leave from arrival plus the limit (10:30)', () => {
      // Promise 10:00, arrival 10:20, leave limit 10 minutes -> leave from 10:30
      const leave = waitLeaveFrom(at(10, 0), at(10, 20), 10)
      expect(leave).toEqual(at(10, 30))
    })

    it('arrived exactly at the promise: leave from promise plus the limit', () => {
      // Promise 10:00, arrival 10:00, leave limit 10 minutes -> leave from 10:10
      const leave = waitLeaveFrom(at(10, 0), at(10, 0), 10)
      expect(leave).toEqual(at(10, 10))
    })

    it('applies the configured leaveMinutes limit (e.g. 1 minute or 15 minutes)', () => {
      // 1 minute limit with late arrival 10:15 -> 10:16
      expect(waitLeaveFrom(at(10, 0), at(10, 15), 1)).toEqual(at(10, 16))
      // 15 minute limit with early arrival 09:55 -> 10:15
      expect(waitLeaveFrom(at(10, 0), at(9, 55), 15)).toEqual(at(10, 15))
    })
  })

  describe('WAIT_END_EVENTS', () => {
    it('includes exactly PICKED_UP and WAIT_UNDISPATCHED', () => {
      expect(WAIT_END_EVENTS).toEqual([
        EnumDeliveryEventType.PICKED_UP,
        EnumDeliveryEventType.WAIT_UNDISPATCHED,
      ])
    })
  })

  describe('waitOfKey', () => {
    it('formats key as deliveryId:endEventId', () => {
      expect(waitOfKey('del-123', 'evt-456')).toBe('del-123:evt-456')
    })
  })

  describe('completedWaits (AC-2, AC-3, AC-6)', () => {
    const promisedReadyAt = at(10, 0)
    const foodReadyAt = null
    const freeMinutes = 5

    it('returns empty array when delivery has no promisedReadyAt (no promise pays nothing)', () => {
      const events: WaitEvent[] = [
        {
          id: 'evt-arr',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(9, 58),
          courierId: 'courier-1',
        },
        {
          id: 'evt-pickup',
          type: EnumDeliveryEventType.PICKED_UP,
          occurredAt: at(10, 15),
          courierId: 'courier-1',
        },
      ]
      expect(completedWaits(events, null, foodReadyAt, freeMinutes)).toEqual([])
    })

    it('returns completed wait for ARRIVED_AT_PICKUP_LOCATION followed by PICKED_UP', () => {
      const events: WaitEvent[] = [
        {
          id: 'evt-arr',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(9, 58),
          courierId: 'courier-1',
        },
        {
          id: 'evt-pickup',
          type: EnumDeliveryEventType.PICKED_UP,
          occurredAt: at(10, 15),
          courierId: 'courier-1',
        },
      ]

      const result = completedWaits(events, promisedReadyAt, foodReadyAt, freeMinutes)
      expect(result).toEqual([
        {
          endEventId: 'evt-pickup',
          courierId: 'courier-1',
          minutes: 10,
        },
      ])
    })

    it('returns completed wait for ARRIVED_AT_PICKUP_LOCATION followed by WAIT_UNDISPATCHED (leaving)', () => {
      const events: WaitEvent[] = [
        {
          id: 'evt-arr',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(9, 58),
          courierId: 'courier-1',
        },
        {
          id: 'evt-leave',
          type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
          occurredAt: at(10, 15),
          courierId: 'courier-1',
        },
      ]

      const result = completedWaits(events, promisedReadyAt, foodReadyAt, freeMinutes)
      expect(result).toEqual([
        {
          endEventId: 'evt-leave',
          courierId: 'courier-1',
          minutes: 10,
        },
      ])
    })

    it('does not include a wait with 0 paid minutes', () => {
      const events: WaitEvent[] = [
        {
          id: 'evt-arr',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(9, 58),
          courierId: 'courier-1',
        },
        {
          id: 'evt-pickup',
          type: EnumDeliveryEventType.PICKED_UP,
          occurredAt: at(10, 4), // within free window (ends at 10:05)
          courierId: 'courier-1',
        },
      ]

      expect(completedWaits(events, promisedReadyAt, foodReadyAt, freeMinutes)).toEqual([])
    })

    it('pairs multiple waits on one delivery in order (e.g. rider 1 leaves, rider 2 picks up)', () => {
      const events: WaitEvent[] = [
        // Rider 1 arrives at 09:58 and leaves at 10:15 (10 min wait)
        {
          id: 'evt-arr-1',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(9, 58),
          courierId: 'courier-1',
        },
        {
          id: 'evt-leave-1',
          type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
          occurredAt: at(10, 15),
          courierId: 'courier-1',
        },
        // Rider 2 arrives at 10:20 and picks up at 10:30 (10 min wait)
        {
          id: 'evt-arr-2',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(10, 20),
          courierId: 'courier-2',
        },
        {
          id: 'evt-pickup-2',
          type: EnumDeliveryEventType.PICKED_UP,
          occurredAt: at(10, 30),
          courierId: 'courier-2',
        },
      ]

      const result = completedWaits(events, promisedReadyAt, foodReadyAt, freeMinutes)
      expect(result).toEqual([
        {
          endEventId: 'evt-leave-1',
          courierId: 'courier-1',
          minutes: 10,
        },
        {
          endEventId: 'evt-pickup-2',
          courierId: 'courier-2',
          minutes: 10,
        },
      ])
    })

    test.each([
      EnumDeliveryEventType.REASSIGNED,
      EnumDeliveryEventType.RETURNED_TO_WAITING,
      EnumDeliveryEventType.HANDED_BACK,
    ])(
      'clears arrival when handover event %s occurs so rider 1 arrival is not paired with rider 2 pickup',
      (handOverType) => {
        const events: WaitEvent[] = [
          // Rider 1 arrives at 09:58
          {
            id: 'evt-arr-1',
            type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
            occurredAt: at(9, 58),
            courierId: 'courier-1',
          },
          // Handover happens at 10:10
          {
            id: 'evt-handover',
            type: handOverType,
            occurredAt: at(10, 10),
            courierId: 'courier-1',
          },
          // Rider 2 picks up at 10:20 WITHOUT tapping arrival
          {
            id: 'evt-pickup-2',
            type: EnumDeliveryEventType.PICKED_UP,
            occurredAt: at(10, 20),
            courierId: 'courier-2',
          },
        ]

        // Since Rider 2 had no arrival, no completed wait is recorded
        expect(completedWaits(events, promisedReadyAt, foodReadyAt, freeMinutes)).toEqual([])
      }
    )

    it('WAIT_UNDISPATCHED completes rider 1 wait and clears arrival so rider 2 pickup without arrival has no wait', () => {
      const events: WaitEvent[] = [
        // Rider 1 arrives at 09:58 and leaves at 10:10 (paid 5 min)
        {
          id: 'evt-arr-1',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(9, 58),
          courierId: 'courier-1',
        },
        {
          id: 'evt-leave-1',
          type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
          occurredAt: at(10, 10),
          courierId: 'courier-1',
        },
        // Rider 2 picks up at 10:20 WITHOUT tapping arrival
        {
          id: 'evt-pickup-2',
          type: EnumDeliveryEventType.PICKED_UP,
          occurredAt: at(10, 20),
          courierId: 'courier-2',
        },
      ]

      const result = completedWaits(events, promisedReadyAt, foodReadyAt, freeMinutes)
      // Exactly 1 wait is returned (for Rider 1), none for Rider 2
      expect(result).toEqual([
        {
          endEventId: 'evt-leave-1',
          courierId: 'courier-1',
          minutes: 5,
        },
      ])
    })

    it('ignores arrival event that occurred after pickup', () => {
      const events: WaitEvent[] = [
        {
          id: 'evt-arr',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(9, 58),
          courierId: 'courier-1',
        },
        {
          id: 'evt-pickup',
          type: EnumDeliveryEventType.PICKED_UP,
          occurredAt: at(10, 15),
          courierId: 'courier-1',
        },
        // Stray late arrival
        {
          id: 'evt-late-arr',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(10, 25),
          courierId: 'courier-1',
        },
      ]

      const result = completedWaits(events, promisedReadyAt, foodReadyAt, freeMinutes)
      expect(result).toHaveLength(1)
      expect(result[0]?.endEventId).toBe('evt-pickup')
    })
  })

  describe('latestCompletedWait (review fix)', () => {
    const promisedReadyAt = at(10, 0)
    const foodReadyAt = null
    const freeMinutes = 5

    it('returns the wait closed by the newest end event', () => {
      const events: WaitEvent[] = [
        // Wait 1: rider 1 arrived 09:58 and left 10:15 (10 min)
        {
          id: 'evt-arr-1',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(9, 58),
          courierId: 'courier-1',
        },
        {
          id: 'evt-leave-1',
          type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
          occurredAt: at(10, 15),
          courierId: 'courier-1',
        },
        // Wait 2: rider 2 arrived 10:20 and picked up 10:35 (15 min)
        {
          id: 'evt-arr-2',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(10, 20),
          courierId: 'courier-2',
        },
        {
          id: 'evt-pickup-2',
          type: EnumDeliveryEventType.PICKED_UP,
          occurredAt: at(10, 35),
          courierId: 'courier-2',
        },
      ]

      const result = latestCompletedWait(events, promisedReadyAt, foodReadyAt, freeMinutes)
      expect(result).toEqual({
        endEventId: 'evt-pickup-2',
        courierId: 'courier-2',
        minutes: 15,
      })
    })

    it('returns null when the newest end has no arrival on the trail, even when an earlier wait exists', () => {
      const events: WaitEvent[] = [
        // Earlier wait: rider 1 arrived 09:58 and left 10:15 (10 min completed wait)
        {
          id: 'evt-arr-1',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(9, 58),
          courierId: 'courier-1',
        },
        {
          id: 'evt-leave-1',
          type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
          occurredAt: at(10, 15),
          courierId: 'courier-1',
        },
        // Newest end: rider 2 picked up at 10:35 WITHOUT an arrival event on the trail
        {
          id: 'evt-pickup-2',
          type: EnumDeliveryEventType.PICKED_UP,
          occurredAt: at(10, 35),
          courierId: 'courier-2',
        },
      ]

      // Even though wait 1 completed, newest end (evt-pickup-2) has no arrival, so latestCompletedWait is null
      const result = latestCompletedWait(events, promisedReadyAt, foodReadyAt, freeMinutes)
      expect(result).toBeNull()
    })

    it('returns null when the newest end earned no minutes, even when an earlier wait exists', () => {
      const events: WaitEvent[] = [
        // Earlier wait: rider 1 arrived 09:58 and left 10:15 (10 min completed wait)
        {
          id: 'evt-arr-1',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(9, 58),
          courierId: 'courier-1',
        },
        {
          id: 'evt-leave-1',
          type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
          occurredAt: at(10, 15),
          courierId: 'courier-1',
        },
        // Newest end: rider 2 arrived at 10:20 and picked up at 10:20 (0 paid minutes)
        {
          id: 'evt-arr-2',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(10, 20),
          courierId: 'courier-2',
        },
        {
          id: 'evt-pickup-2',
          type: EnumDeliveryEventType.PICKED_UP,
          occurredAt: at(10, 20),
          courierId: 'courier-2',
        },
      ]

      // Even though wait 1 earned 10 minutes, newest end earned 0 minutes, so latestCompletedWait is null
      const result = latestCompletedWait(events, promisedReadyAt, foodReadyAt, freeMinutes)
      expect(result).toBeNull()
    })

    it('returns null when there are no end events on the trail', () => {
      const events: WaitEvent[] = [
        {
          id: 'evt-arr-1',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(9, 58),
          courierId: 'courier-1',
        },
      ]

      expect(latestCompletedWait(events, promisedReadyAt, foodReadyAt, freeMinutes)).toBeNull()
      expect(latestCompletedWait([], promisedReadyAt, foodReadyAt, freeMinutes)).toBeNull()
    })
  })
})
