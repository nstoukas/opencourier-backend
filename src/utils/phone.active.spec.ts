import { normalisePhone } from './phone'

describe('normalisePhone (AC-4)', () => {
  it('normalises Greek mobile numbers in different formats to E.164 (+30...)', () => {
    expect(normalisePhone('6912345678')).toBe('+306912345678')
    expect(normalisePhone('+30 691 234 5678')).toBe('+306912345678')
    expect(normalisePhone('0030 6912345678')).toBe('+306912345678')
  })

  it('accepts a Greek landline and normalises it to E.164', () => {
    expect(normalisePhone('2421012345')).toBe('+302421012345')
  })

  it('accepts a foreign phone number with country code and normalises it to E.164', () => {
    expect(normalisePhone('+44 20 7946 0958')).toBe('+442079460958')
  })

  it('returns null for impossible phone numbers or invalid input', () => {
    expect(normalisePhone('123')).toBeNull()
    expect(normalisePhone('abc')).toBeNull()
    expect(normalisePhone('')).toBeNull()
  })
})
