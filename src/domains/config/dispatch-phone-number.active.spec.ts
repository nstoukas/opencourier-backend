import {
  DISPATCH_PHONE_NUMBER_REFUSAL,
  normalizeDispatchPhoneNumber,
} from './dispatch-phone-number'

describe('normalizeDispatchPhoneNumber (row 72, decision 72.1)', () => {
  describe('punctuation and whitespace stripping', () => {
    it('removes spaces, dashes, dots and brackets', () => {
      expect(normalizeDispatchPhoneNumber('+30 24210 12345')).toBe('+302421012345')
      expect(normalizeDispatchPhoneNumber('(+30) 24210-12.345')).toBe('+302421012345')
      expect(normalizeDispatchPhoneNumber('24210-12345')).toBe('2421012345')
      expect(normalizeDispatchPhoneNumber('242.10.12345')).toBe('2421012345')
      expect(normalizeDispatchPhoneNumber('(24210) 12345')).toBe('2421012345')
      expect(normalizeDispatchPhoneNumber(' (024210) 12-34.56 ')).toBe('024210123456')
    })
  })

  describe('clearing the setting with empty or whitespace string', () => {
    it('returns empty string "" for empty text and whitespace-only text', () => {
      expect(normalizeDispatchPhoneNumber('')).toBe('')
      expect(normalizeDispatchPhoneNumber(' ')).toBe('')
      expect(normalizeDispatchPhoneNumber('   ')).toBe('')
      expect(normalizeDispatchPhoneNumber('\t\n ')).toBe('')
      // Strip characters alone leave an empty string
      expect(normalizeDispatchPhoneNumber(' - . () ')).toBe('')
    })
  })

  describe('rejecting invalid phone numbers with null', () => {
    it('rejects strings containing letters', () => {
      expect(normalizeDispatchPhoneNumber('call me')).toBeNull()
      expect(normalizeDispatchPhoneNumber('123a456')).toBeNull()
      expect(normalizeDispatchPhoneNumber('+30dispatch')).toBeNull()
      expect(normalizeDispatchPhoneNumber('phone')).toBeNull()
    })

    it('rejects a "+" not at the start', () => {
      expect(normalizeDispatchPhoneNumber('123+456')).toBeNull()
      expect(normalizeDispatchPhoneNumber('12345+')).toBeNull()
      expect(normalizeDispatchPhoneNumber('++12345')).toBeNull()
    })

    it('rejects numbers under 3 digits', () => {
      expect(normalizeDispatchPhoneNumber('1')).toBeNull()
      expect(normalizeDispatchPhoneNumber('12')).toBeNull()
      expect(normalizeDispatchPhoneNumber('+1')).toBeNull()
      expect(normalizeDispatchPhoneNumber('+12')).toBeNull()
    })

    it('rejects numbers over 15 digits', () => {
      expect(normalizeDispatchPhoneNumber('1234567890123456')).toBeNull()
      expect(normalizeDispatchPhoneNumber('+1234567890123456')).toBeNull()
    })

    it('rejects characters not on the strip list', () => {
      expect(normalizeDispatchPhoneNumber('123#456')).toBeNull()
      expect(normalizeDispatchPhoneNumber('123*456')).toBeNull()
      expect(normalizeDispatchPhoneNumber('123/456')).toBeNull()
      expect(normalizeDispatchPhoneNumber('@12345')).toBeNull()
    })
  })

  describe('boundary valid lengths', () => {
    it('accepts numbers with 3 digits (minimum allowed)', () => {
      expect(normalizeDispatchPhoneNumber('100')).toBe('100')
      expect(normalizeDispatchPhoneNumber('+123')).toBe('+123')
    })

    it('accepts numbers with 15 digits (maximum allowed)', () => {
      expect(normalizeDispatchPhoneNumber('123456789012345')).toBe('123456789012345')
      expect(normalizeDispatchPhoneNumber('+123456789012345')).toBe('+123456789012345')
    })
  })

  it('exports DISPATCH_PHONE_NUMBER_REFUSAL with the expected refusal explanation', () => {
    expect(DISPATCH_PHONE_NUMBER_REFUSAL).toBe(
      'dispatchPhoneNumber must be a phone number: digits, optionally starting with +, for example +30 24210 12345'
    )
  })
})
