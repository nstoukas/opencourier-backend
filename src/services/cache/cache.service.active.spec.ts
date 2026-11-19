import { CacheService } from './cache.service'
import { RedisClient } from '../redis/models/RedisClient'

describe('CacheService (Spec 0039 row 17: increment, take, setIfAbsent for password reset)', () => {
  let cacheService: CacheService
  let mockRedisClient: {
    set: jest.Mock
    get: jest.Mock
    del: jest.Mock
    incr: jest.Mock
    expire: jest.Mock
    getdel: jest.Mock
    eval: jest.Mock
  }

  beforeEach(() => {
    mockRedisClient = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      getdel: jest.fn(),
      eval: jest.fn(),
    }
    cacheService = new CacheService(mockRedisClient as unknown as RedisClient)
  })

  describe('increment (Clause 4: Lua script eval atomic increment and expiry)', () => {
    test('calls redisClient.eval once with script, 1 key, key and ttl, returning count as number', async () => {
      mockRedisClient.eval.mockResolvedValue(1)

      const result = await cacheService.increment('test-key', 3600)

      expect(mockRedisClient.eval).toHaveBeenCalledTimes(1)
      const [script, numKeys, key, ttl] = mockRedisClient.eval.mock.calls[0]
      expect(numKeys).toBe(1)
      expect(key).toBe('test-key')
      expect(ttl).toBe(3600)
      expect(script).toContain("redis.call('INCR', KEYS[1])")
      expect(script).toContain("redis.call('TTL', KEYS[1]) == -1")
      expect(script).toContain("redis.call('EXPIRE', KEYS[1], ARGV[1])")
      expect(result).toBe(1)
    })

    test('returns count as number when eval returns string or higher number', async () => {
      mockRedisClient.eval.mockResolvedValue('2')

      const result = await cacheService.increment('test-key', 3600)

      expect(mockRedisClient.eval).toHaveBeenCalledTimes(1)
      expect(result).toBe(2)
      expect(typeof result).toBe('number')
    })

    test('increments counter with key and ttl and returns count', async () => {
      mockRedisClient.eval.mockResolvedValue(5)

      const result = await cacheService.increment('password-reset-count:user-1', 3600)

      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringMatching(
          /INCR[\s\S]*KEYS\[1\][\s\S]*TTL[\s\S]*KEYS\[1\][\s\S]*==\s*-1[\s\S]*EXPIRE[\s\S]*KEYS\[1\][\s\S]*ARGV\[1\]/
        ),
        1,
        'password-reset-count:user-1',
        3600
      )
      expect(result).toBe(5)
    })
  })

  describe('take (Clause 8: GETDEL atomic read-and-delete)', () => {
    test('returns null when the key does not exist', async () => {
      mockRedisClient.getdel.mockResolvedValue(null)

      const result = await cacheService.take('password-reset:user-1')

      expect(mockRedisClient.getdel).toHaveBeenCalledWith('password-reset:user-1')
      expect(result).toBeNull()
    })

    test('parses and returns JSON value when key exists', async () => {
      const stored = { codeHash: 'abc123hash' }
      mockRedisClient.getdel.mockResolvedValue(JSON.stringify(stored))

      const result = await cacheService.take<{ codeHash: string }>('password-reset:user-1')

      expect(mockRedisClient.getdel).toHaveBeenCalledWith('password-reset:user-1')
      expect(result).toEqual(stored)
    })
  })

  describe('setIfAbsent (Clause 8: SET NX EX atomic conditional set)', () => {
    test('returns true when Redis returns "OK" (key was set)', async () => {
      mockRedisClient.set.mockResolvedValue('OK')

      const result = await cacheService.setIfAbsent('password-reset-wait:user-1', 1, 60)

      expect(mockRedisClient.set).toHaveBeenCalledWith('password-reset-wait:user-1', JSON.stringify(1), 'EX', 60, 'NX')
      expect(result).toBe(true)
    })

    test('returns false when Redis returns null (key already exists)', async () => {
      mockRedisClient.set.mockResolvedValue(null)

      const result = await cacheService.setIfAbsent('password-reset-wait:user-1', 1, 60)

      expect(mockRedisClient.set).toHaveBeenCalledWith('password-reset-wait:user-1', JSON.stringify(1), 'EX', 60, 'NX')
      expect(result).toBe(false)
    })
  })

  describe('basic cache operations', () => {
    test('save serializes value with JSON.stringify and sets TTL', async () => {
      mockRedisClient.set.mockResolvedValue('OK')

      await cacheService.save('key', { foo: 'bar' }, 900)

      expect(mockRedisClient.set).toHaveBeenCalledWith('key', JSON.stringify({ foo: 'bar' }), 'EX', 900)
    })

    test('delete removes key from Redis', async () => {
      mockRedisClient.del.mockResolvedValue(1)

      await cacheService.delete('key')

      expect(mockRedisClient.del).toHaveBeenCalledWith('key')
    })

    test('get parses JSON or returns null', async () => {
      mockRedisClient.get.mockResolvedValue(JSON.stringify({ a: 1 }))
      expect(await cacheService.get('key')).toEqual({ a: 1 })

      mockRedisClient.get.mockResolvedValue(null)
      expect(await cacheService.get('key')).toBeNull()
    })

    test('getOrDefault returns default value when key does not exist', async () => {
      mockRedisClient.get.mockResolvedValue(null)
      expect(await cacheService.getOrDefault('key', 42)).toBe(42)

      mockRedisClient.get.mockResolvedValue('100')
      expect(await cacheService.getOrDefault('key', 42)).toBe(100)
    })
  })
})
