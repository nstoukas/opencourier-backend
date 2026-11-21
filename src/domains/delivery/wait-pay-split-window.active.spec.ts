import { EnumDeliveryEventType } from '@prisma/types'
import { SPLIT_WINDOW_END, SPLIT_WINDOW_START, WaitEvent, completedWaits, paidWaitMinutes } from './wait-pay'

// Spec 0047, cross check 2: "No double wait pay". The minutes from a split flag to its answer (or to the
// rider leaving, or the request closing another way) are paid only as the split wait, so the ordinary
// restaurant delay wait (spec 0033) must leave them out.
describe('ordinary wait pay leaves out the split window (spec 0047, cross check 2)', () => {
  // A time on 21 Nov 2026, UTC.
  const at = (hour: number, minute: number, second = 0) => new Date(Date.UTC(2026, 10, 21, hour, minute, second))
  const promisedReadyAt = at(12, 0)
  const noFreeMinutes = 0

  describe('paidWaitMinutes with excluded windows', () => {
    const base = { arrivedAt: at(12, 0), promisedReadyAt, foodReadyAt: null, freeMinutes: noFreeMinutes }

    it('with no excluded window, pays the whole wait (unchanged behaviour)', () => {
      expect(paidWaitMinutes({ ...base, endedAt: at(12, 20) })).toBe(20)
      expect(paidWaitMinutes({ ...base, endedAt: at(12, 20), excluded: [] })).toBe(20)
    })

    it('takes a split window inside the wait out of it', () => {
      // 20 minutes at the restaurant, 8 of them waiting for dispatch to split: 12 are the restaurant's delay.
      expect(paidWaitMinutes({ ...base, endedAt: at(12, 20), excluded: [{ from: at(12, 5), to: at(12, 13) }] })).toBe(12)
    })

    it('a split window covering the whole wait leaves nothing to pay twice', () => {
      expect(paidWaitMinutes({ ...base, endedAt: at(12, 20), excluded: [{ from: at(12, 0), to: at(12, 20) }] })).toBe(0)
    })

    it('counts only the part of a window that overlaps the paid wait', () => {
      // The window starts before the wait earns and ends after the wait ended: only the overlap counts.
      expect(paidWaitMinutes({ ...base, endedAt: at(12, 20), excluded: [{ from: at(11, 50), to: at(12, 5) }] })).toBe(15)
      expect(paidWaitMinutes({ ...base, endedAt: at(12, 20), excluded: [{ from: at(12, 15), to: at(12, 40) }] })).toBe(15)
    })

    it('a window entirely outside the wait changes nothing', () => {
      expect(paidWaitMinutes({ ...base, endedAt: at(12, 20), excluded: [{ from: at(12, 30), to: at(12, 40) }] })).toBe(20)
    })

    it('takes out two windows (a refused request, then a second one)', () => {
      const excluded = [
        { from: at(12, 2), to: at(12, 5) },
        { from: at(12, 10), to: at(12, 14) },
      ]
      expect(paidWaitMinutes({ ...base, endedAt: at(12, 20), excluded })).toBe(13)
    })

    it('never goes below 0', () => {
      expect(paidWaitMinutes({ ...base, endedAt: at(12, 3), excluded: [{ from: at(11, 0), to: at(13, 0) }] })).toBe(0)
    })

    it('still rounds down to whole minutes after the window is taken out', () => {
      // 10 min minus 2 min 30 s = 7 min 30 s, paid as 7.
      expect(paidWaitMinutes({ ...base, endedAt: at(12, 10), excluded: [{ from: at(12, 4), to: at(12, 6, 30) }] })).toBe(7)
    })
  })

  describe('completedWaits reads the split events from the delivery history', () => {
    const event = (id: string, type: EnumDeliveryEventType, occurredAt: Date): WaitEvent => ({ id, type, occurredAt, courierId: 'rider-1' })

    it('the window opens at SPLIT_REQUESTED and closes at a confirm, a refusal or a close', () => {
      expect(SPLIT_WINDOW_START).toEqual([EnumDeliveryEventType.SPLIT_REQUESTED])
      expect([...SPLIT_WINDOW_END].sort()).toEqual(
        [EnumDeliveryEventType.SPLIT_CONFIRMED, EnumDeliveryEventType.SPLIT_REFUSED, EnumDeliveryEventType.SPLIT_CLOSED].sort()
      )
    })

    it.each([
      ['confirmed', EnumDeliveryEventType.SPLIT_CONFIRMED],
      ['refused', EnumDeliveryEventType.SPLIT_REFUSED],
    ])('a split %s before pickup: the minutes from the flag to the answer are not in the ordinary wait', (_name, answer) => {
      const events = [
        event('arr', EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, at(12, 0)),
        event('flag', EnumDeliveryEventType.SPLIT_REQUESTED, at(12, 5)),
        event('answer', answer, at(12, 13)),
        event('pickup', EnumDeliveryEventType.PICKED_UP, at(12, 20)),
      ]
      // 20 minutes in all, 8 of them the split wait: the ordinary wait pays 12.
      expect(completedWaits(events, promisedReadyAt, null, noFreeMinutes)).toEqual([
        { endEventId: 'pickup', courierId: 'rider-1', minutes: 12 },
      ])
    })

    it('the same history without the split events pays the full 20 minutes (so the test above measures the exclusion)', () => {
      const events = [
        event('arr', EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, at(12, 0)),
        event('pickup', EnumDeliveryEventType.PICKED_UP, at(12, 20)),
      ]
      expect(completedWaits(events, promisedReadyAt, null, noFreeMinutes)).toEqual([
        { endEventId: 'pickup', courierId: 'rider-1', minutes: 20 },
      ])
    })

    it('an admin took the rider off while the request was open (the move is saved before the close): the window runs to that end', () => {
      const events = [
        event('arr', EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, at(12, 0)),
        event('flag', EnumDeliveryEventType.SPLIT_REQUESTED, at(12, 6)),
        event('moved', EnumDeliveryEventType.REASSIGNED, at(12, 15)),
        event('void', EnumDeliveryEventType.SPLIT_CLOSED, at(12, 15, 1)),
      ]
      // 15 minutes in all, the last 9 the split wait: the ordinary wait pays 6.
      expect(completedWaits(events, promisedReadyAt, null, noFreeMinutes)).toEqual([
        { endEventId: 'moved', courierId: 'rider-1', minutes: 6 },
      ])
    })

    it('a second arrival after a closed request is a fresh wait, with the old window no longer open', () => {
      const events = [
        event('arr', EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, at(12, 0)),
        event('flag', EnumDeliveryEventType.SPLIT_REQUESTED, at(12, 2)),
        event('moved', EnumDeliveryEventType.REASSIGNED, at(12, 10)),
        event('void', EnumDeliveryEventType.SPLIT_CLOSED, at(12, 10, 1)),
        { id: 'arr-2', type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: at(12, 20), courierId: 'rider-2' },
        { id: 'pickup-2', type: EnumDeliveryEventType.PICKED_UP, occurredAt: at(12, 27), courierId: 'rider-2' },
      ]
      expect(completedWaits(events, promisedReadyAt, null, noFreeMinutes)).toEqual([
        { endEventId: 'moved', courierId: 'rider-1', minutes: 2 },
        // The second rider's 7 minutes are all the restaurant's delay: no split window touches them.
        { endEventId: 'pickup-2', courierId: 'rider-2', minutes: 7 },
      ])
    })

    it('flagged the moment the rider arrived and answered at pickup: the ordinary wait pays nothing', () => {
      const events = [
        event('arr', EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, at(12, 0)),
        event('flag', EnumDeliveryEventType.SPLIT_REQUESTED, at(12, 0)),
        event('answer', EnumDeliveryEventType.SPLIT_CONFIRMED, at(12, 9)),
        event('pickup', EnumDeliveryEventType.PICKED_UP, at(12, 9)),
      ]
      expect(completedWaits(events, promisedReadyAt, null, noFreeMinutes)).toEqual([])
    })

    it('with free minutes, the split window is taken out of the paid part only', () => {
      // Arrived 12:00, 5 free minutes, so the wait earns from 12:05. Split window 12:03 to 12:10 overlaps the
      // paid part for 5 minutes. Pickup 12:25: 20 paid minutes minus 5 = 15.
      const events = [
        event('arr', EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, at(12, 0)),
        event('flag', EnumDeliveryEventType.SPLIT_REQUESTED, at(12, 3)),
        event('answer', EnumDeliveryEventType.SPLIT_REFUSED, at(12, 10)),
        event('pickup', EnumDeliveryEventType.PICKED_UP, at(12, 25)),
      ]
      expect(completedWaits(events, promisedReadyAt, null, 5)).toEqual([
        { endEventId: 'pickup', courierId: 'rider-1', minutes: 15 },
      ])
    })
  })
})
