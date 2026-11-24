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
    zrangebyscore: jest.Mock
    zrem: jest.Mock
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
      zrangebyscore: jest.fn(),
      zrem: jest.fn(),
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

  describe('Row 148: Sorted set skip list operations', () => {
    describe('addWithOwnExpiry', () => {
      test('calls redisClient.eval with ADD_WITH_OWN_EXPIRY Lua script, 1 key, key, member, nowMs, and endsAtMs', async () => {
        mockRedisClient.eval.mockResolvedValue(1)

        const result = await cacheService.addWithOwnExpiry('skip-key', 'rider-1', 1000, 5000)

        expect(mockRedisClient.eval).toHaveBeenCalledTimes(1)
        const [script, numKeys, key, member, nowMs, endsAtMs] = mockRedisClient.eval.mock.calls[0]
        expect(numKeys).toBe(1)
        expect(key).toBe('skip-key')
        expect(member).toBe('rider-1')
        expect(nowMs).toBe(1000)
        expect(endsAtMs).toBe(5000)

        // Script content verification: Lua idioms for sorted set with own expiry
        expect(script).toContain("redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)")
        expect(script).toContain("redis.call('ZSCORE', KEYS[1], ARGV[1])")
        expect(script).toContain("redis.call('ZADD', KEYS[1], 'GT', ends, ARGV[1])")
        expect(script).toContain("redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')")
        expect(script).toContain("redis.call('PEXPIRE', KEYS[1], math.max(1, tonumber(last[2]) - now))")
        expect(script).toContain('if before == false then return 1 end')

        expect(result).toBe(true)
      })

      test('returns true when eval returns 1 or "1" (member newly started counting)', async () => {
        mockRedisClient.eval.mockResolvedValueOnce(1)
        expect(await cacheService.addWithOwnExpiry('k', 'm', 100, 200)).toBe(true)

        mockRedisClient.eval.mockResolvedValueOnce('1')
        expect(await cacheService.addWithOwnExpiry('k', 'm', 100, 200)).toBe(true)
      })

      test('returns false when eval returns 0 or "0" (member was already counting)', async () => {
        mockRedisClient.eval.mockResolvedValueOnce(0)
        expect(await cacheService.addWithOwnExpiry('k', 'm', 100, 200)).toBe(false)

        mockRedisClient.eval.mockResolvedValueOnce('0')
        expect(await cacheService.addWithOwnExpiry('k', 'm', 100, 200)).toBe(false)
      })
    })

    describe('membersStillCounting', () => {
      test('calls redisClient.zrangebyscore with exclusive lower bound `(${nowMs}` and upper bound `+inf`', async () => {
        mockRedisClient.zrangebyscore.mockResolvedValue(['rider-1', 'rider-2'])

        const result = await cacheService.membersStillCounting('skip-key', 1732460000000)

        expect(mockRedisClient.zrangebyscore).toHaveBeenCalledTimes(1)
        expect(mockRedisClient.zrangebyscore).toHaveBeenCalledWith(
          'skip-key',
          '(1732460000000',
          '+inf'
        )
        expect(result).toEqual(['rider-1', 'rider-2'])
      })

      test('returns empty array when zrangebyscore returns empty array', async () => {
        mockRedisClient.zrangebyscore.mockResolvedValue([])

        const result = await cacheService.membersStillCounting('skip-key', 1732460000000)

        expect(result).toEqual([])
      })
    })

    describe('removeMember', () => {
      test('calls redisClient.zrem with key and member', async () => {
        mockRedisClient.zrem.mockResolvedValue(1)

        await cacheService.removeMember('skip-key', 'rider-1')

        expect(mockRedisClient.zrem).toHaveBeenCalledTimes(1)
        expect(mockRedisClient.zrem).toHaveBeenCalledWith('skip-key', 'rider-1')
      })
    })
  })
})
