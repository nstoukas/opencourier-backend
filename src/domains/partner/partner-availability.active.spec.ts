import {
  BUSY_EXTRA_MINUTES,
  DISABLED_REASON_MAX_LENGTH,
  PAUSE_MINUTES,
  availabilityOf,
  disabledSentence,
  partnerAvailabilityRefusal,
  pauseInForce,
} from './partner-availability'

// Spec 0029: the pure rules behind a restaurant's busy mode, pause and disable.
describe('partner-availability rules (spec 0029)', () => {
  // 12:00 UTC = 14:00 in Athens (UTC+2 in winter time).
  const NOW = new Date('2026-11-09T12:00:00.000Z')

  describe('allowed lists and constants (decision 34.2)', () => {
    test('busy extra minutes is exactly [5, 10, 15, 20, 30] (AC-1)', () => {
      expect(BUSY_EXTRA_MINUTES).toEqual([5, 10, 15, 20, 30])
    })

    test('pause minutes is exactly [15, 30, 60, 120] (AC-3)', () => {
      expect(PAUSE_MINUTES).toEqual([15, 30, 60, 120])
    })

    test('disabled reason maximum length is 200 characters (AC-5)', () => {
      expect(DISABLED_REASON_MAX_LENGTH).toBe(200)
    })
  })

  describe('pauseInForce (AC-3, decision 34.5)', () => {
    test('returns the end time when pausedUntil is strictly in the future', () => {
      const future = new Date(NOW.getTime() + 15 * 60_000)
      expect(pauseInForce(future, NOW)).toEqual(future)
    })

    test('returns null when pausedUntil equals now (expired at the boundary)', () => {
      expect(pauseInForce(NOW, NOW)).toBeNull()
    })

    test('returns null when pausedUntil is in the past', () => {
      const past = new Date(NOW.getTime() - 60_000)
      expect(pauseInForce(past, NOW)).toBeNull()
    })

    test('returns null when pausedUntil is null', () => {
      expect(pauseInForce(null, NOW)).toBeNull()
    })
  })

  describe('disabledSentence (AC-4, AC-6)', () => {
    test('formats the reason into the co-op refusal sentence', () => {
      expect(disabledSentence('Unpaid cooperative subscription fees')).toBe(
        'The co-op has disabled this restaurant: Unpaid cooperative subscription fees'
      )
    })

    test('provides a fallback when reason is null', () => {
      expect(disabledSentence(null)).toBe('The co-op has disabled this restaurant: no reason given')
    })
  })

  describe('partnerAvailabilityRefusal (AC-4, AC-6)', () => {
    test('returns disabled sentence when disabledAt is set', () => {
      const partner = {
        busyExtraMinutes: null,
        pausedUntil: null,
        disabledAt: NOW,
        disabledReason: 'Health inspection pending',
      }
      expect(partnerAvailabilityRefusal(partner, NOW)).toBe(
        'The co-op has disabled this restaurant: Health inspection pending'
      )
    })

    test('disabled check comes before pause check: returns disabled sentence even if pause is also active', () => {
      const future = new Date(NOW.getTime() + 30 * 60_000)
      const partner = {
        busyExtraMinutes: null,
        pausedUntil: future,
        disabledAt: NOW,
        disabledReason: 'Co-op assembly decision',
      }
      expect(partnerAvailabilityRefusal(partner, NOW)).toBe(
        'The co-op has disabled this restaurant: Co-op assembly decision'
      )
    })

    test('returns paused sentence formatted in Athens time when pausedUntil is in the future', () => {
      // 12:30 UTC = 14:30 Athens time.
      const until = new Date('2026-11-09T12:30:00.000Z')
      const partner = {
        busyExtraMinutes: null,
        pausedUntil: until,
        disabledAt: null,
        disabledReason: null,
      }
      expect(partnerAvailabilityRefusal(partner, NOW)).toBe('Ordering is paused until 14:30.')
    })

    test('returns null when pause has expired by the clock', () => {
      const expired = new Date(NOW.getTime() - 5 * 60_000)
      const partner = {
        busyExtraMinutes: null,
        pausedUntil: expired,
        disabledAt: null,
        disabledReason: null,
      }
      expect(partnerAvailabilityRefusal(partner, NOW)).toBeNull()
    })

    test('returns null when restaurant is accepting orders (busy mode does not refuse orders)', () => {
      const partner = {
        busyExtraMinutes: 15,
        pausedUntil: null,
        disabledAt: null,
        disabledReason: null,
      }
      expect(partnerAvailabilityRefusal(partner, NOW)).toBeNull()
    })
  })

  describe('availabilityOf (AC-7)', () => {
    test('returns all six fields with acceptingOrders true when neither disabled nor paused', () => {
      const partner = {
        busyExtraMinutes: 20,
        pausedUntil: null,
        disabledAt: null,
        disabledReason: null,
      }
      expect(availabilityOf(partner, NOW)).toEqual({
        busyExtraMinutes: 20,
        pausedUntil: null,
        disabledAt: null,
        disabledReason: null,
        acceptingOrders: true,
        notAcceptingReason: null,
      })
    })

    test('returns acceptingOrders false and notAcceptingReason when disabled', () => {
      const partner = {
        busyExtraMinutes: null,
        pausedUntil: null,
        disabledAt: NOW,
        disabledReason: 'Seasonal closure',
      }
      expect(availabilityOf(partner, NOW)).toEqual({
        busyExtraMinutes: null,
        pausedUntil: null,
        disabledAt: NOW,
        disabledReason: 'Seasonal closure',
        acceptingOrders: false,
        notAcceptingReason: 'The co-op has disabled this restaurant: Seasonal closure',
      })
    })

    test('returns acceptingOrders false and formatted time when pause is active', () => {
      const until = new Date('2026-11-09T12:30:00.000Z')
      const partner = {
        busyExtraMinutes: 10,
        pausedUntil: until,
        disabledAt: null,
        disabledReason: null,
      }
      expect(availabilityOf(partner, NOW)).toEqual({
        busyExtraMinutes: 10,
        pausedUntil: until,
        disabledAt: null,
        disabledReason: null,
        acceptingOrders: false,
        notAcceptingReason: 'Ordering is paused until 14:30.',
      })
    })

    test('expired pause reads as null for pausedUntil and acceptingOrders is true', () => {
      const expired = new Date(NOW.getTime() - 10 * 60_000)
      const partner = {
        busyExtraMinutes: null,
        pausedUntil: expired,
        disabledAt: null,
        disabledReason: null,
      }
      expect(availabilityOf(partner, NOW)).toEqual({
        busyExtraMinutes: null,
        pausedUntil: null,
        disabledAt: null,
        disabledReason: null,
        acceptingOrders: true,
        notAcceptingReason: null,
      })
    })
  })
})
