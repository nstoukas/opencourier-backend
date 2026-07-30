import { SEEDED_INSTANCE_CURRENCY, resolveInstanceCurrency } from './instance-currency'

describe('instance currency seed utilities', () => {
  describe('SEEDED_INSTANCE_CURRENCY', () => {
    // 1. Assert against the string literal 'EUR' directly, not EnumCurrency.EUR
    it('is set to EUR', () => {
      expect(SEEDED_INSTANCE_CURRENCY).toBe('EUR')
    })
  })

  describe('resolveInstanceCurrency', () => {
    // 2. Exact match for EUR returns EUR
    it('returns EUR when given EUR', () => {
      expect(resolveInstanceCurrency('EUR')).toBe('EUR')
    })

    // 3. Voted currency (USD) is preserved
    it('returns USD when given USD (preserves member-voted config)', () => {
      expect(resolveInstanceCurrency('USD')).toBe('USD')
    })

    // 4. Missing value null falls back to EUR
    it('falls back to EUR when given null', () => {
      expect(resolveInstanceCurrency(null)).toBe('EUR')
    })

    // 5. Missing value undefined falls back to EUR
    it('falls back to EUR when given undefined', () => {
      expect(resolveInstanceCurrency(undefined)).toBe('EUR')
    })

    // 6. Empty string falls back to EUR
    it('falls back to EUR when given empty string', () => {
      expect(resolveInstanceCurrency('')).toBe('EUR')
    })

    // 7. Unknown currency code GBP falls back to EUR
    it('falls back to EUR when given an unknown currency code like GBP', () => {
      expect(resolveInstanceCurrency('GBP')).toBe('EUR')
    })

    // 8. Case-sensitive matching: lowercase eur falls back to EUR
    it('falls back to EUR when given lowercase eur (exact matching required)', () => {
      expect(resolveInstanceCurrency('eur')).toBe('EUR')
    })
  })
})
