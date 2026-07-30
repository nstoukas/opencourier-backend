import { EnumCurrency } from 'src/shared-types/currency'

/**
 * The currency a brand-new instance is seeded with. The co-op is Greek, so EUR.
 *
 * This is ONLY a starting value: `currency` is a member-votable Config key, and every
 * runtime read goes through InstanceConfigDomainService.getCurrency(). Changing this
 * constant does not change a running instance.
 */
export const SEEDED_INSTANCE_CURRENCY = EnumCurrency.EUR

/**
 * Turn a raw `Config.currency` row value into a currency.
 *
 * Pure — no database, no I/O — so it can be unit-tested on its own. Returns the seeded
 * default when the row is missing, empty, or holds something that isn't a known currency,
 * which is what stops a fixture writing a nonsense currency code into a money column.
 */
export function resolveInstanceCurrency(rawConfigValue: string | null | undefined): EnumCurrency {
  const known: string[] = Object.values(EnumCurrency)

  if (rawConfigValue && known.includes(rawConfigValue)) {
    // Type assertion telling TypeScript rawConfigValue is a valid EnumCurrency string
    return rawConfigValue as EnumCurrency
  }

  return SEEDED_INSTANCE_CURRENCY
}
