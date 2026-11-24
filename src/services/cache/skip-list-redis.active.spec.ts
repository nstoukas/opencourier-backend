import { execFileSync } from 'child_process'
import { Redis } from 'ioredis'
import { CacheService } from './cache.service'
import { RedisClient } from '../redis/models/RedisClient'
import { addCourierToRejectedList, removeCourierFromRejectedList, getRejectedCourierIds } from './rejected-couriers'
import { CacheHelpers } from './cache.helpers'

// Probes whether Redis is listening before running real Redis tests.
// If Redis cannot be reached (e.g. running on a machine without Docker or with a closed port),
// describe.skip is used so the test suite skips cleanly and Jest exits 0 immediately.
function checkRedisReachable(urlStr: string): boolean {
  try {
    const url = new URL(urlStr)
    const host = url.hostname || 'localhost'
    const port = url.port || '6379'
    const probe = `
      const net = require('net');
      const socket = net.createConnection({ host: '${host}', port: ${port}, timeout: 400 });
      socket.on('connect', () => { socket.end(); process.exit(0); });
      socket.on('timeout', () => { socket.destroy(); process.exit(1); });
      socket.on('error', () => { process.exit(1); });
    `
    execFileSync(process.execPath, ['-e', probe], { timeout: 1000 })
    return true
  } catch {
    return false
  }
}

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6389'
const isRedisAvailable = checkRedisReachable(redisUrl)
const describeSuite = isRedisAvailable ? describe : describe.skip

// Scope row 148: Each rider on a delivery's skip list has their own end time in a Redis sorted set.
// Tests the ADD_WITH_OWN_EXPIRY Lua script and membersStillCounting against real Redis.
describeSuite('Row 148: Skip list Lua script and sorted set operations (against real Redis)', () => {
  let redis: Redis
  let cacheService: CacheService

  const testKey = 'test-skip-list:del-148'

  beforeAll(async () => {
    if (!isRedisAvailable) {
      return
    }
    const url = new URL(redisUrl)
    redis = new Redis({
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      retryStrategy: () => null,
      lazyConnect: true,
    })
    try {
      await redis.connect()
      cacheService = new CacheService(redis as unknown as RedisClient)
    } catch (err) {
      if (redis) {
        redis.disconnect()
      }
      throw err
    }
  })

  afterAll(async () => {
    if (redis) {
      try {
        await redis.del(testKey)
      } catch {}
      redis.disconnect()
    }
  })

  beforeEach(async () => {
    if (redis) {
      await redis.del(testKey)
    }
  })

  // Done when (1): A rider put on a delivery's skip list can be offered it again once offerSkipMinutes
  // has passed for them, whatever riders were added after.
  // Done when (5): A test fails if a later add restarts an earlier rider's time.
  describe('Clause 1 & 5: Riders expire at their own time independently; later add never restarts earlier rider time', () => {
    it('rider-1 expires after their own duration even when rider-2 is added later', async () => {
      const t0 = 1000000000000 // fixed reference epoch ms

      // Step 1: Add rider-1 with 10s skip duration (ends at t0 + 10s)
      const added1 = await cacheService.addWithOwnExpiry(testKey, 'rider-1', t0, t0 + 10000)
      expect(added1).toBe(true)

      // Step 2: 5s later, add rider-2 with 10s skip duration (ends at t0 + 15s)
      const added2 = await cacheService.addWithOwnExpiry(testKey, 'rider-2', t0 + 5000, t0 + 15000)
      expect(added2).toBe(true)

      // Both riders count at t0 + 6s
      const countingAt6s = await cacheService.membersStillCounting(testKey, t0 + 6000)
      expect(countingAt6s.sort()).toEqual(['rider-1', 'rider-2'])

      // At t0 + 11s (rider-1's 10s has passed, but rider-2's 15s has NOT passed):
      // Rider-1 is NO LONGER counting (can be offered again), while rider-2 is STILL counting.
      // Crucial Clause 5 check: if rider-2's add had restarted rider-1's time (to t0 + 15s), rider-1 would still be here!
      const countingAt11s = await cacheService.membersStillCounting(testKey, t0 + 11000)
      expect(countingAt11s).toEqual(['rider-2'])
      expect(countingAt11s).not.toContain('rider-1')

      // At t0 + 16s (both have passed):
      const countingAt16s = await cacheService.membersStillCounting(testKey, t0 + 16000)
      expect(countingAt16s).toEqual([])
    })

    it('score in Redis sorted set remains rider-1 original end time after rider-2 is added', async () => {
      const t0 = 2000000000000
      await cacheService.addWithOwnExpiry(testKey, 'rider-1', t0, t0 + 10000)

      // Add rider-2 later with higher end time
      await cacheService.addWithOwnExpiry(testKey, 'rider-2', t0 + 5000, t0 + 15000)

      // Score for rider-1 must be exactly t0 + 10000, NOT reset to anything else
      const scoreRider1 = await redis.zscore(testKey, 'rider-1')
      const scoreRider2 = await redis.zscore(testKey, 'rider-2')

      expect(Number(scoreRider1)).toBe(t0 + 10000)
      expect(Number(scoreRider2)).toBe(t0 + 15000)
    })
  })

  // Done when (2): Undoing one rider's entry leaves the others' times alone.
  describe('Clause 2: Undoing one rider entry leaves other riders and their end times untouched', () => {
    it('removing rider-1 leaves rider-2 on the skip list with its original score', async () => {
      const t0 = 3000000000000
      await cacheService.addWithOwnExpiry(testKey, 'rider-1', t0, t0 + 10000)
      await cacheService.addWithOwnExpiry(testKey, 'rider-2', t0, t0 + 20000)

      // Undo rider-1 entry
      await cacheService.removeMember(testKey, 'rider-1')

      // Rider-1 is gone
      const scoreRider1 = await redis.zscore(testKey, 'rider-1')
      expect(scoreRider1).toBeNull()

      // Rider-2 is still present and its end time is still intact
      const scoreRider2 = await redis.zscore(testKey, 'rider-2')
      expect(Number(scoreRider2)).toBe(t0 + 20000)

      // At t0 + 15000, rider-2 is still counting
      const counting = await cacheService.membersStillCounting(testKey, t0 + 15000)
      expect(counting).toEqual(['rider-2'])
    })
  })

  // Done when (3): Expired entries never keep a rider skipped.
  describe('Clause 3: Expired entries never keep a rider skipped, and Lua drops expired members', () => {
    it('exact end moment is exclusive: rider at now = end no longer counts', async () => {
      const t0 = 4000000000000
      const ends = t0 + 10000
      await cacheService.addWithOwnExpiry(testKey, 'rider-1', t0, ends)

      // 1 ms before end: still counting
      expect(await cacheService.membersStillCounting(testKey, ends - 1)).toEqual(['rider-1'])

      // Exactly at end: '(' bound makes it non-counting
      expect(await cacheService.membersStillCounting(testKey, ends)).toEqual([])

      // After end: non-counting
      expect(await cacheService.membersStillCounting(testKey, ends + 1)).toEqual([])
    })

    it('Lua script purges expired members via ZREMRANGEBYSCORE when adding a new member', async () => {
      const t0 = 5000000000000

      // Rider-1 ends at t0 + 5000
      await cacheService.addWithOwnExpiry(testKey, 'rider-1', t0, t0 + 5000)

      // Now is t0 + 8000: rider-1 has expired. We add rider-2 ending at t0 + 18000.
      await cacheService.addWithOwnExpiry(testKey, 'rider-2', t0 + 8000, t0 + 18000)

      // Check raw Redis members in sorted set: rider-1 must have been purged from the set!
      const rawMembers = await redis.zrange(testKey, 0, -1)
      expect(rawMembers).toEqual(['rider-2'])
      expect(rawMembers).not.toContain('rider-1')
    })

    it('Lua script sets key PEXPIRE to match last member remaining end time', async () => {
      const now = Date.now()
      const endMs = now + 60000

      await cacheService.addWithOwnExpiry(testKey, 'rider-ttl', now, endMs)

      const pttl = await redis.pttl(testKey)
      // PTTL should be close to 60000 ms (allowing slight test execution margin)
      expect(pttl).toBeGreaterThan(55000)
      expect(pttl).toBeLessThanOrEqual(60000)
    })
  })

  describe('Edge cases and decisions', () => {
    // Decision 148.3: A rider skipped again keeps the later end (ZADD GT)
    it('keeps later end when same rider is skipped again with a shorter end (ZADD GT)', async () => {
      const t0 = 6000000000000

      // First skip: 20s
      const firstAdd = await cacheService.addWithOwnExpiry(testKey, 'rider-1', t0, t0 + 20000)
      expect(firstAdd).toBe(true)

      // Second skip 5s later with only 5s duration (would end at t0 + 10s): GT keeps t0 + 20s
      const secondAdd = await cacheService.addWithOwnExpiry(testKey, 'rider-1', t0 + 5000, t0 + 10000)
      // Returns false because rider-1 was already counting
      expect(secondAdd).toBe(false)

      // Score remains the later end (t0 + 20000)
      const score = await redis.zscore(testKey, 'rider-1')
      expect(Number(score)).toBe(t0 + 20000)

      // At t0 + 15s (after the second add's requested end), rider-1 is STILL counting
      expect(await cacheService.membersStillCounting(testKey, t0 + 15000)).toEqual(['rider-1'])
    })

    it('returns true when rider is added again after their previous skip expired', async () => {
      const t0 = 7000000000000

      // First skip expires at t0 + 5000
      await cacheService.addWithOwnExpiry(testKey, 'rider-1', t0, t0 + 5000)

      // At t0 + 10000 (after expiry), rider is skipped again
      const reAdd = await cacheService.addWithOwnExpiry(testKey, 'rider-1', t0 + 10000, t0 + 20000)
      // Was not counting prior to this call => returns true
      expect(reAdd).toBe(true)

      const score = await redis.zscore(testKey, 'rider-1')
      expect(Number(score)).toBe(t0 + 20000)
    })

    it('membersStillCounting returns empty array on non-existent key', async () => {
      const result = await cacheService.membersStillCounting('non-existent-key-1234', Date.now())
      expect(result).toEqual([])
    })

    it('removeMember silently succeeds on non-existent key or member', async () => {
      await expect(cacheService.removeMember('non-existent-key-1234', 'non-member')).resolves.not.toThrow()
    })
  })

  describe('End-to-end helpers with rejected-couriers.ts on real Redis', () => {
    const deliveryId = 'del-e2e-148'
    const delKey = CacheHelpers.getDeliveryRejectedCouriersKey(deliveryId)

    afterEach(async () => {
      if (redis) {
        await redis.del(delKey)
      }
    })

    it('addCourierToRejectedList, getRejectedCourierIds, and removeCourierFromRejectedList work end-to-end', async () => {
      // Add rider-1 for 60s
      const added = await addCourierToRejectedList(cacheService, deliveryId, 'courier-A', 60)
      expect(added).toBe(true)

      // Immediately read rejected courier IDs
      const ids = await getRejectedCourierIds(cacheService, deliveryId)
      expect(ids).toEqual(['courier-A'])

      // Adding courier-A again returns false
      const addedAgain = await addCourierToRejectedList(cacheService, deliveryId, 'courier-A', 60)
      expect(addedAgain).toBe(false)

      // Add courier-B
      await addCourierToRejectedList(cacheService, deliveryId, 'courier-B', 60)
      const twoIds = await getRejectedCourierIds(cacheService, deliveryId)
      expect(twoIds.sort()).toEqual(['courier-A', 'courier-B'])

      // Remove courier-A: courier-B remains
      await removeCourierFromRejectedList(cacheService, deliveryId, 'courier-A')
      const remainingIds = await getRejectedCourierIds(cacheService, deliveryId)
      expect(remainingIds).toEqual(['courier-B'])

      // Remove courier-B: empty
      await removeCourierFromRejectedList(cacheService, deliveryId, 'courier-B')
      const emptyIds = await getRejectedCourierIds(cacheService, deliveryId)
      expect(emptyIds).toEqual([])
    })
  })
})
