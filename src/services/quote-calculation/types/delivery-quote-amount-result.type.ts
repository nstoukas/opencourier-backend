export type DeliveryQuoteAmountResult = {
  quoteRangeFrom: number
  quoteRangeTo: number
  // The two parts the rider is paid, in whole cents (spec 0001). DeliveryCalculationService
  // builds the customer price from these two alone.
  baseFee: number
  distanceFee: number
}
