import { EnumDeliveryStatus } from '@prisma/types'
import {
  POINT,
  StackCandidate,
  StackSequenceInput,
  bestStackSequence,
  describeStops,
  isSameRestaurant,
  isStopDone,
  pairStillTogether,
  stackPairBlockKey,
  stackRefusal,
  stackStopsOf,
} from './stack'

// Spec 0048 (row 80): pure functions for stacked orders.
// AC-2 (compatible pair), AC-5 (lifecycle), AC-10 (stop order), cross check 5 (delays and road times),
// cross check 6 (stop sequence schema and pair persistence), cross check 9 (pair block key).
describe('Stacked orders pure domain rules (spec 0048, row 80)', () => {
  const readyDate = new Date('2026-11-23T10:00:00.000Z')

  describe('isSameRestaurant (decision 80.1a)', () => {
    it('true when partnerId and pickupLocationId match', () => {
      expect(
        isSameRestaurant(
          { partnerId: 'partner-1', pickupLocationId: 'loc-kitchen-1' },
          { partnerId: 'partner-1', pickupLocationId: 'loc-kitchen-1' }
        )
      ).toBe(true)
    })

    it('false when partnerId is null on either', () => {
      expect(
        isSameRestaurant(
          { partnerId: null, pickupLocationId: 'loc-1' },
          { partnerId: 'partner-1', pickupLocationId: 'loc-1' }
        )
      ).toBe(false)
    })

    it('false when partner has two kitchens at different pickup locations', () => {
      expect(
        isSameRestaurant(
          { partnerId: 'partner-1', pickupLocationId: 'loc-kitchen-1' },
          { partnerId: 'partner-1', pickupLocationId: 'loc-kitchen-2' }
        )
      ).toBe(false)
    })

    it('false when partners differ even if sharing a dark kitchen location', () => {
      expect(
        isSameRestaurant(
          { partnerId: 'partner-1', pickupLocationId: 'loc-shared' },
          { partnerId: 'partner-2', pickupLocationId: 'loc-shared' }
        )
      ).toBe(false)
    })
  })

  describe('stackRefusal (AC-2, spec 0046, slice 1 & 2)', () => {
    const baseFirst: StackCandidate = {
      id: 'del-1',
      partnerId: 'partner-volos',
      pickupLocationId: 'loc-pickup-1',
      boxUnits: 40,
      orderReference: 'ref-1',
      legCount: null,
      foodReadyAt: null,
    }

    const baseSecond: StackCandidate = {
      id: 'del-2',
      partnerId: 'partner-volos',
      pickupLocationId: 'loc-pickup-1',
      boxUnits: 40,
      orderReference: 'ref-2',
      legCount: null,
      foodReadyAt: null,
    }

    it('refuses pairing a delivery with itself', () => {
      expect(stackRefusal(baseFirst, { ...baseFirst })).toBe('the same delivery')
    })

    it('refuses when total boxUnits exceeds 100 (spec 0043)', () => {
      expect(stackRefusal({ ...baseFirst, boxUnits: 60 }, { ...baseSecond, boxUnits: 50 })).toBe(
        'they do not fit in one box together'
      )
    })

    it('allows when total boxUnits is exactly 100 (same restaurant)', () => {
      expect(stackRefusal({ ...baseFirst, boxUnits: 60 }, { ...baseSecond, boxUnits: 40 })).toBeNull()
    })

    it('refuses pairing two legs of the same order (spec 0046)', () => {
      expect(
        stackRefusal(
          { ...baseFirst, orderReference: 'order-shared', legCount: 2 },
          { ...baseSecond, orderReference: 'order-shared', legCount: 2 }
        )
      ).toBe('two legs of one order')
    })

    it('allows pairing legs of different orders', () => {
      expect(
        stackRefusal(
          { ...baseFirst, orderReference: 'order-A', legCount: 2 },
          { ...baseSecond, orderReference: 'order-B', legCount: 2 }
        )
      ).toBeNull()
    })

    it('allows pairing legs of different restaurants sharing the same orderReference (review of row 80, ruling 7)', () => {
      expect(
        stackRefusal(
          { ...baseFirst, partnerId: 'partner-A', orderReference: 'order-shared', legCount: 2, foodReadyAt: readyDate },
          { ...baseSecond, partnerId: 'partner-B', orderReference: 'order-shared', legCount: 2, foodReadyAt: readyDate }
        )
      ).toBeNull()
    })

    it('refuses pairing legs of the same restaurant sharing the same orderReference (spec 0046, ruling 7)', () => {
      expect(
        stackRefusal(
          { ...baseFirst, partnerId: 'partner-A', orderReference: 'order-shared', legCount: 2 },
          { ...baseSecond, partnerId: 'partner-A', orderReference: 'order-shared', legCount: 2 }
        )
      ).toBe('two legs of one order')
    })

    it('refuses different restaurants when neither has foodReadyAt (slice 1 vs slice 2)', () => {
      expect(
        stackRefusal(
          { ...baseFirst, partnerId: 'partner-A', foodReadyAt: null },
          { ...baseSecond, partnerId: 'partner-B', foodReadyAt: null }
        )
      ).toBe('two restaurants, and not both marked ready')
    })

    it('refuses different restaurants when only one has foodReadyAt', () => {
      expect(
        stackRefusal(
          { ...baseFirst, partnerId: 'partner-A', foodReadyAt: readyDate },
          { ...baseSecond, partnerId: 'partner-B', foodReadyAt: null }
        )
      ).toBe('two restaurants, and not both marked ready')
    })

    it('allows different restaurants when both have foodReadyAt (slice 2)', () => {
      expect(
        stackRefusal(
          { ...baseFirst, partnerId: 'partner-A', foodReadyAt: readyDate },
          { ...baseSecond, partnerId: 'partner-B', foodReadyAt: readyDate }
        )
      ).toBeNull()
    })
  })

  describe('bestStackSequence (AC-2, cross check 5)', () => {
    // Coordinate indices in POINT:
    // 0: Rider, 1: First Pickup, 2: Second Pickup, 3: First Dropoff, 4: Second Dropoff
    const nowMs = 1700000000000 // Fixed epoch ms

    // Helper building an OSRM 5x5 matrix
    const createMatrix = (overrides: Record<string, number | null> = {}): (number | null)[][] => {
      // Default: straight road, 60s per step
      // Rider (0) -> P1 (1): 100s, P1 -> P2 (2): 50s, P2 -> D1 (3): 100s, D1 -> D2 (4): 100s
      // P1 -> D1 direct: 120s
      // P2 -> D2 direct: 120s
      const matrix: (number | null)[][] = [
        // R    P1   P2   D1   D2
        [0, 100, 120, 200, 250], // R
        [100, 0, 50, 120, 200], // P1
        [120, 50, 0, 150, 120], // P2
        [200, 120, 150, 0, 100], // D1
        [250, 200, 120, 100, 0], // D2
      ]

      for (const [key, val] of Object.entries(overrides)) {
        const [from, to] = key.split('-').map(Number)
        if (from !== undefined && to !== undefined && matrix[from]) {
          matrix[from]![to] = val
        }
      }
      return matrix
    }

    const defaultInput: StackSequenceInput = {
      firstId: 'del-first',
      secondId: 'del-second',
      seconds: createMatrix(),
      firstReadyAtMs: null,
      secondReadyAtMs: null,
      nowMs,
      delayLimitSeconds: 600, // 10 minutes limit
    }

    it('finds the best sequence that keeps both delays within delayLimitSeconds', () => {
      const result = bestStackSequence(defaultInput)

      expect(result).not.toBeNull()
      expect(result?.stops).toHaveLength(4)
      // Pickups must precede their own dropoffs
      const stops = result!.stops
      const p1Index = stops.findIndex((s) => s.deliveryId === 'del-first' && s.stop === 'PICKUP')
      const d1Index = stops.findIndex((s) => s.deliveryId === 'del-first' && s.stop === 'DROPOFF')
      const p2Index = stops.findIndex((s) => s.deliveryId === 'del-second' && s.stop === 'PICKUP')
      const d2Index = stops.findIndex((s) => s.deliveryId === 'del-second' && s.stop === 'DROPOFF')

      expect(p1Index).toBeLessThan(d1Index)
      expect(p2Index).toBeLessThan(d2Index)
      expect(result?.delaySeconds['del-first']).toBeLessThanOrEqual(600)
      expect(result?.delaySeconds['del-second']).toBeLessThanOrEqual(600)
      expect(result?.totalSeconds).toBeGreaterThan(0)
    })

    it('returns null when any order exceeds the delay limit', () => {
      // Set delay limit to 0 seconds, but any detour adds > 0s delay to at least one order
      const strictInput: StackSequenceInput = {
        ...defaultInput,
        delayLimitSeconds: 0,
      }
      const result = bestStackSequence(strictInput)
      expect(result).toBeNull()
    })

    it('waits at pickup if food is not ready when rider arrives (cross check 5)', () => {
      // Rider reaches P1 at nowMs + 100s. Food is ready at nowMs + 200s (100s wait).
      const waitInput: StackSequenceInput = {
        ...defaultInput,
        firstReadyAtMs: nowMs + 200 * 1000,
        secondReadyAtMs: null,
      }
      const result = bestStackSequence(waitInput)
      expect(result).not.toBeNull()
      // Total duration includes the wait at pickup
      expect(result?.totalSeconds).toBeGreaterThanOrEqual(200)
    })

    it('returns null if OSRM duration is missing (OSRM down: cross check 5)', () => {
      const brokenMatrix = createMatrix({ '0-1': null }) // Can't route from rider to pickup 1
      const brokenInput: StackSequenceInput = {
        ...defaultInput,
        seconds: brokenMatrix,
      }
      expect(bestStackSequence(brokenInput)).toBeNull()
    })
  })

  describe('describeStops (value 1: transparency on record)', () => {
    it('formats 4 stops using the first 8 characters of each delivery id', () => {
      const formatted = describeStops([
        { deliveryId: 'abcdef123456', stop: 'PICKUP' },
        { deliveryId: '9876543210ab', stop: 'PICKUP' },
        { deliveryId: 'abcdef123456', stop: 'DROPOFF' },
        { deliveryId: '9876543210ab', stop: 'DROPOFF' },
      ])
      expect(formatted).toBe('pickup abcdef12, pickup 98765432, drop off abcdef12, drop off 98765432')
    })
  })

  describe('stackPairBlockKey (cross check 9)', () => {
    it('produces the same key regardless of argument order', () => {
      const key1 = stackPairBlockKey('del-alpha', 'del-beta')
      const key2 = stackPairBlockKey('del-beta', 'del-alpha')
      expect(key1).toBe('stack-pair-block-del-alpha-del-beta')
      expect(key1).toBe(key2)
    })
  })

  describe('stackStopsOf (cross check 6)', () => {
    it('returns null for non-array or wrong length', () => {
      expect(stackStopsOf(null)).toBeNull()
      expect(stackStopsOf({})).toBeNull()
      expect(stackStopsOf([])).toBeNull()
      expect(stackStopsOf([1, 2, 3])).toBeNull()
    })

    it('returns null if any stop is malformed', () => {
      expect(
        stackStopsOf([
          { deliveryId: 'del-1', stop: 'PICKUP' },
          { deliveryId: 'del-2', stop: 'INVALID_STOP' },
          { deliveryId: 'del-1', stop: 'DROPOFF' },
          { deliveryId: 'del-2', stop: 'DROPOFF' },
        ])
      ).toBeNull()
    })

    it('returns null if stops do not belong to exactly two deliveries', () => {
      expect(
        stackStopsOf([
          { deliveryId: 'del-1', stop: 'PICKUP' },
          { deliveryId: 'del-2', stop: 'PICKUP' },
          { deliveryId: 'del-3', stop: 'DROPOFF' },
          { deliveryId: 'del-4', stop: 'DROPOFF' },
        ])
      ).toBeNull()
    })

    it('returns parsed stops for valid 4-stop json of 2 deliveries', () => {
      const valid = [
        { deliveryId: 'del-1', stop: 'PICKUP' },
        { deliveryId: 'del-2', stop: 'PICKUP' },
        { deliveryId: 'del-1', stop: 'DROPOFF' },
        { deliveryId: 'del-2', stop: 'DROPOFF' },
      ]
      expect(stackStopsOf(valid)).toEqual(valid)
    })
  })

  describe('pairStillTogether (cross check 6, 7)', () => {
    it('true when both are ASSIGNING_COURIER to the same matched rider', () => {
      expect(
        pairStillTogether([
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: 'rider-1', courierId: null },
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: 'rider-1', courierId: null },
        ])
      ).toBe(true)
    })

    it('true when both are ongoing to the same accepted rider', () => {
      expect(
        pairStillTogether([
          { status: EnumDeliveryStatus.ACCEPTED, matchedCourierId: null, courierId: 'rider-1' },
          { status: EnumDeliveryStatus.DISPATCHED, matchedCourierId: null, courierId: 'rider-1' },
        ])
      ).toBe(true)
    })

    it('true during group accept transition (one taken, one still assigning to same rider)', () => {
      expect(
        pairStillTogether([
          { status: EnumDeliveryStatus.ACCEPTED, matchedCourierId: null, courierId: 'rider-1' },
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: 'rider-1', courierId: null },
        ])
      ).toBe(true)
    })

    it('false when assigned to different riders', () => {
      expect(
        pairStillTogether([
          { status: EnumDeliveryStatus.ACCEPTED, matchedCourierId: null, courierId: 'rider-1' },
          { status: EnumDeliveryStatus.ACCEPTED, matchedCourierId: null, courierId: 'rider-2' },
        ])
      ).toBe(false)
    })

    it('false when one delivery has completed, cancelled, or ended', () => {
      expect(
        pairStillTogether([
          { status: EnumDeliveryStatus.DROPPED_OFF, matchedCourierId: null, courierId: 'rider-1' },
          { status: EnumDeliveryStatus.DISPATCHED, matchedCourierId: null, courierId: 'rider-1' },
        ])
      ).toBe(false)
    })
  })

  describe('isStopDone (AC-10)', () => {
    it('PICKUP is not done while status is ASSIGNING_COURIER, ACCEPTED, DISPATCHED, or ARRIVED_AT_PICKUP', () => {
      expect(isStopDone('PICKUP', EnumDeliveryStatus.ASSIGNING_COURIER)).toBe(false)
      expect(isStopDone('PICKUP', EnumDeliveryStatus.ACCEPTED)).toBe(false)
      expect(isStopDone('PICKUP', EnumDeliveryStatus.DISPATCHED)).toBe(false)
      expect(isStopDone('PICKUP', EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)).toBe(false)
    })

    it('PICKUP is done once food is PICKED_UP or later', () => {
      expect(isStopDone('PICKUP', EnumDeliveryStatus.PICKED_UP)).toBe(true)
      expect(isStopDone('PICKUP', EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION)).toBe(true)
      expect(isStopDone('PICKUP', EnumDeliveryStatus.DROPPED_OFF)).toBe(true)
    })

    it('DROPOFF is not done while order is in flight', () => {
      expect(isStopDone('DROPOFF', EnumDeliveryStatus.ACCEPTED)).toBe(false)
      expect(isStopDone('DROPOFF', EnumDeliveryStatus.PICKED_UP)).toBe(false)
      expect(isStopDone('DROPOFF', EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION)).toBe(false)
    })

    it('DROPOFF is done once order is DROPPED_OFF, CANCELED, or FAILED', () => {
      expect(isStopDone('DROPOFF', EnumDeliveryStatus.DROPPED_OFF)).toBe(true)
      expect(isStopDone('DROPOFF', EnumDeliveryStatus.CANCELED)).toBe(true)
      expect(isStopDone('DROPOFF', EnumDeliveryStatus.FAILED)).toBe(true)
    })
  })
})
