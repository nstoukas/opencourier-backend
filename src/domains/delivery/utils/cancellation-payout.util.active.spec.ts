import { resolveCancellationPayout } from './cancellation-payout.util'
import { FALLBACK_CANCELLATION_PAYOUT_POLICY } from 'src/shared-types/index'

describe('resolveCancellationPayout (Spec 0015 AC-4)', () => {
  const defaultMenu: Record<string, number> = {
    FULL_COMPENSATION: 100,
    HALF_COMPENSATION: 50,
    NO_COMPENSATION: 0,
    QUARTER_COMPENSATION: 25,
  }

  describe('Happy path payout calculation', () => {
    it('calculates 100% pay under FULL_COMPENSATION policy with no warnings', () => {
      const result = resolveCancellationPayout(defaultMenu, 'FULL_COMPENSATION', 500)
      expect(result).toEqual({
        policy: 'FULL_COMPENSATION',
        amount: 500,
        warnings: [],
      })
    })

    it('calculates 50% pay with standard half-up rounding under HALF_COMPENSATION', () => {
      // 351 * 50% = 175.5 -> rounds to 176
      const result = resolveCancellationPayout(defaultMenu, 'HALF_COMPENSATION', 351)
      expect(result).toEqual({
        policy: 'HALF_COMPENSATION',
        amount: 176,
        warnings: [],
      })
    })

    it('calculates 25% pay with standard rounding under QUARTER_COMPENSATION', () => {
      // 350 * 25% = 87.5 -> rounds to 88
      const result = resolveCancellationPayout(defaultMenu, 'QUARTER_COMPENSATION', 350)
      expect(result).toEqual({
        policy: 'QUARTER_COMPENSATION',
        amount: 88,
        warnings: [],
      })
    })

    it('calculates 0 pay under NO_COMPENSATION policy', () => {
      const result = resolveCancellationPayout(defaultMenu, 'NO_COMPENSATION', 1000)
      expect(result).toEqual({
        policy: 'NO_COMPENSATION',
        amount: 0,
        warnings: [],
      })
    })
  })

  describe('Edge cases and fallbacks (Value 4: mistakes never cost the rider, never throws)', () => {
    it('when stored key is off the menu, falls back to FULL_COMPENSATION percent with a warning', () => {
      const result = resolveCancellationPayout(defaultMenu, 'UNKNOWN_POLICY', 400)
      expect(result.policy).toBe('FULL_COMPENSATION')
      expect(result.amount).toBe(400)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain(
        "cancellationPayoutPolicy 'UNKNOWN_POLICY' is not a usable key of reassignmentPayoutPolicies; paid under 'FULL_COMPENSATION' instead"
      )
    })

    it('when stored key is off the menu AND FULL_COMPENSATION is also missing from menu, pays 100% with a warning', () => {
      const menuWithoutFull: Record<string, number> = {
        HALF_COMPENSATION: 50,
      }
      const result = resolveCancellationPayout(menuWithoutFull, 'NON_EXISTENT', 600)
      expect(result.policy).toBe(FALLBACK_CANCELLATION_PAYOUT_POLICY)
      expect(result.amount).toBe(600)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain(
        "cancellationPayoutPolicy 'NON_EXISTENT' is not a usable key of reassignmentPayoutPolicies, and neither is 'FULL_COMPENSATION'; paid in full"
      )
    })

    it('when totalCompensation is null, pays 0 and records a warning naming totalCompensation', () => {
      const result = resolveCancellationPayout(defaultMenu, 'FULL_COMPENSATION', null)
      expect(result.policy).toBe('FULL_COMPENSATION')
      expect(result.amount).toBe(0)
      expect(result.warnings).toContain('the delivery has no totalCompensation, so the cancellation pays 0')
    })

    it('when totalCompensation is null AND stored policy is off menu, records both warnings and pays 0', () => {
      const result = resolveCancellationPayout(defaultMenu, 'BAD_POLICY', null)
      expect(result.policy).toBe('FULL_COMPENSATION')
      expect(result.amount).toBe(0)
      expect(result.warnings).toHaveLength(2)
      expect(result.warnings[0]).toContain('is not a usable key')
      expect(result.warnings[1]).toContain('has no totalCompensation')
    })

    it('treats invalid percentage (>100 or <0 or NaN) in menu as unusable and falls back', () => {
      const corruptedMenu: Record<string, number> = {
        OVER_PAY: 150,
        NEGATIVE_PAY: -20,
        NAN_PAY: NaN,
        FULL_COMPENSATION: 100,
      }

      const overResult = resolveCancellationPayout(corruptedMenu, 'OVER_PAY', 500)
      expect(overResult.policy).toBe('FULL_COMPENSATION')
      expect(overResult.amount).toBe(500)
      expect(overResult.warnings[0]).toContain("cancellationPayoutPolicy 'OVER_PAY' is not a usable key")

      const negResult = resolveCancellationPayout(corruptedMenu, 'NEGATIVE_PAY', 500)
      expect(negResult.policy).toBe('FULL_COMPENSATION')
      expect(negResult.amount).toBe(500)

      const nanResult = resolveCancellationPayout(corruptedMenu, 'NAN_PAY', 500)
      expect(nanResult.policy).toBe('FULL_COMPENSATION')
      expect(nanResult.amount).toBe(500)
    })

    it('protects against prototype pollution keys (e.g. constructor, toString)', () => {
      const result = resolveCancellationPayout(defaultMenu, 'constructor', 400)
      expect(result.policy).toBe('FULL_COMPENSATION')
      expect(result.amount).toBe(400)
      expect(result.warnings[0]).toContain("cancellationPayoutPolicy 'constructor' is not a usable key")
    })

    it('handles empty menu gracefully without throwing: pays 100% with warning', () => {
      const emptyMenu: Record<string, number> = {}
      const result = resolveCancellationPayout(emptyMenu, 'ANY_KEY', 350)
      expect(result.policy).toBe('FULL_COMPENSATION')
      expect(result.amount).toBe(350)
      expect(result.warnings[0]).toContain('paid in full')
    })
  })
})
