/**
 * Price of one delivery, before the platform fee.
 *
 * Both arguments must already speak the SAME unit: `distance` has been converted to
 * Config.distanceUnit by convertKilometresToDistanceUnit, and `ratePerDistanceUnit` is
 * defined as the price of one of those same units. Charging a per-mile rate against a
 * kilometre count is the bug this signature exists to make impossible.
 *
 * Returns minor currency units, unrounded — DeliveryCalculationService applies roundMoney.
 */
export function calculateDistanceQuote(distance: number, ratePerDistanceUnit: number): number {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new Error(`Cannot quote a delivery: distance is not a usable number (${distance})`)
  }
  if (!Number.isFinite(ratePerDistanceUnit) || ratePerDistanceUnit < 0) {
    throw new Error(
      `Cannot quote a delivery: quoteRatePerDistanceUnit is not a usable number (${ratePerDistanceUnit})`
    )
  }

  return distance * ratePerDistanceUnit
}
