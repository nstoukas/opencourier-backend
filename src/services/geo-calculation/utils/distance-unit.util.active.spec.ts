import { EnumDistanceUnit } from '@prisma/types'
import { convertKilometresToDistanceUnit } from './distance-unit.util'

describe('convertKilometresToDistanceUnit', () => {
  // Test Plan Case 1: KILOMETERS rounding
  test('rounds kilometres to 3 decimal places', () => {
    // 5.4321 kilometres should round to 5.432
    const result = convertKilometresToDistanceUnit(5.4321, EnumDistanceUnit.KILOMETERS)
    expect(result).toBe(5.432)
  })

  // Test Plan Case 2: MILES conversion matching haversine multiplier
  test('converts kilometres to unrounded miles using 0.621371 multiplier', () => {
    // 10 kilometres * 0.621371 = 6.21371 miles
    const result = convertKilometresToDistanceUnit(10, EnumDistanceUnit.MILES)
    expect(result).toBe(6.21371)
  })

  // Test Plan Case 3: Zero distance edge case
  test('returns 0 when kilometres is 0', () => {
    // Zero distance remains zero regardless of unit
    const result = convertKilometresToDistanceUnit(0, EnumDistanceUnit.KILOMETERS)
    expect(result).toBe(0)
  })
})
