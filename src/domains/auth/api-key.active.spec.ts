import {
  makeApiKey,
  hashApiKey,
  queryHasApiKey,
  API_KEY_DOES_NOT_WORK_MESSAGE,
  API_KEY_IN_URL_MESSAGE,
} from './api-key'

describe('api-key helper functions and constants (Spec 0037)', () => {
  describe('makeApiKey', () => {
    test('makes an ock_ prefixed key with 43 base64url characters (47 chars total)', () => {
      const key = makeApiKey()
      expect(key.startsWith('ock_')).toBe(true)
      expect(key.length).toBe(47)
      // "ock_" (4) + 32 bytes base64url (43)
      expect(key).toMatch(/^ock_[A-Za-z0-9_-]{43}$/)
    })

    test('generates a different key on each call', () => {
      const keys = new Set<string>()
      for (let i = 0; i < 50; i++) {
        keys.add(makeApiKey())
      }
      expect(keys.size).toBe(50)
    })
  })

  describe('hashApiKey (AC-6)', () => {
    test('returns lower case hex SHA-256 of the key (64 hex characters)', () => {
      const key = 'ock_test_key_1234567890_abcdefghij'
      const hash = hashApiKey(key)
      expect(hash.length).toBe(64)
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
      // Deterministic check against known SHA-256
      expect(hashApiKey('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })

    test('hashes exact input without trimming (trailing or leading whitespace produces distinct hash)', () => {
      const key = 'ock_key_abc'
      const keyWithSpace = 'ock_key_abc '
      expect(hashApiKey(key)).not.toBe(hashApiKey(keyWithSpace))
    })
  })

  describe('queryHasApiKey (AC-9)', () => {
    test('returns true when query has api_key as a string', () => {
      expect(queryHasApiKey({ api_key: 'some-key' })).toBe(true)
      expect(queryHasApiKey({ api_key: '' })).toBe(true)
    })

    test('returns true when query has api_key as an array (e.g. from api_key[]=)', () => {
      expect(queryHasApiKey({ api_key: ['k1', 'k2'] })).toBe(true)
      expect(queryHasApiKey({ api_key: [] })).toBe(true)
    })

    test('returns true when query has api_key as an object', () => {
      expect(queryHasApiKey({ api_key: {} })).toBe(true)
      expect(queryHasApiKey({ api_key: { nested: 'val' } })).toBe(true)
    })

    test('returns true when query has api_key set to null or undefined', () => {
      expect(queryHasApiKey({ api_key: null })).toBe(true)
      expect(queryHasApiKey({ api_key: undefined })).toBe(true)
    })

    test('returns false when query does not have api_key property', () => {
      expect(queryHasApiKey({})).toBe(false)
      expect(queryHasApiKey({ other: 'value', search: 'taverna' })).toBe(false)
    })

    test('returns false for null, undefined, or non-object query values', () => {
      expect(queryHasApiKey(null)).toBe(false)
      expect(queryHasApiKey(undefined)).toBe(false)
      expect(queryHasApiKey('string')).toBe(false)
      expect(queryHasApiKey(123)).toBe(false)
    })
  })

  describe('Refusal message constants (AC-9, AC-10)', () => {
    test('API_KEY_DOES_NOT_WORK_MESSAGE matches spec 0037 exact sentence', () => {
      expect(API_KEY_DOES_NOT_WORK_MESSAGE).toBe('This API key does not work. Ask the co-op for a new one.')
    })

    test('API_KEY_IN_URL_MESSAGE matches spec 0037 exact sentence', () => {
      expect(API_KEY_IN_URL_MESSAGE).toBe('Send the API key in the x-api-key header, not in the address.')
    })
  })
})
