import { EnumDeliveryStatus } from '@prisma/types'
import {
  MAX_READY_AFTER_CREATION_MINUTES,
  PICKED_UP_STATUSES,
  READY_ACTION_STATUSES,
  READY_DELAY_MINUTES,
  READY_SENTENCES,
  USUAL_PREP_MINUTES_MAX,
  USUAL_PREP_MINUTES_MIN,
  USUAL_PREP_MINUTES_SENTENCE,
  delayedReadyAt,
  initialReadyAt,
  pastReadyLimit,
  readyActionRefusal,
} from './ready-signals'

// Spec 0023: the rules behind the restaurant's ready time, as plain values and functions.
describe('ready-signals rules (spec 0023)', () => {
  const MINUTE = 60 * 1000
  const now = new Date('2026-11-03T12:00:00.000Z')

  describe('the fixed values the spec names', () => {
    test('the pre pickup set is exactly CREATED, ASSIGNING_COURIER, ACCEPTED, DISPATCHED, COURIER_ARRIVED_AT_PICKUP_LOCATION', () => {
      expect([...READY_ACTION_STATUSES].sort()).toEqual(
        [
          EnumDeliveryStatus.CREATED,
          EnumDeliveryStatus.ASSIGNING_COURIER,
          EnumDeliveryStatus.ACCEPTED,
          EnumDeliveryStatus.DISPATCHED,
          EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        ].sort()
      )
    })

    test('the picked up set is exactly PICKED_UP, ON_THE_WAY, COURIER_ARRIVED_AT_DROPOFF_LOCATION', () => {
      expect([...PICKED_UP_STATUSES].sort()).toEqual(
        [
          EnumDeliveryStatus.PICKED_UP,
          EnumDeliveryStatus.ON_THE_WAY,
          EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
        ].sort()
      )
    })

    test('a delay may only be 5, 10 or 15 minutes (AC-3)', () => {
      expect([...READY_DELAY_MINUTES]).toEqual([5, 10, 15])
    })

    test('the guard is 3 hours after creation (decision 21.4)', () => {
      expect(MAX_READY_AFTER_CREATION_MINUTES).toBe(180)
    })

    test('the usual prep time range is 0 to 90 with its sentence (AC-9)', () => {
      expect(USUAL_PREP_MINUTES_MIN).toBe(0)
      expect(USUAL_PREP_MINUTES_MAX).toBe(90)
      expect(USUAL_PREP_MINUTES_SENTENCE).toBe('The usual prep time is a whole number of minutes from 0 to 90.')
    })

    test('the refusal sentences are the spec text, word for word (AC-3, AC-4)', () => {
      expect(READY_SENTENCES).toEqual({
        alreadyReady: 'The food is already marked ready.',
        pickedUp: 'The rider has already picked this order up.',
        ended: 'This order has ended.',
        tooLate: 'A ready time can be at most 3 hours after the order was placed.',
        changed: 'The ready time just changed. Look again.',
      })
    })
  })

  describe('initialReadyAt (AC-1)', () => {
    test('a future pickupReadyAt is the ready time, unchanged', () => {
      const pick = new Date(now.getTime() + 20 * MINUTE)
      expect(initialReadyAt(pick, 15, now).getTime()).toBe(pick.getTime())
    })

    test('a pickupReadyAt before now counts as now', () => {
      const past = new Date(now.getTime() - 5 * MINUTE)
      expect(initialReadyAt(past, 15, now).getTime()).toBe(now.getTime())
    })

    test('a pickupReadyAt exactly now stays now', () => {
      expect(initialReadyAt(new Date(now), 15, now).getTime()).toBe(now.getTime())
    })

    test('with no pickupReadyAt (null or undefined) it is now plus the usual prep time', () => {
      expect(initialReadyAt(null, 25, now).getTime()).toBe(now.getTime() + 25 * MINUTE)
      expect(initialReadyAt(undefined, 15, now).getTime()).toBe(now.getTime() + 15 * MINUTE)
    })

    test('a usual prep time of 0 makes the ready time now', () => {
      expect(initialReadyAt(null, 0, now).getTime()).toBe(now.getTime())
    })

    test('a sent pickupReadyAt wins over the usual prep time', () => {
      const pick = new Date(now.getTime() + 3 * MINUTE)
      expect(initialReadyAt(pick, 60, now).getTime()).toBe(pick.getTime())
    })
  })

  describe('delayedReadyAt (AC-3: the later of readyAt and now, plus the minutes)', () => {
    test('a ready time still ahead moves from itself', () => {
      const readyAt = new Date(now.getTime() + 8 * MINUTE)
      expect(delayedReadyAt(readyAt, now, 10).getTime()).toBe(now.getTime() + 18 * MINUTE)
    })

    test('a ready time already passed moves from now, never into the past', () => {
      const readyAt = new Date(now.getTime() - 12 * MINUTE)
      expect(delayedReadyAt(readyAt, now, 5).getTime()).toBe(now.getTime() + 5 * MINUTE)
    })

    test('no ready time (an old order) moves from now', () => {
      expect(delayedReadyAt(null, now, 15).getTime()).toBe(now.getTime() + 15 * MINUTE)
    })

    test('a ready time exactly now moves from now', () => {
      expect(delayedReadyAt(new Date(now), now, 10).getTime()).toBe(now.getTime() + 10 * MINUTE)
    })
  })

  describe('readyActionRefusal (AC-3, AC-4)', () => {
    test.each(READY_ACTION_STATUSES)('%s (before pickup) is allowed', (status) => {
      expect(readyActionRefusal(status)).toBeNull()
    })

    test.each([
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.ON_THE_WAY,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
    ])('%s is refused with the picked up sentence', (status) => {
      expect(readyActionRefusal(status)).toBe('The rider has already picked this order up.')
    })

    test.each([EnumDeliveryStatus.DROPPED_OFF, EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.FAILED])(
      '%s is refused with the ended sentence',
      (status) => {
        expect(readyActionRefusal(status)).toBe('This order has ended.')
      }
    )

    test('a status the lists do not know is refused, not allowed (the safe direction)', () => {
      expect(readyActionRefusal('SOME_FUTURE_STATUS' as EnumDeliveryStatus)).toBe('This order has ended.')
    })

    test('every status in the schema is either allowed or refused with one of the sentences', () => {
      for (const status of Object.values(EnumDeliveryStatus)) {
        const refusal = readyActionRefusal(status)
        if (READY_ACTION_STATUSES.includes(status)) {
          expect(refusal).toBeNull()
        } else {
          expect([READY_SENTENCES.pickedUp, READY_SENTENCES.ended]).toContain(refusal)
        }
      }
    })
  })

  describe('pastReadyLimit (decision 21.4: at most 180 minutes after creation)', () => {
    const createdAt = new Date('2026-11-03T10:00:00.000Z')

    test('exactly 180 minutes after creation is allowed', () => {
      expect(pastReadyLimit(new Date(createdAt.getTime() + 180 * MINUTE), createdAt)).toBe(false)
    })

    test('181 minutes after creation is refused', () => {
      expect(pastReadyLimit(new Date(createdAt.getTime() + 181 * MINUTE), createdAt)).toBe(true)
    })

    test('one millisecond past 180 minutes is refused', () => {
      expect(pastReadyLimit(new Date(createdAt.getTime() + 180 * MINUTE + 1), createdAt)).toBe(true)
    })

    test('well inside the limit is allowed', () => {
      expect(pastReadyLimit(new Date(createdAt.getTime() + 30 * MINUTE), createdAt)).toBe(false)
    })
  })
})
