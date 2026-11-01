// The co-op's dispatch line, which a rider calls in one tap from the job screen (row 72).
// A representative types it on Instance configuration; spaces, dashes, dots and brackets
// are allowed while typing and removed before saving, so the phone dials exactly what is stored.

// Digits only, an optional leading +, at most 15 digits (the international limit).
const PHONE_NUMBER = /^\+?[0-9]{3,15}$/

export const DISPATCH_PHONE_NUMBER_REFUSAL =
  'dispatchPhoneNumber must be a phone number: digits, optionally starting with +, for example +30 24210 12345'

// Returns the number as it will be stored: '' clears it, null means it is not a phone number.
export function normalizeDispatchPhoneNumber(typed: string): string | null {
  const compact = typed.replace(/[\s().-]/g, '')
  if (compact === '') {
    return ''
  }
  return PHONE_NUMBER.test(compact) ? compact : null
}
