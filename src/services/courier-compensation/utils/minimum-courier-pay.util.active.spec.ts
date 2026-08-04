import { applyMinimumCourierPay } from './minimum-courier-pay.util'

describe('applyMinimumCourierPay', () => {
  // B1. Floor binds when quote compensation is below defaultMinimumCourierPay
  it('returns the minimum courier pay floor when quote compensation is below floor', () => {
    // Quote is 21 minor units (EUR 0.21), floor is 250 (EUR 2.50) -> floor binds
    const result = applyMinimumCourierPay(21, 250)
    expect(result).toBe(250)
  })

  // B2. Quote compensation above floor is untouched
  it('returns quote compensation untouched when it exceeds minimum courier pay', () => {
    // Quote is 400 minor units (EUR 4.00), floor is 250 -> quote stays 400
    const result = applyMinimumCourierPay(400, 250)
    expect(result).toBe(400)
  })

  // B3. Compensation exactly equal to floor returns floor without double counting
  it('returns exact amount when compensation matches minimum pay floor exactly', () => {
    const result = applyMinimumCourierPay(250, 250)
    expect(result).toBe(250)
  })

  // B4. Unset minimum courier pay (null) returns raw compensation
  it('returns original compensation when minimum courier pay floor is null (unset)', () => {
    const result = applyMinimumCourierPay(21, null)
    expect(result).toBe(21)
  })

  // B5. Invalid or zero minimum courier pay (NaN or 0) returns original compensation
  it('returns original compensation when minimum courier pay floor is NaN or <= 0', () => {
    expect(applyMinimumCourierPay(21, NaN)).toBe(21)
    expect(applyMinimumCourierPay(21, 0)).toBe(21)
    expect(applyMinimumCourierPay(21, -50)).toBe(21)
  })
})
