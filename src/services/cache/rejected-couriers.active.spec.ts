import { CacheService } from './cache.service'
import { CacheHelpers } from './cache.helpers'
import {
  addCourierToRejectedList,
  removeCourierFromRejectedList,
  getRejectedCourierIds,
} from './rejected-couriers'

// Scope rows 144 & 148: Each rider on a delivery's skip list has their own end time in a Redis sorted set.
// addCourierToRejectedList calls addWithOwnExpiry, removeCourierFromRejectedList calls removeMember,
// and getRejectedCourierIds calls membersStillCounting.
describe('rejected-couriers cache helpers (rows 144 & 148)', () => {
  let mockCacheService: {
    addWithOwnExpiry: jest.Mock
    removeMember: jest.Mock
    membersStillCounting: jest.Mock
  }

  const deliveryId = 'del-skip-1'
  const courierId = 'courier-1'
  const key = CacheHelpers.getDeliveryRejectedCouriersKey(deliveryId)

  beforeEach(() => {
    mockCacheService = {
      addWithOwnExpiry: jest.fn().mockResolvedValue(true),
      removeMember: jest.fn().mockResolvedValue(undefined),
      membersStillCounting: jest.fn().mockResolvedValue([]),
    }
  })

  describe('key format (row 148)', () => {
    it('uses delivery-skip-list:<id> sorted set key, not old array key', () => {
      expect(key).toBe(`delivery-skip-list:${deliveryId}`)
    })
  })

  describe('addCourierToRejectedList', () => {
    it('calls addWithOwnExpiry with key, courierId, nowMs, and endsAtMs = now + ttlSeconds * 1000', async () => {
      const fixedNow = 1732460000000
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow)

      mockCacheService.addWithOwnExpiry.mockResolvedValueOnce(true)

      const result = await addCourierToRejectedList(
        mockCacheService as unknown as CacheService,
        deliveryId,
        courierId,
        300
      )

      expect(result).toBe(true)
      expect(mockCacheService.addWithOwnExpiry).toHaveBeenCalledWith(
        key,
        courierId,
        fixedNow,
        fixedNow + 300 * 1000
      )

      jest.restoreAllMocks()
    })

    it('returns false when addWithOwnExpiry returns false (courier already counted)', async () => {
      const fixedNow = 1732460000000
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow)

      mockCacheService.addWithOwnExpiry.mockResolvedValueOnce(false)

      const result = await addCourierToRejectedList(
        mockCacheService as unknown as CacheService,
        deliveryId,
        courierId,
        420
      )

      expect(result).toBe(false)
      expect(mockCacheService.addWithOwnExpiry).toHaveBeenCalledWith(
        key,
        courierId,
        fixedNow,
        fixedNow + 420 * 1000
      )

      jest.restoreAllMocks()
    })
  })

  describe('removeCourierFromRejectedList', () => {
    it('calls removeMember with key and courierId (no ttlSeconds needed)', async () => {
      await removeCourierFromRejectedList(
        mockCacheService as unknown as CacheService,
        deliveryId,
        courierId
      )

      expect(mockCacheService.removeMember).toHaveBeenCalledTimes(1)
      expect(mockCacheService.removeMember).toHaveBeenCalledWith(key, courierId)
    })
  })

  describe('getRejectedCourierIds', () => {
    it('calls membersStillCounting with key and Date.now(), returning unexpired courier IDs', async () => {
      const fixedNow = 1732460050000
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow)
      mockCacheService.membersStillCounting.mockResolvedValueOnce(['courier-1', 'courier-2'])

      const result = await getRejectedCourierIds(
        mockCacheService as unknown as CacheService,
        deliveryId
      )

      expect(mockCacheService.membersStillCounting).toHaveBeenCalledWith(key, fixedNow)
      expect(result).toEqual(['courier-1', 'courier-2'])

      jest.restoreAllMocks()
    })

    it('returns empty array when membersStillCounting returns empty array', async () => {
      mockCacheService.membersStillCounting.mockResolvedValueOnce([])

      const result = await getRejectedCourierIds(
        mockCacheService as unknown as CacheService,
        deliveryId
      )

      expect(result).toEqual([])
    })
  })
})
