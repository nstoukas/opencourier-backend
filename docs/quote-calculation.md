# Quote calculation

When a new delivery quote request comes into the system, we need to calculate a quote for the partner that requested it.

Since we don't know yet to which courier the delivery will be matched to. We need to create a quote range with `quoteFrom` and `quoteTo`.

The delivery calculations service offers a method `calculateDeliveryQuoteAmount` which takes `IDeliveryCalculationsInput` as input.

```TS
interface IDeliveryCalculationsInput {
	pickupLocation: { latitude: number; longitude: number }
	dropoffLocation: { latitude: number; longitude: number }
	orderTotalValue: number
	pickupReadyAt: Date
	timeOfDay: Date
}
```

and returns `DeliveryQuoteAmountResultWithFeePercentage` as output.

```TS
interface DeliveryQuoteAmountResultWithFeePercentage {
	quoteRangeFrom: number; // the customer price: baseFee + distanceFee + the co-op fee
	quoteRangeTo: number;
	baseFee: number;
	distanceFee: number;
	feePercentage: number;
}
```

These values are input into the delivery quote creation.

To be able to calculate the quote, the system offers a quote calculation module. `apps\backend\src\services\quote-calculation`.

The `QuoteCalculationModule` is imported into the `DeliveryCalculationModule`.

## Quote calculation module

Location: `apps\backend\src\services\quote-calculation`

This is the quote calculation service module where the quote range is calculated.

It offers a method `calculateDeliveryQuote`

```TS
async calculateDeliveryQuote(
	input: IQuoteCalculationInput
): Promise<DeliveryQuoteAmountResult>;
```

```
Input: IQuoteCalculationInput
pickupLocation: The pickup location of the delivery.
dropoffLocation: The dropoff location of the delivery.
pickupReadyAt: The timestamp when the delivery will be ready for pickup.

Output: DeliveryQuoteAmountResult
quoteRangeFrom: The from range.
quoteRangeTo: The to range.
baseFee: The fixed part of the rider's pay, in whole cents.
distanceFee: The distance part of the rider's pay, in whole cents.
```

### Switch implementation

The module offers a default implementation, but the implementation can be changed on runtime.

The implementation type can be set on the config table, key: `quoteCalculationType`.
Use the `ConfigDomainService.instanceConfig.setInstanceConfigSettings` method to set the quoteCalculationType.

The default quoteCalculationType if the config settings key doesn't exist is under the .env file: `DEFAULT_QUOTE_CALCULATION_TYPE`

If you have the admin-web setup:

- Go to `Instance configuration`
- Change the `Quote calculation type`

### Quote rate configuration & unit scaling

The rate used for distance-based quotes is configured in the `Config` table key `quoteRatePerDistanceUnit` (with fallback `DEFAULT_QUOTE_RATE_PER_DISTANCE_UNIT` in `.env`).

- `quoteRatePerDistanceUnit` represents minor currency units per one `Config.distanceUnit` (e.g., 150 = EUR 1.50 per kilometre when `distanceUnit` is `KILOMETERS`).
- Rate and distance unit are coupled by definition: switching `distanceUnit` between `KILOMETERS` and `MILES` rescales every calculated quote by 1.609× without changing the rate value itself.

### Base fee, rider pay and the co-op fee (spec 0001)

Every quote is built from two parts, both stored on `DeliveryQuote` in whole cents:

- `baseFee`: the `Config` key `quoteBaseFee` when the quote is made (fallback `DEFAULT_QUOTE_BASE_FEE` in `.env`).
- `distanceFee`: `round(distance × quoteRatePerDistanceUnit)`.

The customer price (`quoteRangeFrom` and `quoteRangeTo`) is `baseFee + distanceFee + round((baseFee + distanceFee) × feePercentage / 100)`. The co-op fee is counted once, on top.

The rider is paid `baseFee + distanceFee` (`SimpleCourierCompensationService`), with no fee inside it and no floor: the base fee protects short trips. When a delivery is offered or reassigned, its pay, fee, fee % and total cost are all read from its stored quote, so changing a setting later never changes a delivery that already exists.

Worked example: base 200, 0.71 km at 150 per km, fee 10%. Distance fee 107, rider pay 307, co-op fee 31, customer price 338.

`SURGE` and `CUSTOM` quotes get a base fee of 0, and their whole price is the distance part.

### Implementations:

Currently we have 3 implementations:

- `CustomQuoteCalculationService` -> `EnumQuoteCalculationType.CUSTOM`
  (This is a development stub)
  - Ignores distance and calculates a random quote (`Math.random() * rate * 100.3`).
  - Logs a `logger.warn` on every call warning that prices and courier pay are randomized.
- `SimpleQuoteCalculationService` -> `EnumQuoteCalculationType.BY_DISTANCE`
  - Calculates the distance between pickup and dropoff locations in `Config.distanceUnit`.
  - Multiplies the distance by `quoteRatePerDistanceUnit` from `Config` (the distance fee).
  - Adds `quoteBaseFee` from `Config` (the base fee), and returns both parts.
- `SurgeQuoteCalculationService` -> `EnumQuoteCalculationType.SURGE`
  - Calculates the distance between pickup and dropoff locations in `Config.distanceUnit`.
  - Multiplies the distance by `quoteRatePerDistanceUnit` from `Config`.
  - Based on the time of day, readjusts the amount.
    - From 10PM to 6AM it multiplies the amount by 1.5 (50% more).
  - Returns the amount.

### Adding a new implementation

- Create a new class in `apps\backend\src\services\quote-calculation` that implements the `ICourierMatcherService` interface.
- Add the new implementation into `EnumQuoteCalculationType` -> `packages\shared-types\src\quote-calculation.ts`
- Add a human readable value in `QUOTE_CALCULATION_TYPE_TO_HUMAN` -> `packages\shared-types\src\quote-calculation.ts`
- Add the new implementation into the providers array in `QuoteCalculationModule` -> `apps\backend\src\services\quote-calculation\quote-calculation.module.ts`
- Set the new implementation on the config table. Check ([Switch implementation](#switch-implementation) section)
- Update the `quote-calculation.md` and add the implementation under [Implementations](#implementations)
