import { EnumDeliveryEventType } from '@prisma/types'
import {
  paidWaitMinutes,
  completedWaits,
  waitOfKey,
  WAIT_END_EVENTS,
  WaitEvent,
} from './wait-pay'
import { HAND_OVER_EVENTS } from 'src/domains/partner/wait-record'

describe('wait-pay domain logic (Spec 0033 AC-1, AC-2, AC-3, AC-6)', () => {
  const at = (hours: number, minutes: number, seconds = 0): Date =>
    new Date(Date.UTC(2026, 10, 9, hours, minutes, seconds))

  describe('paidWaitMinutes (AC-2)', () => {
    // Spec 0033 AC-2 Example 1:
    // Promised 10:00, free 5, arrival 09:58, pickup 10:15: paid 10 minutes.
    // Explanation: Rider arrived at 09:58 (before promised 10:00).
    // Free window ends at 10:00 + 5 min = 10:05.
    // Start of paid wait is max(09:58, 10:05) = 10:05.
    // Ended at 10:15 -> paid 10:15 - 10:05 = 10 minutes.
    it('spec example 1: promised 10:00, free 5 min, arrival 09:58, ended 10:15 => paid 10 minutes', () => {
      const minutes = paidWaitMinutes({
        promisedReadyAt: at(10, 0),
        freeMinutes: 5,
        arrivedAt: at(9, 58),
        endedAt: at(10, 15),
      })
      expect(minutes).toBe(10)
    })

    // Spec 0033 AC-2 Example 2:
    // Promised 10:00, free 5, arrival 10:12, pickup 10:15: paid 3 minutes.
    // Explanation: Rider arrived at 10:12 (after promised 10:00 + 5 min = 10:05).
    // Start of paid wait is max(10:12, 10:05) = 10:12.
    // Ended at 10:15 -> paid 10:15 - 10:12 = 3 minutes.
    it('spec example 2: promised 10:00, free 5 min, arrival 10:12, ended 10:15 => paid 3 minutes', () => {
      const minutes = paidWaitMinutes({
        promisedReadyAt: at(10, 0),
        freeMinutes: 5,
        arrivedAt: at(10, 12),
        endedAt: at(10, 15),
      })
      expect(minutes).toBe(3)
    })

    it('rounds down to whole minutes (e.g. 10 minutes 59 seconds rounds down to 10)', () => {
      const minutes = paidWaitMinutes({
        promisedReadyAt: at(10, 0),
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
        freeMinutes: 5,
        arrivedAt: at(9, 50),
        endedAt: at(10, 2),
      })
      expect(minutes).toBe(0)
    })

    it('never returns below 0 when pickup occurs before arrival (e.g. clock discrepancy)', () => {
      const minutes = paidWaitMinutes({
        promisedReadyAt: at(10, 0),
        freeMinutes: 5,
        arrivedAt: at(10, 15),
        endedAt: at(10, 10),
      })
      expect(minutes).toBe(0)
    })

    it('returns 0 when pickup occurs exactly at the end of the free window', () => {
      const minutes = paidWaitMinutes({
        promisedReadyAt: at(10, 0),
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
        freeMinutes: 0,
        arrivedAt: at(9, 55),
        endedAt: at(10, 10),
      })
      expect(minutes).toBe(10)
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
      expect(completedWaits(events, null, freeMinutes)).toEqual([])
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

      const result = completedWaits(events, promisedReadyAt, freeMinutes)
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

      const result = completedWaits(events, promisedReadyAt, freeMinutes)
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

      expect(completedWaits(events, promisedReadyAt, freeMinutes)).toEqual([])
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

      const result = completedWaits(events, promisedReadyAt, freeMinutes)
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
        expect(completedWaits(events, promisedReadyAt, freeMinutes)).toEqual([])
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

      const result = completedWaits(events, promisedReadyAt, freeMinutes)
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

      const result = completedWaits(events, promisedReadyAt, freeMinutes)
      expect(result).toHaveLength(1)
      expect(result[0]?.endEventId).toBe('evt-pickup')
    })
  })
})
