import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js'
import { DEFAULT_PHONE_REGION } from '../constants'

// Turns what a restaurant typed ("6912345678", "+30 691 234 5678", "0030 6912345678") into one
// stored form (E.164, "+306912345678"), so the same phone is always the same customer (spec 0005, AC-4).
// A number with no country code is read as Greek. Landlines and foreign numbers are accepted; only
// something that cannot be a phone number at all gives null.
// `as CountryCode` tells TypeScript the constant 'GR' is one of the library's country codes.
export function normalisePhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input, DEFAULT_PHONE_REGION as CountryCode)
  if (!parsed || !parsed.isPossible()) {
    return null
  }
  return parsed.number
}
