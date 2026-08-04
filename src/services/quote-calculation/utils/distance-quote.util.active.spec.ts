import { calculateDistanceQuote } from './distance-quote.util'

describe('calculateDistanceQuote', () => {
  // A1. Tests exact distance * rate multiplication
  it('calculates quote correctly for positive distance and rate (0.49 km * 150 = 73.5)', () => {
    // 0.49 distance units * 150 minor currency units = 73.5 minor currency units
    const result = calculateDistanceQuote(0.49, 150)
    expect(result).toBe(73.5)
  })

  // A2. Zero distance delivery does not throw
  it('returns 0 for zero distance delivery without throwing', () => {
    const result = calculateDistanceQuote(0, 150)
    expect(result).toBe(0)
  })

  // A3. Voted rate of 0 is legal
  it('returns 0 when rate per distance unit is 0', () => {
    const result = calculateDistanceQuote(2, 0)
    expect(result).toBe(0)
  })

  // A4. Invalid distance values throw error mentioning distance
  it('throws an error mentioning distance for invalid distance values (NaN, Infinity, negative)', () => {
    expect(() => calculateDistanceQuote(NaN, 150)).toThrow(/distance/)
    expect(() => calculateDistanceQuote(Infinity, 150)).toThrow(/distance/)
    expect(() => calculateDistanceQuote(-1, 150)).toThrow(/distance/)
  })

  // A5. Invalid rate values throw error mentioning quoteRatePerDistanceUnit
  it('throws an error mentioning quoteRatePerDistanceUnit for invalid rate values (NaN, negative)', () => {
    expect(() => calculateDistanceQuote(10, NaN)).toThrow(/quoteRatePerDistanceUnit/)
    expect(() => calculateDistanceQuote(10, -1)).toThrow(/quoteRatePerDistanceUnit/)
  })
})
