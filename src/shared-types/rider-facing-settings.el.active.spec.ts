import { RIDER_FACING_SETTINGS, REMOVAL_REASON_KEY, SHIFT_SLOT_KEY, SettingFormatContext } from './rider-facing-settings'
import { POLICY_NAMES_EL, RIDER_FACING_SETTINGS_EL, formatCentsEl } from './rider-facing-settings.el'

// Row 137 review fixes, requirement 2: the Greek "What changed" wording has one entry per rider facing
// setting, and never answers a missing value with a dash or with English.
describe('RIDER_FACING_SETTINGS_EL (row 137 review)', () => {
  const GREEK = /[Ͱ-Ͽ]/
  const LATIN_WORD = /[A-Za-z]{2,}/
  const NOT_SET = 'δεν έχει οριστεί'
  const context: SettingFormatContext = { distanceUnit: 'KILOMETERS', currency: 'EUR' }
  // The two record keys describe a whole record, so a missing one is "none", not "not set".
  const RECORD_KEYS = [REMOVAL_REASON_KEY, SHIFT_SLOT_KEY]

  describe('keys', () => {
    it('has exactly the same keys as RIDER_FACING_SETTINGS', () => {
      const english = Object.keys(RIDER_FACING_SETTINGS).sort()
      const greek = Object.keys(RIDER_FACING_SETTINGS_EL).sort()

      // Named separately so a failure says which side is short.
      expect(english.filter((key) => !greek.includes(key))).toEqual([])
      expect(greek.filter((key) => !english.includes(key))).toEqual([])
      expect(greek).toEqual(english)
    })

    it('is not empty (the comparison above would pass on two empty lists)', () => {
      expect(Object.keys(RIDER_FACING_SETTINGS_EL).length).toBeGreaterThan(40)
    })

    it.each(Object.keys(RIDER_FACING_SETTINGS))('"%s" has a Greek label and a formatter', (key) => {
      const greek = RIDER_FACING_SETTINGS_EL[key]

      expect(greek).toBeDefined()
      expect(typeof greek?.format).toBe('function')
      expect(GREEK.test(greek?.label ?? '')).toBe(true)
      expect(greek?.label).not.toBe(RIDER_FACING_SETTINGS[key]?.label)
    })
  })

  describe('a missing value', () => {
    const configKeys = Object.keys(RIDER_FACING_SETTINGS_EL).filter((key) => !RECORD_KEYS.includes(key))

    it.each(configKeys)('"%s" reads "δεν έχει οριστεί" for null, undefined and an empty string', (key) => {
      const format = RIDER_FACING_SETTINGS_EL[key]!.format

      expect(format(null, context)).toBe(NOT_SET)
      expect(format(undefined, context)).toBe(NOT_SET)
      expect(format('', context)).toBe(NOT_SET)
    })

    it.each(RECORD_KEYS)('"%s" reads Greek, never English or a dash, for a record that is not there', (key) => {
      const format = RIDER_FACING_SETTINGS_EL[key]!.format

      for (const missing of [null, undefined]) {
        const text = format(missing, context)
        expect(GREEK.test(text)).toBe(true)
        expect(LATIN_WORD.test(text)).toBe(false)
        expect(text).not.toContain('—')
      }
    })

    it('formatCentsEl reads "δεν έχει οριστεί" for a missing amount in any currency', () => {
      expect(formatCentsEl(null, 'EUR')).toBe(NOT_SET)
      expect(formatCentsEl(undefined, 'EUR')).toBe(NOT_SET)
      expect(formatCentsEl('', 'USD')).toBe(NOT_SET)
      expect(formatCentsEl('not a number', 'EUR')).toBe(NOT_SET)
    })
  })

  describe('values', () => {
    const format = (key: string, value: unknown, ctx: SettingFormatContext = context) =>
      RIDER_FACING_SETTINGS_EL[key]!.format(value, ctx)

    it('writes money with the Greek decimal comma and the symbol after', () => {
      expect(formatCentsEl(250, 'EUR')).toBe('2,50 €')
      expect(formatCentsEl(0, 'EUR')).toBe('0,00 €')
      expect(formatCentsEl(250, 'USD')).toBe('2,50 USD')
      expect(format('quoteBaseFee', 200)).toBe('2,00 €')
      expect(format('reviewCorrectionMaxCents', 5000)).toBe('50,00 €')
    })

    it('writes on and off as "ενεργό" and "ανενεργό"', () => {
      expect(format('shiftsEnabled', true)).toBe('ενεργό')
      expect(format('shiftsEnabled', false)).toBe('ανενεργό')
      expect(format('waitPayEnabled', 'true')).toBe('ενεργό')
      expect(format('waitPayEnabled', 'false')).toBe('ανενεργό')
    })

    it('writes "μίλια" after a distance and "μίλι" after "ανά" on a MILES instance', () => {
      const miles: SettingFormatContext = { distanceUnit: 'MILES', currency: 'EUR' }

      expect(format('maxAssignmentDistance', 20, miles)).toBe('20 μίλια')
      expect(format('quoteRatePerDistanceUnit', 150, miles)).toBe('1,50 € ανά μίλι')
      expect(format('maxAssignmentDistance', 20)).toBe('20 km')
      expect(format('quoteRatePerDistanceUnit', 150)).toBe('1,50 € ανά km')
    })

    it('names the payout policies in the nominative', () => {
      expect(POLICY_NAMES_EL).toEqual({
        FULL_COMPENSATION: 'πλήρης αποζημίωση',
        HALF_COMPENSATION: 'μισή αποζημίωση',
        NO_COMPENSATION: 'καμία αποζημίωση',
      })
      expect(format('cancellationPayoutPolicy', 'FULL_COMPENSATION')).toBe('πλήρης αποζημίωση')
      expect(format('reassignmentPayoutDefaultPolicy', 'NO_COMPENSATION')).toBe('καμία αποζημίωση')
    })

    it('never answers a set value of a Config key with the "not set" wording', () => {
      const samples: Record<string, unknown> = {
        courierMatcherType: 'FAIRNESS',
        distanceUnit: 'KILOMETERS',
        currency: 'EUR',
        twoOrderPolicy: 'SHORTAGE_ONLY',
        addOnMoment: 'BEFORE_PICKUP',
        courierCompensationCalculationType: 'FROM_QUOTE_FROM',
        boxDefaultSize: 'MEDIUM',
        cancellationPayoutPolicy: 'HALF_COMPENSATION',
        reassignmentPayoutPolicies: { FULL_COMPENSATION: 100 },
        reassignmentPayoutDefaultPolicy: 'HALF_COMPENSATION',
      }
      for (const key of Object.keys(RIDER_FACING_SETTINGS_EL).filter((k) => !RECORD_KEYS.includes(k))) {
        const value = key in samples ? samples[key] : key.endsWith('Enabled') ? true : 7
        expect(format(key, value)).not.toBe(NOT_SET)
      }
    })
  })
})
