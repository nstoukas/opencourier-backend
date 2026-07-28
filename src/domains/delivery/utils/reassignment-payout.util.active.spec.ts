import { BadRequestException, InternalServerErrorException } from '@nestjs/common'
import {
  resolveReassignmentPayout,
  formatReassignmentAwardFailure,
  ReassignmentFailureStage,
} from './reassignment-payout.util'

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
      // Admin explicitly requests non-existent policy key -> Bad Request (400)
      expect(() =>
        resolveReassignmentPayout(defaultMenu, 'FULL_COMPENSATION', 'SUPER_COMPENSATION', 500)
      ).toThrow(BadRequestException)

      try {
        resolveReassignmentPayout(defaultMenu, 'FULL_COMPENSATION', 'INVALID_KEY', 500)
      } catch (err: any) {
        expect(err).toBeInstanceOf(BadRequestException)
        expect(err.message).toContain('Allowed policies: FULL_COMPENSATION, HALF_COMPENSATION, NO_COMPENSATION')
      }
    })

    test('throws InternalServerErrorException when default policy key itself is not on the menu', () => {
      // Stored default key missing from menu -> Server Config Error (500)
      expect(() =>
        resolveReassignmentPayout(defaultMenu, 'MISSING_DEFAULT', undefined, 500)
      ).toThrow(InternalServerErrorException)

      try {
        resolveReassignmentPayout(defaultMenu, 'MISSING_DEFAULT', undefined, 500)
      } catch (err: any) {
        expect(err).toBeInstanceOf(InternalServerErrorException)
        expect(err.message).toContain("Instance config error: the configured default reassignment payout policy 'MISSING_DEFAULT' is not on the votable menu")
        expect(err.message).toContain('reassignmentPayoutDefaultPolicy')
      }
    })

    test('throws InternalServerErrorException when policy percentage is negative or greater than 100 or non-numeric', () => {
      // Broken percentage in stored menu -> Server Config Error (500) regardless of who requested it
      const invalidMenu: Record<string, number> = {
        OVER_PAY: 150,
        NEGATIVE_PAY: -10,
        NAN_PAY: NaN,
      }

      // Percentage > 100 (defaulted and requested)
      expect(() => resolveReassignmentPayout(invalidMenu, 'OVER_PAY', undefined, 500)).toThrow(InternalServerErrorException)
      expect(() => resolveReassignmentPayout(invalidMenu, 'FULL_COMPENSATION', 'OVER_PAY', 500)).toThrow(InternalServerErrorException)

      // Percentage < 0 (defaulted and requested)
      expect(() => resolveReassignmentPayout(invalidMenu, 'NEGATIVE_PAY', undefined, 500)).toThrow(InternalServerErrorException)
      expect(() => resolveReassignmentPayout(invalidMenu, 'FULL_COMPENSATION', 'NEGATIVE_PAY', 500)).toThrow(InternalServerErrorException)

      // Non-finite percentage (defaulted and requested)
      expect(() => resolveReassignmentPayout(invalidMenu, 'NAN_PAY', undefined, 500)).toThrow(InternalServerErrorException)
      expect(() => resolveReassignmentPayout(invalidMenu, 'FULL_COMPENSATION', 'NAN_PAY', 500)).toThrow(InternalServerErrorException)
    })
  })

  // Test Plan Cases 1-5: formatReassignmentAwardFailure helper formatting tests
  describe('formatReassignmentAwardFailure', () => {
    const stages: ReassignmentFailureStage[] = [
      'AWARD_WRITE_FAILED',
      'REASSIGNMENT_DID_NOT_TAKE_EFFECT',
      'REASSIGNMENT_OUTCOME_UNKNOWN',
      'AWARD_ROLLBACK_FAILED',
      'REJECTED_LIST_ROLLBACK_FAILED',
    ]

    // Test Plan Case 1: Includes deliveryId, droppedCourierId, amount, currencyCode, and policy for all 5 stages
    test('includes deliveryId, droppedCourierId, amount, currencyCode, and policy for all failure stages', () => {
      stages.forEach((stage) => {
        const output = formatReassignmentAwardFailure({
          deliveryId: 'del-123',
          droppedCourierId: 'courier-456',
          amount: 350,
          currencyCode: 'EUR',
          policy: 'FULL_COMPENSATION',
          compensationId: 'comp-789',
          stage,
        })

        expect(output).toContain('deliveryId=del-123')
        expect(output).toContain('droppedCourierId=courier-456')
        expect(output).toContain('amount=350')
        expect(output).toContain('currencyCode=EUR')
        expect(output).toContain('policy=FULL_COMPENSATION')
      })
    })

    // Test Plan Case 2: Line starts with REASSIGNMENT_AWARD followed by stage name
    test('starts line with REASSIGNMENT_AWARD followed by the stage name for easy log searching', () => {
      stages.forEach((stage) => {
        const output = formatReassignmentAwardFailure({
          deliveryId: 'del-123',
          droppedCourierId: 'courier-456',
          amount: 350,
          currencyCode: 'EUR',
          policy: 'FULL_COMPENSATION',
          compensationId: 'comp-789',
          stage,
        })

        expect(output.startsWith(`REASSIGNMENT_AWARD ${stage}`)).toBe(true)
      })
    })

    // Test Plan Case 3: compensationId rendering (null vs string)
    test('renders compensationId=none when compensationId is null, and verbatim string when provided', () => {
      const nullOutput = formatReassignmentAwardFailure({
        deliveryId: 'del-123',
        droppedCourierId: 'courier-456',
        amount: 350,
        currencyCode: 'EUR',
        policy: 'FULL_COMPENSATION',
        compensationId: null,
        stage: 'AWARD_WRITE_FAILED',
      })
      expect(nullOutput).toContain('compensationId=none')

      const idOutput = formatReassignmentAwardFailure({
        deliveryId: 'del-123',
        droppedCourierId: 'courier-456',
        amount: 350,
        currencyCode: 'EUR',
        policy: 'FULL_COMPENSATION',
        compensationId: 'comp-abc',
        stage: 'AWARD_WRITE_FAILED',
      })
      expect(idOutput).toContain('compensationId=comp-abc')
    })

    // Test Plan Case 4: Distinct recovery actions for specific stages
    test('provides distinct recovery action guidance in log message for each stage', () => {
      const writeFailed = formatReassignmentAwardFailure({
        deliveryId: 'del-1',
        droppedCourierId: 'c-1',
        amount: 100,
        currencyCode: 'EUR',
        policy: 'FULL_COMPENSATION',
        compensationId: null,
        stage: 'AWARD_WRITE_FAILED',
      })
      expect(writeFailed).toContain('admin can safely retry')

      const rollbackFailed = formatReassignmentAwardFailure({
        deliveryId: 'del-1',
        droppedCourierId: 'c-1',
        amount: 100,
        currencyCode: 'EUR',
        policy: 'FULL_COMPENSATION',
        compensationId: 'comp-1',
        stage: 'AWARD_ROLLBACK_FAILED',
      })
      expect(rollbackFailed).toContain('delete it manually')

      const outcomeUnknown = formatReassignmentAwardFailure({
        deliveryId: 'del-1',
        droppedCourierId: 'c-1',
        amount: 100,
        currencyCode: 'EUR',
        policy: 'FULL_COMPENSATION',
        compensationId: 'comp-1',
        stage: 'REASSIGNMENT_OUTCOME_UNKNOWN',
      })
      expect(outcomeUnknown).toContain('award row was KEPT')

      const rejectedListRollbackFailed = formatReassignmentAwardFailure({
        deliveryId: 'del-1',
        droppedCourierId: 'c-1',
        amount: 100,
        currencyCode: 'EUR',
        policy: 'FULL_COMPENSATION',
        compensationId: 'comp-1',
        stage: 'REJECTED_LIST_ROLLBACK_FAILED',
      })
      expect(rejectedListRollbackFailed).toContain('excluded from re-offers')
      expect(rejectedListRollbackFailed).toContain('20 minutes')
    })

    // Test Plan Case 5: amount is logged raw in cents
    test('logs amount raw in cents without decimal formatting', () => {
      const output = formatReassignmentAwardFailure({
        deliveryId: 'del-123',
        droppedCourierId: 'courier-456',
        amount: 350,
        currencyCode: 'EUR',
        policy: 'FULL_COMPENSATION',
        compensationId: 'comp-789',
        stage: 'AWARD_WRITE_FAILED',
      })

      expect(output).toContain('amount=350')
      expect(output).not.toContain('amount=3.50')
    })
  })
})
