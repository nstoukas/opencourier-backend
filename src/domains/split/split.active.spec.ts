import { BoxSize } from '@prisma/types'
import {
  SPLIT_SENTENCES,
  cleanLegs,
  legNumbersAfterSplit,
  legsText,
  orderReferenceForSplit,
  splitLeaveFrom,
  splitLegsProblem,
  splitWaitMinutes,
} from './split'

// Spec 0047 (row 11): the pure rules of a split at pickup. No database, no mocks.
describe('split at pickup rules (spec 0047)', () => {
  const box = (boxSize: string) => ({ boxSize })

  describe('splitLegsProblem (AC-1, AC-4: 2 to 4 boxes, a known size each)', () => {
    it.each([2, 3, 4])('accepts %i boxes with a known size each', (count) => {
      const legs = Array.from({ length: count }, () => box('MEDIUM'))
      expect(splitLegsProblem(legs)).toBeNull()
    })

    it('accepts every one of the three sizes', () => {
      expect(splitLegsProblem([box('SMALL'), box('MEDIUM'), box('LARGE')])).toBeNull()
    })

    it('refuses one box: that is not a split', () => {
      expect(splitLegsProblem([box('LARGE')])).toEqual(expect.any(String))
    })

    it('refuses no boxes at all', () => {
      expect(splitLegsProblem([])).toEqual(expect.any(String))
    })

    it('refuses five boxes: an order has at most 4 legs', () => {
      expect(splitLegsProblem(Array.from({ length: 5 }, () => box('SMALL')))).toEqual(expect.any(String))
    })

    it.each([
      ['an unknown size', [box('LARGE'), box('HUGE')]],
      ['a lower case size', [box('LARGE'), box('small')]],
      ['a box with no size', [box('LARGE'), {}]],
      ['a null box', [box('LARGE'), null]],
      ['a number for a size', [box('LARGE'), { boxSize: 3 }]],
    ])('refuses %s', (_name, legs) => {
      expect(splitLegsProblem(legs)).toEqual(expect.any(String))
    })

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a string', 'LARGE,SMALL'],
      ['an object', { 0: box('LARGE'), 1: box('SMALL'), length: 2 }],
    ])('refuses legs sent as %s, not as a list', (_name, legs) => {
      expect(splitLegsProblem(legs)).toEqual(expect.any(String))
    })
  })

  describe('cleanLegs', () => {
    it('keeps only the size of each box, so nothing else a client sent is stored', () => {
      const dirty = [
        { boxSize: BoxSize.LARGE, price: 9999, courierId: 'someone-else' },
        { boxSize: BoxSize.SMALL, legNumber: 7 },
      ] as any
      expect(cleanLegs(dirty)).toEqual([{ boxSize: 'LARGE' }, { boxSize: 'SMALL' }])
    })
  })

  describe('legsText (the proposal named on the record, AC-1)', () => {
    it('words two boxes as "2 boxes: Large and Small"', () => {
      expect(legsText([{ boxSize: BoxSize.LARGE }, { boxSize: BoxSize.SMALL }])).toBe('2 boxes: Large and Small')
    })

    it('words four boxes with commas and one "and"', () => {
      expect(
        legsText([
          { boxSize: BoxSize.LARGE },
          { boxSize: BoxSize.MEDIUM },
          { boxSize: BoxSize.SMALL },
          { boxSize: BoxSize.SMALL },
        ])
      ).toBe('4 boxes: Large, Medium, Small and Small')
    })
  })

  describe('splitWaitMinutes (AC-3: whole minutes, rounded down, no free minutes)', () => {
    const flaggedAt = new Date('2026-11-21T12:00:00.000Z')
    const after = (seconds: number) => new Date(flaggedAt.getTime() + seconds * 1000)

    it('pays from the very first whole minute: there are no free minutes', () => {
      expect(splitWaitMinutes(flaggedAt, after(60))).toBe(1)
    })

    it('rounds down: 59 seconds is 0 minutes', () => {
      expect(splitWaitMinutes(flaggedAt, after(59))).toBe(0)
    })

    it('rounds down: 2 minutes 59 seconds is 2 minutes', () => {
      expect(splitWaitMinutes(flaggedAt, after(179))).toBe(2)
    })

    it('counts 10 whole minutes as 10', () => {
      expect(splitWaitMinutes(flaggedAt, after(600))).toBe(10)
    })

    it('is never below 0, even if the answer is stamped before the flag', () => {
      expect(splitWaitMinutes(flaggedAt, after(-120))).toBe(0)
    })
  })

  describe('splitLeaveFrom (AC-2, AC-8: the moment the rider may leave)', () => {
    it('is the flag time plus the co-op setting, in minutes', () => {
      const flaggedAt = new Date('2026-11-21T12:00:00.000Z')
      expect(splitLeaveFrom(flaggedAt, 10).toISOString()).toBe('2026-11-21T12:10:00.000Z')
      expect(splitLeaveFrom(flaggedAt, 1).toISOString()).toBe('2026-11-21T12:01:00.000Z')
      expect(splitLeaveFrom(flaggedAt, 60).toISOString()).toBe('2026-11-21T13:00:00.000Z')
    })
  })

  describe('legNumbersAfterSplit (AC-5, cross check 8)', () => {
    const single = { legNumber: null, legCount: null }

    it('a single delivery split in 2 becomes leg 1 of 2, and the new leg is 2', () => {
      expect(legNumbersAfterSplit(single, [], 2)).toEqual({ keptNumber: 1, newNumbers: [2], legCount: 2 })
    })

    it('a single delivery split in 3 becomes leg 1 of 3, new legs 2 and 3', () => {
      expect(legNumbersAfterSplit(single, [], 3)).toEqual({ keptNumber: 1, newNumbers: [2, 3], legCount: 3 })
    })

    it('a single delivery split in 4 becomes leg 1 of 4, new legs 2, 3 and 4', () => {
      expect(legNumbersAfterSplit(single, [], 4)).toEqual({ keptNumber: 1, newNumbers: [2, 3, 4], legCount: 4 })
    })

    it('refuses a single delivery split in 5: past the limit of 4 legs', () => {
      expect(legNumbersAfterSplit(single, [], 5)).toBeNull()
    })

    it('leg 1 of 2 split again in 2: it keeps number 1, the new leg is 3, and the order has 3 legs', () => {
      expect(legNumbersAfterSplit({ legNumber: 1, legCount: 2 }, [1, 2], 2)).toEqual({
        keptNumber: 1,
        newNumbers: [3],
        legCount: 3,
      })
    })

    it('leg 2 of 2 split again in 3: it keeps number 2, the new legs are 3 and 4, and the order has 4 legs', () => {
      expect(legNumbersAfterSplit({ legNumber: 2, legCount: 2 }, [1, 2], 3)).toEqual({
        keptNumber: 2,
        newNumbers: [3, 4],
        legCount: 4,
      })
    })

    it('leg 2 of 3 split in 2: the new leg takes the next free number, 4, never a number a sibling holds', () => {
      const result = legNumbersAfterSplit({ legNumber: 2, legCount: 3 }, [1, 2, 3], 2)
      expect(result).toEqual({ keptNumber: 2, newNumbers: [4], legCount: 4 })
    })

    it('refuses a leg of 3 split in 3: that would be 5 legs in all', () => {
      expect(legNumbersAfterSplit({ legNumber: 1, legCount: 3 }, [1, 2, 3], 3)).toBeNull()
    })

    it('refuses any further split of an order that already has 4 legs', () => {
      expect(legNumbersAfterSplit({ legNumber: 4, legCount: 4 }, [1, 2, 3, 4], 2)).toBeNull()
    })

    it('exactly 4 legs in all is still allowed (the limit is inclusive)', () => {
      expect(legNumbersAfterSplit({ legNumber: 1, legCount: 3 }, [1, 2, 3], 2)).not.toBeNull()
      expect(legNumbersAfterSplit({ legNumber: 1, legCount: 2 }, [1, 2], 3)).not.toBeNull()
    })

    it('never hands out a number twice across the kept leg, its siblings and the new legs', () => {
      const siblings = [1, 2]
      const result = legNumbersAfterSplit({ legNumber: 1, legCount: 2 }, siblings, 3)
      const all = [...siblings, ...(result?.newNumbers ?? [])]
      expect(new Set(all).size).toBe(all.length)
      expect(all.sort()).toEqual([1, 2, 3, 4])
    })
  })

  describe('orderReferenceForSplit (AC-5: the reference the legs share)', () => {
    it("a single delivery with no reference takes its own quote id", () => {
      expect(orderReferenceForSplit(null, 'quote-1', false)).toBe('quote-1')
      expect(orderReferenceForSplit('   ', 'quote-1', false)).toBe('quote-1')
    })

    it("a single delivery with the restaurant's reference uses spec 0046's group rule: typed#quoteId", () => {
      expect(orderReferenceForSplit('ORDER-77', 'quote-1', false)).toBe('ORDER-77#quote-1')
    })

    it('a delivery that is already a leg keeps its order reference', () => {
      expect(orderReferenceForSplit('ORDER-77#quote-1', 'quote-9', true)).toBe('ORDER-77#quote-1')
    })
  })

  describe('the sentences a rider reads', () => {
    it('says one minute, not one minutes', () => {
      expect(SPLIT_SENTENCES.tooSoon(1)).toContain('1 minute ')
      expect(SPLIT_SENTENCES.tooSoon(10)).toContain('10 minutes')
    })
  })
})
