function roundToTwoDecimals(num: number) {
  return Number(num.toFixed(2))
}

/**
 * Converts a price represented as a float (4.31) in "pennies" (431).
 */
export function floatPriceToPennies(floatPrice: number): number {
  return Math.ceil(floatPrice * 100)
}

export function penniesToFloat(pennyPrice: number): number {
  return roundToTwoDecimals(pennyPrice / 100)
}

// A parsePrice() lived here that hardcoded '$'. The backend stores integer minor units
// and reports a currency alongside them (InstanceConfigDomainService.getCurrency, and
// each record's own currencyCode) — it should not be rendering symbols at all.
// These two converters do no formatting, so they stay.
