import { FairnessCandidate, FairnessWeights, scoreCandidates } from './fairness-score'

// Spec 0049 (row 79; AC-2, cross check 5 and 6): the shift factor in the fairness score. Written from
// the spec. With no `shift` weight (shifts off, or another matcher) the score is spec 0044's, unchanged.
// With one, the factor is a fixed 0 (on a booked shift) or 1, never scaled across the riders, and its
// weight joins the sum the score is divided by.
describe('scoreCandidates and the shift weight (spec 0049: AC-2, cross check 5 and 6)', () => {
  function rider(courierId: string, overrides: Partial<FairnessCandidate> = {}): FairnessCandidate {
    return {
      courierId,
      straightMetres: 500,
      roadSeconds: 100,
      roadEstimated: false,
      centsPerHour: 1000,
      earningsAssumed: false,
      earningsEqual: false,
      waitingSeconds: 600,
      ...overrides,
    }
  }

  const core: FairnessWeights = { roadTime: 50, earnings: 30, waiting: 20 }

  // Two riders who differ only in road time: `near` scales to 0 and `far` to 1 on that factor.
  const near = rider('near', { roadSeconds: 100 })
  const far = rider('far', { roadSeconds: 700 })

  describe('no shift weight (shifts off): the score of spec 0044, unchanged', () => {
    test('the score is the weighted average over the three weights only', () => {
      const scored = scoreCandidates([near, far], core)
      expect(scored.map((c) => [c.courierId, c.score])).toEqual([
        ['near', 0],
        ['far', 0.5], // 50 * 1 / (50 + 30 + 20)
      ])
    })

    test('no scaled shift value is recorded', () => {
      for (const candidate of scoreCandidates([near, far], core)) {
        expect(Object.keys(candidate.scaled).sort()).toEqual(['earnings', 'roadTime', 'waiting'])
      }
    })

    test('a rider marked onShift scores exactly as the same rider unmarked: order, scores and scaled values', () => {
      const plain = scoreCandidates([near, far], core)
      const marked = scoreCandidates([near, { ...far, onShift: true }], core)
      expect(marked.map((c) => c.courierId)).toEqual(plain.map((c) => c.courierId))
      expect(marked.map((c) => c.score)).toEqual(plain.map((c) => c.score))
      expect(marked.map((c) => c.scaled)).toEqual(plain.map((c) => c.scaled))
      // The far rider did not move up for being on a shift.
      expect(marked[0]!.courierId).toBe('near')
    })

    test('a shift weight of undefined is the same as leaving it out', () => {
      const withUndefined = scoreCandidates([near, { ...far, onShift: true }], { ...core, shift: undefined })
      expect(withUndefined.map((c) => c.score)).toEqual([0, 0.5])
      expect(withUndefined[0]!.scaled).not.toHaveProperty('shift')
    })
  })

  describe('with a shift weight (shifts on)', () => {
    test('the factor is 0 for a rider on a booked shift and 1 for one who is not (or is unmarked)', () => {
      const scored = scoreCandidates([rider('a', { onShift: true }), rider('b', { onShift: false }), rider('c')], {
        ...core,
        shift: 40,
      })
      const byId = Object.fromEntries(scored.map((c) => [c.courierId, c.scaled.shift]))
      expect(byId).toEqual({ a: 0, b: 1, c: 1 })
    })

    test('it is never scaled across the riders: when nobody is on a shift every rider gets 1, not 0', () => {
      const scored = scoreCandidates([rider('a', { onShift: false }), rider('b', { onShift: false })], {
        ...core,
        shift: 40,
      })
      // A min to max scaling would call all equal riders 0 (the dead band rule of the other factors).
      expect(scored.map((c) => c.scaled.shift)).toEqual([1, 1])
      // 40 * 1 / (50 + 30 + 20 + 40)
      expect(scored[0]!.score).toBeCloseTo(40 / 140, 10)
      expect(scored[1]!.score).toBeCloseTo(40 / 140, 10)
    })

    test('when everybody is on a shift every rider gets 0', () => {
      const scored = scoreCandidates([rider('a', { onShift: true }), rider('b', { onShift: true })], {
        ...core,
        shift: 40,
      })
      expect(scored.map((c) => c.scaled.shift)).toEqual([0, 0])
      expect(scored.map((c) => c.score)).toEqual([0, 0])
    })

    test('the shift weight is in the sum the score is divided by', () => {
      // far: on a shift, worst on road time. near: not on a shift, best on everything else.
      const scored = scoreCandidates([near, { ...far, onShift: true }], { ...core, shift: 100 })
      const byId = Object.fromEntries(scored.map((c) => [c.courierId, c.score]))
      // far: (50 * 1 + 100 * 0) / 200. near: (50 * 0 + 100 * 1) / 200.
      expect(byId.far).toBeCloseTo(0.25, 10)
      expect(byId.near).toBeCloseTo(0.5, 10)
    })

    test('Done when: a rider on a booked shift who lost at weight 0 wins at weight 100', () => {
      const booked = { ...far, onShift: true }
      const notBooked = { ...near, onShift: false }
      expect(scoreCandidates([notBooked, booked], { ...core, shift: 0 })[0]!.courierId).toBe('near')
      expect(scoreCandidates([notBooked, booked], { ...core, shift: 100 })[0]!.courierId).toBe('far')
    })

    test('weight 0 (the default): recorded as a factor, and it changes no score and no place', () => {
      const candidates = [near, { ...far, onShift: true }, rider('mid', { roadSeconds: 400, onShift: false })]
      const off = scoreCandidates(candidates, core)
      const zero = scoreCandidates(candidates, { ...core, shift: 0 })
      expect(zero.map((c) => c.courierId)).toEqual(off.map((c) => c.courierId))
      expect(zero.map((c) => c.score)).toEqual(off.map((c) => c.score))
      expect(zero.map((c) => c.scaled.shift)).toEqual([1, 1, 0])
    })

    test('with only the shift weight above 0 the score is the factor itself', () => {
      const scored = scoreCandidates([near, { ...far, onShift: true }], {
        roadTime: 0,
        earnings: 0,
        waiting: 0,
        shift: 100,
      })
      expect(scored.map((c) => [c.courierId, c.score])).toEqual([
        ['far', 0],
        ['near', 1],
      ])
    })

    test('every weight 0, shift included, gives 0 for all and never NaN', () => {
      const scored = scoreCandidates([near, { ...far, onShift: true }], {
        roadTime: 0,
        earnings: 0,
        waiting: 0,
        shift: 0,
      })
      expect(scored.map((c) => c.score)).toEqual([0, 0])
    })

    // Cross check 6: a fixed 0 or 1, so the weight moves a score by the same amount every time, however
    // close or far apart the other riders are.
    test.each([
      ['riders 1 s apart', 101],
      ['riders 10 minutes apart', 700],
      ['riders an hour apart', 3700],
    ])('being on a shift lowers a score by shift / sum of weights, with %s', (_name, otherRoadSeconds) => {
      const other = rider('other', { roadSeconds: otherRoadSeconds, onShift: false })
      const weights = { ...core, shift: 25 }
      const scoreOf = (onShift: boolean) =>
        scoreCandidates([rider('me', { onShift }), other], weights).find((c) => c.courierId === 'me')!.score
      expect(scoreOf(false) - scoreOf(true)).toBeCloseTo(25 / 125, 10)
    })

    test('a tie on the score still goes to the shorter road time', () => {
      const scored = scoreCandidates(
        [rider('b', { roadSeconds: 130, onShift: true }), rider('a', { roadSeconds: 100, onShift: true })],
        { ...core, shift: 50 }
      )
      // Both inside the 60 s road dead band, both on a shift: equal scores.
      expect(scored[0]!.score).toBe(scored[1]!.score)
      expect(scored.map((c) => c.courierId)).toEqual(['a', 'b'])
    })

    test('the scored rider keeps its onShift mark for the record', () => {
      const scored = scoreCandidates([{ ...near, onShift: true }], { ...core, shift: 10 })
      expect(scored[0]!.onShift).toBe(true)
    })
  })
})
