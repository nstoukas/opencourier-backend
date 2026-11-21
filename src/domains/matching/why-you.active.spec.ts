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
})
