import { EnumDeliveryStatus } from '@prisma/types'
import { EnumAddOnMoment } from 'src/shared-types/stacking'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types/stateMachine'
import {
  ADD_ON_NOT_AUTOMATIC_SENTENCE,
  AddOnSequenceInput,
  addOnFigures,
  addOnJobIdOf,
  addOnJobStatuses,
  addOnMomentAllows,
  addOnRefusal,
  bestAddOnSequence,
  describeAddOn,
  isAddOnOffer,
  isCarryingFood,
} from './add-on'
import { POINT, StackCandidate } from './stack'

// Spec 0048 (row 81): mid job add on offers pure domain rules.
// Covers:
// - AC-1, AC-6: add-on moments (BEFORE_PICKUP, BEFORE_DROPOFF, SAME_RESTAURANT)
// - AC-2: compatible pair, box limits, same restaurant, ready times, delay limit
// - AC-6, AC-10: stop order, extra km, extra minutes
// - AC-8: automatic accept refusal sentence
// - Cross check 2: calm offers while carrying food
describe('Add-on pure domain rules (spec 0048, row 81)', () => {
  const readyDate = new Date('2026-11-23T10:00:00.000Z')

  describe('isCarryingFood (cross check 2)', () => {
    it('returns true when current job is in a picked up status', () => {
      expect(isCarryingFood(EnumDeliveryStatus.PICKED_UP)).toBe(true)
      expect(isCarryingFood(EnumDeliveryStatus.ON_THE_WAY)).toBe(true)
      expect(isCarryingFood(EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION)).toBe(true)
    })

    it('returns false when current job is not yet picked up or not ongoing', () => {
      expect(isCarryingFood(EnumDeliveryStatus.ACCEPTED)).toBe(false)
      expect(isCarryingFood(EnumDeliveryStatus.DISPATCHED)).toBe(false)
      expect(isCarryingFood(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)).toBe(false)
      expect(isCarryingFood(EnumDeliveryStatus.DROPPED_OFF)).toBe(false)
      expect(isCarryingFood(EnumDeliveryStatus.CANCELED)).toBe(false)
      expect(isCarryingFood(EnumDeliveryStatus.ASSIGNING_COURIER)).toBe(false)
    })
  })

  describe('addOnMomentAllows (AC-1, AC-6)', () => {
    describe('BEFORE_PICKUP moment', () => {
      it('allows statuses before food is picked up', () => {
        expect(addOnMomentAllows(EnumAddOnMoment.BEFORE_PICKUP, EnumDeliveryStatus.ACCEPTED, false)).toBe(true)
        expect(addOnMomentAllows(EnumAddOnMoment.BEFORE_PICKUP, EnumDeliveryStatus.DISPATCHED, false)).toBe(true)
        expect(
          addOnMomentAllows(EnumAddOnMoment.BEFORE_PICKUP, EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, false)
        ).toBe(true)
      })

      it('refuses statuses once food is picked up or later', () => {
        expect(addOnMomentAllows(EnumAddOnMoment.BEFORE_PICKUP, EnumDeliveryStatus.PICKED_UP, false)).toBe(false)
        expect(addOnMomentAllows(EnumAddOnMoment.BEFORE_PICKUP, EnumDeliveryStatus.ON_THE_WAY, false)).toBe(false)
        expect(
          addOnMomentAllows(EnumAddOnMoment.BEFORE_PICKUP, EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION, false)
        ).toBe(false)
        expect(addOnMomentAllows(EnumAddOnMoment.BEFORE_PICKUP, EnumDeliveryStatus.DROPPED_OFF, false)).toBe(false)
      })
    })

    describe('BEFORE_DROPOFF moment', () => {
      it('allows all ongoing statuses up to dropoff', () => {
        expect(addOnMomentAllows(EnumAddOnMoment.BEFORE_DROPOFF, EnumDeliveryStatus.ACCEPTED, false)).toBe(true)
        expect(addOnMomentAllows(EnumAddOnMoment.BEFORE_DROPOFF, EnumDeliveryStatus.DISPATCHED, false)).toBe(true)
        expect(
          addOnMomentAllows(EnumAddOnMoment.BEFORE_DROPOFF, EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, false)
        ).toBe(true)
        expect(addOnMomentAllows(EnumAddOnMoment.BEFORE_DROPOFF, EnumDeliveryStatus.PICKED_UP, false)).toBe(true)
        expect(addOnMomentAllows(EnumAddOnMoment.BEFORE_DROPOFF, EnumDeliveryStatus.ON_THE_WAY, false)).toBe(true)
        expect(
          addOnMomentAllows(
            EnumAddOnMoment.BEFORE_DROPOFF,
            EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
            false
          )
        ).toBe(true)
      })

      it('refuses completed or non-ongoing statuses', () => {
        expect(addOnMomentAllows(EnumAddOnMoment.BEFORE_DROPOFF, EnumDeliveryStatus.DROPPED_OFF, false)).toBe(false)
        expect(addOnMomentAllows(EnumAddOnMoment.BEFORE_DROPOFF, EnumDeliveryStatus.CANCELED, false)).toBe(false)
        expect(addOnMomentAllows(EnumAddOnMoment.BEFORE_DROPOFF, EnumDeliveryStatus.CREATED, false)).toBe(false)
      })
    })

    describe('SAME_RESTAURANT moment', () => {
      it('allows before pickup when sameRestaurant is true', () => {
        expect(addOnMomentAllows(EnumAddOnMoment.SAME_RESTAURANT, EnumDeliveryStatus.ACCEPTED, true)).toBe(true)
        expect(addOnMomentAllows(EnumAddOnMoment.SAME_RESTAURANT, EnumDeliveryStatus.DISPATCHED, true)).toBe(true)
        expect(
          addOnMomentAllows(EnumAddOnMoment.SAME_RESTAURANT, EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, true)
        ).toBe(true)
      })

      it('refuses before pickup when sameRestaurant is false', () => {
        expect(addOnMomentAllows(EnumAddOnMoment.SAME_RESTAURANT, EnumDeliveryStatus.ACCEPTED, false)).toBe(false)
        expect(addOnMomentAllows(EnumAddOnMoment.SAME_RESTAURANT, EnumDeliveryStatus.DISPATCHED, false)).toBe(false)
        expect(
          addOnMomentAllows(
            EnumAddOnMoment.SAME_RESTAURANT,
            EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
            false
          )
        ).toBe(false)
      })

      it('refuses after pickup even when sameRestaurant is true', () => {
        expect(addOnMomentAllows(EnumAddOnMoment.SAME_RESTAURANT, EnumDeliveryStatus.PICKED_UP, true)).toBe(false)
        expect(addOnMomentAllows(EnumAddOnMoment.SAME_RESTAURANT, EnumDeliveryStatus.ON_THE_WAY, true)).toBe(false)
      })
    })
  })

  describe('addOnRefusal (AC-2)', () => {
    const baseCurrent: StackCandidate = {
      id: 'job-1',
      partnerId: 'partner-1',
      pickupLocationId: 'loc-pickup-1',
      boxUnits: 40,
      orderReference: 'ref-1',
      legCount: null,
      foodReadyAt: null,
    }

    const baseNew: StackCandidate = {
      id: 'del-new',
      partnerId: 'partner-1',
      pickupLocationId: 'loc-pickup-1',
      boxUnits: 40,
      orderReference: 'ref-2',
      legCount: null,
      foodReadyAt: null,
    }

    it('refuses pairing with itself', () => {
      expect(addOnRefusal(baseCurrent, { ...baseCurrent }, false)).toBe('the same delivery')
    })

    it('refuses when combined boxUnits exceeds 100', () => {
      expect(addOnRefusal({ ...baseCurrent, boxUnits: 60 }, { ...baseNew, boxUnits: 50 }, false)).toBe(
        'they do not fit in one box together'
      )
    })

    it('allows when combined boxUnits is exactly 100', () => {
      expect(addOnRefusal({ ...baseCurrent, boxUnits: 60 }, { ...baseNew, boxUnits: 40 }, false)).toBeNull()
    })

    it('refuses pairing two legs of the same order', () => {
      expect(
        addOnRefusal(
          { ...baseCurrent, orderReference: 'shared-order', legCount: 2 },
          { ...baseNew, orderReference: 'shared-order', legCount: 2 },
          false
        )
      ).toBe('two legs of one order')
    })

    it('refuses different restaurants when neither has food ready and food is not yet picked up', () => {
      expect(
        addOnRefusal(
          { ...baseCurrent, partnerId: 'partner-A', foodReadyAt: null },
          { ...baseNew, partnerId: 'partner-B', foodReadyAt: null },
          false
        )
      ).toBe('two restaurants, and not both marked ready')
    })

    it('allows different restaurants when food is already picked up (picked up food counts as ready) and new order is ready', () => {
      // currentPickedUp = true counts current food as ready, so if new order has foodReadyAt, it is allowed
      expect(
        addOnRefusal(
          { ...baseCurrent, partnerId: 'partner-A', foodReadyAt: null },
          { ...baseNew, partnerId: 'partner-B', foodReadyAt: readyDate },
          true
        )
      ).toBeNull()
    })

    it('refuses different restaurants even if food is picked up when new order is NOT ready', () => {
      expect(
        addOnRefusal(
          { ...baseCurrent, partnerId: 'partner-A', foodReadyAt: null },
          { ...baseNew, partnerId: 'partner-B', foodReadyAt: null },
          true
        )
      ).toBe('two restaurants, and not both marked ready')
    })
  })

  describe('bestAddOnSequence (AC-2, AC-6, cross check 5)', () => {
    // 5-point matrix: [RIDER, FIRST_PICKUP, SECOND_PICKUP, FIRST_DROPOFF, SECOND_DROPOFF]
    // Indices: 0: RIDER, 1: FIRST_PICKUP (job), 2: SECOND_PICKUP (new), 3: FIRST_DROPOFF (job), 4: SECOND_DROPOFF (new)
    const baseSeconds = [
      [0, 60, 120, 300, 360],
      [60, 0, 80, 240, 300],
      [120, 80, 0, 200, 240],
      [300, 240, 200, 0, 100],
      [360, 300, 240, 100, 0],
    ]

    const baseMetres = [
      [0, 500, 1000, 2500, 3000],
      [500, 0, 600, 2000, 2500],
      [1000, 600, 0, 1800, 2000],
      [2500, 2000, 1800, 0, 800],
      [3000, 2500, 2000, 800, 0],
    ]

    const nowMs = 1000000

    it('finds best sequence before pickup (4 stops in sequence) and works out extra time and distance', () => {
      const input: AddOnSequenceInput = {
        currentId: 'job-1',
        newId: 'new-2',
        seconds: baseSeconds,
        metres: baseMetres,
        currentPickedUp: false,
        currentReadyAtMs: null,
        newReadyAtMs: null,
        nowMs,
        delayLimitSeconds: 600, // 10 min
      }

      const result = bestAddOnSequence(input)

      expect(result).not.toBeNull()
      expect(result!.stops).toHaveLength(4)
      expect(result!.stops[0]).toEqual({ deliveryId: 'job-1', stop: 'PICKUP' })
      expect(result!.extraSeconds).toBeGreaterThan(0)
      expect(result!.extraMetres).toBeGreaterThan(0)
      expect(result!.delaySeconds['job-1']).toBeLessThanOrEqual(600)
      expect(result!.delaySeconds['new-2']).toBeLessThanOrEqual(600)
    })

    it('finds best sequence when food is already picked up (3 remaining stops, with first pickup prepended as done)', () => {
      const input: AddOnSequenceInput = {
        currentId: 'job-1',
        newId: 'new-2',
        seconds: baseSeconds,
        metres: baseMetres,
        currentPickedUp: true,
        currentReadyAtMs: null,
        newReadyAtMs: null,
        nowMs,
        delayLimitSeconds: 600,
      }

      const result = bestAddOnSequence(input)

      expect(result).not.toBeNull()
      // Stored list always has 4 stops; job's pickup is first (already done)
      expect(result!.stops).toHaveLength(4)
      expect(result!.stops[0]).toEqual({ deliveryId: 'job-1', stop: 'PICKUP' })
      expect(result!.delaySeconds['job-1']).toBeLessThanOrEqual(600)
      expect(result!.delaySeconds['new-2']).toBeLessThanOrEqual(600)
    })

    it('returns null when any order exceeds delayLimitSeconds (AC-2)', () => {
      const input: AddOnSequenceInput = {
        currentId: 'job-1',
        newId: 'new-2',
        seconds: baseSeconds,
        metres: baseMetres,
        currentPickedUp: false,
        currentReadyAtMs: null,
        newReadyAtMs: null,
        nowMs,
        delayLimitSeconds: 0, // 0 sec limit: adding a stop will cause a delay, so no sequence passes
      }

      const result = bestAddOnSequence(input)
      expect(result).toBeNull()
    })

    it('returns null when OSRM road figures are missing/null (cross check 5: with OSRM down, no add on is offered)', () => {
      // Missing route between rider and second pickup
      const brokenSeconds: (number | null)[][] = baseSeconds.map((row) => [...row])
      brokenSeconds[POINT.RIDER]![POINT.SECOND_PICKUP] = null

      const input: AddOnSequenceInput = {
        currentId: 'job-1',
        newId: 'new-2',
        seconds: brokenSeconds,
        metres: baseMetres,
        currentPickedUp: false,
        currentReadyAtMs: null,
        newReadyAtMs: null,
        nowMs,
        delayLimitSeconds: 600,
      }

      const result = bestAddOnSequence(input)
      expect(result).toBeNull()
    })
  })

  describe('isAddOnOffer & addOnJobIdOf', () => {
    const validAddOnStops = [
      { deliveryId: 'job-1', stop: 'PICKUP' },
      { deliveryId: 'add-on-1', stop: 'PICKUP' },
      { deliveryId: 'job-1', stop: 'DROPOFF' },
      { deliveryId: 'add-on-1', stop: 'DROPOFF' },
    ]

    it('returns true for an open add on offer', () => {
      const delivery = {
        id: 'add-on-1',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-1',
        offerGroupId: null,
        stopSequence: validAddOnStops,
      }
      expect(isAddOnOffer(delivery)).toBe(true)
      expect(addOnJobIdOf(delivery)).toBe('job-1')
    })

    it('returns false when delivery has an offerGroupId (it is a stack, not an open add on)', () => {
      const stackDelivery = {
        id: 'del-1',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-1',
        offerGroupId: 'group-1',
        stopSequence: validAddOnStops,
      }
      expect(isAddOnOffer(stackDelivery)).toBe(false)
    })

    it('returns false when delivery has no stopSequence (it is a single offer)', () => {
      const singleDelivery = {
        id: 'del-single',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-1',
        offerGroupId: null,
        stopSequence: null,
      }
      expect(isAddOnOffer(singleDelivery)).toBe(false)
      expect(addOnJobIdOf(singleDelivery)).toBeNull()
    })

    it('returns false when status is not ASSIGNING_COURIER', () => {
      const acceptedDelivery = {
        id: 'del-accepted',
        status: EnumDeliveryStatus.ACCEPTED,
        matchedCourierId: 'courier-1',
        offerGroupId: null,
        stopSequence: validAddOnStops,
      }
      expect(isAddOnOffer(acceptedDelivery)).toBe(false)
    })

    it('returns false when matchedCourierId is null', () => {
      const unassignedDelivery = {
        id: 'del-unassigned',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        offerGroupId: null,
        stopSequence: validAddOnStops,
      }
      expect(isAddOnOffer(unassignedDelivery)).toBe(false)
    })
  })

  describe('addOnFigures (AC-6, AC-10)', () => {
    it('converts extra metres to km (1 decimal) and seconds to whole minutes', () => {
      expect(addOnFigures(2145, 430)).toEqual({ extraKm: 2.1, extraMinutes: 7 })
      expect(addOnFigures(1000, 60)).toEqual({ extraKm: 1.0, extraMinutes: 1 })
      expect(addOnFigures(50, 20)).toEqual({ extraKm: 0.1, extraMinutes: 0 })
      expect(addOnFigures(0, 0)).toEqual({ extraKm: 0, extraMinutes: 0 })
    })

    it('returns null if either metres or seconds is null', () => {
      expect(addOnFigures(null, 100)).toBeNull()
      expect(addOnFigures(1000, null)).toBeNull()
      expect(addOnFigures(null, null)).toBeNull()
    })
  })

  describe('addOnJobStatuses (review fix, row 81)', () => {
    it('returns DELIVERY_ONGOING_STATUSES for BEFORE_DROPOFF', () => {
      expect(addOnJobStatuses(EnumAddOnMoment.BEFORE_DROPOFF)).toEqual(DELIVERY_ONGOING_STATUSES)
    })

    it('returns before pickup statuses for BEFORE_PICKUP', () => {
      expect(addOnJobStatuses(EnumAddOnMoment.BEFORE_PICKUP)).toEqual([
        EnumDeliveryStatus.ACCEPTED,
        EnumDeliveryStatus.DISPATCHED,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      ])
    })

    it('returns before pickup statuses for SAME_RESTAURANT', () => {
      expect(addOnJobStatuses(EnumAddOnMoment.SAME_RESTAURANT)).toEqual([
        EnumDeliveryStatus.ACCEPTED,
        EnumDeliveryStatus.DISPATCHED,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      ])
    })
  })

  describe('describeAddOn (Value 1, cross check 2, decision 81.16)', () => {
    const mockSequence = {
      stops: [
        { deliveryId: 'job-1', stop: 'PICKUP' as const },
        { deliveryId: 'new-2', stop: 'PICKUP' as const },
        { deliveryId: 'job-1', stop: 'DROPOFF' as const },
        { deliveryId: 'new-2', stop: 'DROPOFF' as const },
      ],
      delaySeconds: { 'job-1': 120, 'new-2': 180 },
      totalSeconds: 600,
      extraSeconds: 420,
      extraMetres: 2100,
      secondsToNewPickup: 150,
    }

    it('describes add on with job ID, figures, stops, and no free rider found when not carrying food', () => {
      const description = describeAddOn('job-1', mockSequence, false, false)
      expect(description).toContain('offered as one more order on the way, added to the job of delivery job-1')
      expect(description).toContain('(+2.1 km, +7 min)')
      expect(description).not.toContain('twice the time to answer')
      expect(description).toContain('; no free rider was found')
    })

    it('includes calm notice when carrying food (cross check 2)', () => {
      const description = describeAddOn('job-1', mockSequence, true, false)
      expect(description).toContain('offered as one more order on the way, added to the job of delivery job-1')
      expect(description).toContain('; the rider carries food, so twice the time to answer and no insistent ring')
      expect(description).toContain('; no free rider was found')
    })

    it('describes when free rider was found under whenever it fits (decision 81.16)', () => {
      const description = describeAddOn('job-1', mockSequence, false, true)
      expect(description).toContain('; a free rider was found, and the co-op offers an add on whenever it fits')
    })
  })

  describe('ADD_ON_NOT_AUTOMATIC_SENTENCE (AC-8)', () => {
    it('matches the exact sentence required by AC-8', () => {
      expect(ADD_ON_NOT_AUTOMATIC_SENTENCE).toBe(
        'One more order on the way is never accepted automatically. Open it and choose.'
      )
    })
  })
})
