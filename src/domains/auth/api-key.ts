import { createHash, randomBytes } from 'crypto'

// A restaurant's API key (spec 0037). The server makes it, shows it once to the admin who asked,
// and keeps only its SHA-256 hash, so a database copy, a backup or a log gives no working key.

// The refusal for a key that is unknown, replaced or removed (AC-10). The server only ever sees a
// hash, so it cannot tell those three apart, and the sentence covers them all.
export const API_KEY_DOES_NOT_WORK_MESSAGE = 'This API key does not work. Ask the co-op for a new one.'

// The refusal for a key sent in the address (AC-9), whether the key is valid or not.
export const API_KEY_IN_URL_MESSAGE = 'Send the API key in the x-api-key header, not in the address.'

// "ock" = OpenCourier key: a person or a secret scanner can recognise a pasted key by it.
const API_KEY_PREFIX = 'ock_'

// A new key: the prefix plus 32 random bytes (256 bits) in base64url, 47 characters in all.
// Nobody can guess one, which is why a fast hash is enough to store it (spec 0037, Rationale).
export function makeApiKey(): string {
  return API_KEY_PREFIX + randomBytes(32).toString('base64url')
}

// What the database stores and looks up: the key's SHA-256, in lower case hex. The sent value is
// hashed exactly as it came: no trimming, so a key with a stray space simply matches nothing.
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}

// True when the parsed query string has an `api_key` property, of any type and however it was
// spelled in the address (`api_key=`, `api%5Fkey=`, `api_key[]=`): Express decodes all of them to
// the same property, so checking the parsed query catches what a pattern on the raw address would miss.
export function queryHasApiKey(query: unknown): boolean {
  return typeof query === 'object' && query !== null && Object.prototype.hasOwnProperty.call(query, 'api_key')
}
