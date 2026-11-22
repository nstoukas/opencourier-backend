import { whyYouFrom } from './why-you'

// Spec 0045 (AC-1, AC-5, cross check 1 and 3; decision 14.2): what a rider may read of the reason an
// offer came to them. Written from the spec: an allow list of the rider's own raw values per strategy.
describe('whyYouFrom (spec 0045: AC-1, AC-5, cross check 1 and 3)', () => {
  // A stored FAIRNESS reason as spec 0044 writes it, plus keys a rider must never read.
  const fairnessStored = {
    strategy: 'FAIRNESS',
    kind: 'SINGLE',
    values: {
      roadSeconds: 480,
      roadEstimated: false,
      centsPerHour: 940,
      earningsAssumed: false,
      earningsEqual: false,
      waitingSeconds: 1320,
      straightMetres: 1200,
      // Never for a rider (cross check 1): these tell them their place among the candidates.
      scaled: { roadTime: 0, earnings: 1, waiting: 0.5 },
      score: 0.42,
      candidateCount: 5,
      ridersInRange: 7,
      // A key added later must not reach a rider by accident.
      somethingNew: 'surprise',
      courierId: 'courier-other-1',
    },
    weights: { roadTime: 50, earnings: 30, waiting: 20 },
  }

  test('null in gives null', () => {
    expect(whyYouFrom(null)).toBeNull()
  })

  test('FAIRNESS keeps exactly the seven own raw values and carries strategy and kind', () => {
    const result = whyYouFrom(fairnessStored)

    expect(result).not.toBeNull()
    expect(result!.strategy).toBe('FAIRNESS')
    expect(result!.kind).toBe('SINGLE')
    expect(result!.values).toEqual({
      roadSeconds: 480,
      roadEstimated: false,
      centsPerHour: 940,
      earningsAssumed: false,
      earningsEqual: false,
      waitingSeconds: 1320,
      straightMetres: 1200,
    })
  })

  test.each(['scaled', 'score', 'candidateCount', 'ridersInRange', 'somethingNew', 'courierId'])(
    'FAIRNESS drops %s from the values',
    (key) => {
      const result = whyYouFrom(fairnessStored)
      expect(Object.keys(result!.values)).not.toContain(key)
    }
  )

  test('the result has only strategy, kind, values, weights and estimated, even when the row carries more', () => {
    const fullRow = {
      ...fairnessStored,
      id: 'reason-1',
      courierId: 'courier-me',
      score: 0.42,
      candidateCount: 5,
      ridersInRange: 7,
      candidates: [{ courierId: 'courier-other-1', centsPerHour: 1500, score: 0.9 }],
    }
    const result = whyYouFrom(fullRow)
    expect(Object.keys(result!).sort()).toEqual(['estimated', 'kind', 'strategy', 'values', 'weights'])
    expect(JSON.stringify(result)).not.toContain('courier-other-1')
  })

  test('NEAREST_COURIER keeps only straightMetres and roadSeconds', () => {
    const result = whyYouFrom({
      strategy: 'NEAREST_COURIER',
      kind: 'SINGLE',
      values: {
        straightMetres: 1200,
        roadSeconds: 300,
        centsPerHour: 940,
        waitingSeconds: 60,
        score: 1,
        candidateCount: 3,
        ridersInRange: 4,
      },
      weights: null,
    })
    expect(result!.strategy).toBe('NEAREST_COURIER')
    expect(result!.values).toEqual({ straightMetres: 1200, roadSeconds: 300 })
    expect(result!.weights).toEqual({})
  })

  test('COURIER_SENIORITY keeps only memberSince', () => {
    const result = whyYouFrom({
      strategy: 'COURIER_SENIORITY',
      kind: 'SINGLE',
      values: { memberSince: '2024-03-01T00:00:00.000Z', straightMetres: 900, candidateCount: 4 },
      weights: null,
    })
    expect(result!.values).toEqual({ memberSince: '2024-03-01T00:00:00.000Z' })
  })

  test('ADMIN keeps nothing, not the adminUserId', () => {
    const result = whyYouFrom({
      strategy: 'ADMIN',
      kind: 'SINGLE',
      values: { adminUserId: 'admin-user-7' },
      weights: null,
    })
    expect(result).toEqual({ strategy: 'ADMIN', kind: 'SINGLE', values: {}, weights: {}, estimated: false })
    expect(JSON.stringify(result)).not.toContain('admin-user-7')
  })

  test('STATIC keeps nothing', () => {
    const result = whyYouFrom({
      strategy: 'STATIC',
      kind: 'SINGLE',
      values: { adminUserId: 'admin-user-7', straightMetres: 10, roadSeconds: 5, memberSince: '2024-01-01' },
      weights: null,
    })
    expect(result!.values).toEqual({})
  })

  test('a strategy the allow list does not know keeps no values', () => {
    const result = whyYouFrom({
      strategy: 'SOMETHING_FUTURE',
      kind: 'SINGLE',
      values: { roadSeconds: 480, score: 1 },
      weights: null,
    })
    expect(result!.values).toEqual({})
  })

  // Review ruling 2026-11-21 (decision 14.5, AC-5): when the rider's pay counted as the co-op average, or
  // counted equal for everyone, the stored centsPerHour is made of other riders' pay (with one qualifying
  // rider, exactly theirs). It is never sent then; the flags say what counted.
  describe("centsPerHour when it is not the rider's own figure (decision 14.5, AC-5)", () => {
    const withValues = (extra: Record<string, unknown>) =>
      whyYouFrom({ ...fairnessStored, values: { ...fairnessStored.values, ...extra } })!

    test('not sent when earningsAssumed is true: the stored figure is the mean of the other riders', () => {
      // 1730 stands for the one qualifying colleague's exact rate, stored as this rider's assumed figure.
      const result = withValues({ earningsAssumed: true, centsPerHour: 1730 })
      expect(result.values).not.toHaveProperty('centsPerHour')
      expect(JSON.stringify(result)).not.toContain('1730')
      // The flag still says what counted, and the other own values stay.
      expect(result.values.earningsAssumed).toBe(true)
      expect(result.values).toEqual({
        roadSeconds: 480,
        roadEstimated: false,
        earningsAssumed: true,
        earningsEqual: false,
        waitingSeconds: 1320,
        straightMetres: 1200,
      })
    })

    test('not sent when earningsEqual is true', () => {
      const result = withValues({ earningsEqual: true, centsPerHour: 1730 })
      expect(result.values).not.toHaveProperty('centsPerHour')
      expect(JSON.stringify(result)).not.toContain('1730')
      expect(result.values.earningsEqual).toBe(true)
      expect(result.values.earningsAssumed).toBe(false)
    })

    test('not sent when both flags are true, not even a centsPerHour of 0', () => {
      const result = withValues({ earningsAssumed: true, earningsEqual: true, centsPerHour: 0 })
      expect(result.values).not.toHaveProperty('centsPerHour')
    })

    test("sent when both flags are false: it is the rider's own rate", () => {
      const result = withValues({ earningsAssumed: false, earningsEqual: false, centsPerHour: 940 })
      expect(result.values.centsPerHour).toBe(940)
    })

    test('sent when the flags are missing from the stored values', () => {
      const { earningsAssumed, earningsEqual, ...withoutFlags } = fairnessStored.values
      expect([earningsAssumed, earningsEqual]).toEqual([false, false])
      const result = whyYouFrom({ ...fairnessStored, values: withoutFlags })!
      expect(result.values.centsPerHour).toBe(940)
    })
  })

  describe('weights (cross check 3)', () => {
    test('keeps only the weights above 0, in the order roadTime, earnings, waiting, shift', () => {
      const result = whyYouFrom({
        ...fairnessStored,
        // Stored in another order on purpose, with a zero and an unknown key.
        weights: { shift: 10, waiting: 20, bonus: 99, earnings: 30, roadTime: 50 },
      })
      expect(result!.weights).toEqual({ roadTime: 50, earnings: 30, waiting: 20, shift: 10 })
      expect(Object.keys(result!.weights)).toEqual(['roadTime', 'earnings', 'waiting', 'shift'])
    })

    test('a weight of 0 is left out', () => {
      const result = whyYouFrom({
        ...fairnessStored,
        weights: { waiting: 20, earnings: 0, roadTime: 80, shift: 0 },
      })
      expect(result!.weights).toEqual({ roadTime: 80, waiting: 20 })
      expect(Object.keys(result!.weights)).toEqual(['roadTime', 'waiting'])
    })

    test('no stored weights gives an empty object', () => {
      expect(whyYouFrom({ ...fairnessStored, weights: null })!.weights).toEqual({})
    })
  })

  describe('estimated (spec 0044 AC-2 fallback)', () => {
    test('true when roadEstimated is true', () => {
      const result = whyYouFrom({
        ...fairnessStored,
        values: { ...fairnessStored.values, roadEstimated: true },
      })
      expect(result!.estimated).toBe(true)
      expect(result!.values.roadEstimated).toBe(true)
    })

    test('false when roadEstimated is false', () => {
      expect(whyYouFrom(fairnessStored)!.estimated).toBe(false)
    })

    test('false when roadEstimated is missing or not the boolean true', () => {
      const { roadEstimated, ...withoutFlag } = fairnessStored.values
      expect(roadEstimated).toBe(false)
      expect(whyYouFrom({ ...fairnessStored, values: withoutFlag })!.estimated).toBe(false)
      expect(whyYouFrom({ ...fairnessStored, values: { ...withoutFlag, roadEstimated: 'true' } })!.estimated).toBe(
        false
      )
      expect(whyYouFrom({ ...fairnessStored, values: { ...withoutFlag, roadEstimated: 1 } })!.estimated).toBe(false)
    })
  })

  // Spec 0049 (AC-3): the rider reads whether they were on a booked shift, and the shift weight when it
  // applied. Recorded only while shifts are on.
  describe('spec 0049: onShift and the shift weight', () => {
    const withShift = (onShift: unknown, shift: unknown) => ({
      ...fairnessStored,
      values: { ...fairnessStored.values, onShift, scaled: { roadTime: 0, earnings: 1, waiting: 0.5, shift: 0 } },
      weights: { ...fairnessStored.weights, shift },
    })

    test('keeps onShift: true, and the shift weight when it is above 0', () => {
      const result = whyYouFrom(withShift(true, 40))!
      expect(result.values.onShift).toBe(true)
      expect(result.weights).toEqual({ roadTime: 50, earnings: 30, waiting: 20, shift: 40 })
    })

    test('keeps onShift: false as false, not dropped', () => {
      const result = whyYouFrom(withShift(false, 40))!
      expect(result.values).toHaveProperty('onShift', false)
    })

    test('a shift weight of 0 is not sent (only the weights above 0), while onShift still is', () => {
      const result = whyYouFrom(withShift(true, 0))!
      expect(result.weights).toEqual({ roadTime: 50, earnings: 30, waiting: 20 })
      expect(result.values.onShift).toBe(true)
    })

    test('a reason recorded with shifts off has no onShift and no shift weight', () => {
      const result = whyYouFrom(fairnessStored)!
      expect(result.values).not.toHaveProperty('onShift')
      expect(result.weights).not.toHaveProperty('shift')
    })

    test('the scaled shift value and the score still never reach the rider', () => {
      const result = whyYouFrom(withShift(true, 40))!
      expect(result.values).not.toHaveProperty('scaled')
      expect(result.values).not.toHaveProperty('score')
      expect(JSON.stringify(result)).not.toContain('scaled')
    })

    test.each(['NEAREST_COURIER', 'COURIER_SENIORITY', 'ADMIN', 'STATIC'])(
      'under %s an onShift value is not read (shifts change nothing under another matcher)',
      (strategy) => {
        const result = whyYouFrom({ ...withShift(true, 40), strategy })!
        expect(result.values).not.toHaveProperty('onShift')
      }
    )
  })

  describe('ADD_ON reason (row 81 review fix, decision 81.16)', () => {
    const addOnStored = {
      strategy: 'NEAREST_COURIER',
      kind: 'ADD_ON',
      values: {
        currentDeliveryId: 'job-1',
        extraKm: 1.2,
        extraMinutes: 3,
        roadSecondsToPickup: 150,
        carryingFood: true,
        candidateCount: 4,
        policy: 'WHENEVER_FITS',
        freeRiderFound: true,
      },
      weights: { roadTime: 50 },
    }

    test('keeps only extraKm, extraMinutes, and carryingFood, carrying strategy and kind', () => {
      const result = whyYouFrom(addOnStored)
      expect(result).not.toBeNull()
      expect(result!.strategy).toBe('NEAREST_COURIER')
      expect(result!.kind).toBe('ADD_ON')
      expect(result!.values).toEqual({
        extraKm: 1.2,
        extraMinutes: 3,
        carryingFood: true,
      })
      // An add on has empty weights
      expect(result!.weights).toEqual({})
    })

    test('never reveals freeRiderFound or policy to the rider (decision 81.16, transparency privacy)', () => {
      const result = whyYouFrom(addOnStored)!
      expect(result.values).not.toHaveProperty('freeRiderFound')
      expect(result.values).not.toHaveProperty('policy')
      expect(result.values).not.toHaveProperty('currentDeliveryId')
      expect(result.values).not.toHaveProperty('roadSecondsToPickup')
      expect(result.values).not.toHaveProperty('candidateCount')
      expect(JSON.stringify(result)).not.toContain('WHENEVER_FITS')
    })
  })
})
