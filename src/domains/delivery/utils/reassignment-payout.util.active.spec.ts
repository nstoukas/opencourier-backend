import { BadRequestException } from '@nestjs/common'
import { resolveReassignmentPayout } from './reassignment-payout.util'

describe('reassignment-payout.util', () => {
  const defaultMenu: Record<string, number> = {
    FULL_COMPENSATION: 100,
    HALF_COMPENSATION: 50,
    NO_COMPENSATION: 0,
  }

  // Test Plan Case 4: FULL_COMPENSATION (100%)
  test('calculates 100% compensation correctly for FULL_COMPENSATION policy', () => {
    // 350 cents totalCompensation with FULL_COMPENSATION (100%) policy
    const result = resolveReassignmentPayout(defaultMenu, 'FULL_COMPENSATION', undefined, 350)
    expect(result).toEqual({
      policy: 'FULL_COMPENSATION',
      amount: 350,
    })
  })

  // Test Plan Case 5: HALF_COMPENSATION (50%) with rounding
  test('calculates 50% compensation and rounds up fractional cents with roundMoney (Math.round)', () => {
    // 351 cents * 50% = 175.5 cents -> rounded to 176 cents
    const result = resolveReassignmentPayout(defaultMenu, 'FULL_COMPENSATION', 'HALF_COMPENSATION', 351)
    expect(result).toEqual({
      policy: 'HALF_COMPENSATION',
      amount: 176,
    })
  })

  // Test Plan Case 6: 0% percent and null totalCompensation
  test('returns 0 amount for NO_COMPENSATION policy or when totalCompensation is null', () => {
    // 0% policy on positive totalCompensation
    const zeroResult = resolveReassignmentPayout(defaultMenu, 'FULL_COMPENSATION', 'NO_COMPENSATION', 500)
    expect(zeroResult).toEqual({
      policy: 'NO_COMPENSATION',
      amount: 0,
    })

    // null totalCompensation under FULL_COMPENSATION policy
    const nullResult = resolveReassignmentPayout(defaultMenu, 'FULL_COMPENSATION', 'FULL_COMPENSATION', null)
    expect(nullResult).toEqual({
      policy: 'FULL_COMPENSATION',
      amount: 0,
    })
  })

  // Test Plan Case 7: Invalid menu keys, default fallback, missing default, and invalid percents
  describe('validation and error handling', () => {
    test('falls back to default policy key when requested policy is undefined', () => {
      const result = resolveReassignmentPayout(defaultMenu, 'HALF_COMPENSATION', undefined, 200)
      expect(result).toEqual({
        policy: 'HALF_COMPENSATION',
        amount: 100,
      })
    })

    test('throws BadRequestException listing allowed keys when requested key is not on menu', () => {
      // Admin requests non-existent policy key
      expect(() =>
        resolveReassignmentPayout(defaultMenu, 'FULL_COMPENSATION', 'SUPER_COMPENSATION', 500)
      ).toThrow(BadRequestException)

      try {
        resolveReassignmentPayout(defaultMenu, 'FULL_COMPENSATION', 'INVALID_KEY', 500)
      } catch (err: any) {
        expect(err.message).toContain('Allowed policies: FULL_COMPENSATION, HALF_COMPENSATION, NO_COMPENSATION')
      }
    })

    test('throws BadRequestException when default policy key itself is not on the menu', () => {
      // Default key missing from menu
      expect(() =>
        resolveReassignmentPayout(defaultMenu, 'MISSING_DEFAULT', undefined, 500)
      ).toThrow(BadRequestException)
    })

    test('throws BadRequestException when policy percentage is negative or greater than 100 or non-numeric', () => {
      const invalidMenu: Record<string, number> = {
        OVER_PAY: 150,
        NEGATIVE_PAY: -10,
        NAN_PAY: NaN,
      }

      // Percentage > 100
      expect(() => resolveReassignmentPayout(invalidMenu, 'OVER_PAY', undefined, 500)).toThrow(BadRequestException)
      // Percentage < 0
      expect(() => resolveReassignmentPayout(invalidMenu, 'NEGATIVE_PAY', undefined, 500)).toThrow(BadRequestException)
      // Non-finite percentage
      expect(() => resolveReassignmentPayout(invalidMenu, 'NAN_PAY', undefined, 500)).toThrow(BadRequestException)
    })
  })
})
