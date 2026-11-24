import { CacheService } from './cache.service'
import { CacheHelpers } from './cache.helpers'
import { addCourierToRejectedList, removeCourierFromRejectedList } from './rejected-couriers'

// Scope row 144: How long a skipped rider waits is a co-op setting.
// The skip list helpers (addCourierToRejectedList, removeCourierFromRejectedList) take ttlSeconds,
// which callers provide dynamically from offerSkipMinutes * 60.
describe('rejected-couriers cache helpers (row 144)', () => {
  let mockCacheService: {
    getOrDefault: jest.Mock
    save: jest.Mock
    delete: jest.Mock
  }

  const deliveryId = 'del-skip-1'
  const courierId = 'courier-1'
  const key = CacheHelpers.getDeliveryRejectedCouriersKey(deliveryId)

  beforeEach(() => {
    mockCacheService = {
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    }
  })

  describe('addCourierToRejectedList', () => {
    it('saves courier with the passed ttlSeconds (e.g. 300 s for 5 min setting) and returns true when newly added', async () => {
      mockCacheService.getOrDefault.mockResolvedValueOnce([])

      const result = await addCourierToRejectedList(
        mockCacheService as unknown as CacheService,
        deliveryId,
        courierId,
        300
      )

      expect(result).toBe(true)
      expect(mockCacheService.getOrDefault).toHaveBeenCalledWith(key, [])
      expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 300)
    })

    it('saves with updated ttlSeconds (e.g. 420 s for 7 min setting) when representative changed the setting', async () => {
      mockCacheService.getOrDefault.mockResolvedValueOnce([])

      const result = await addCourierToRejectedList(
        mockCacheService as unknown as CacheService,
        deliveryId,
        courierId,
        420
      )

      expect(result).toBe(true)
      expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 420)
    })

    it('returns false when courier was already on the list, but still refreshes the key with ttlSeconds', async () => {
      mockCacheService.getOrDefault.mockResolvedValueOnce([courierId, 'other-courier'])

      const result = await addCourierToRejectedList(
        mockCacheService as unknown as CacheService,
        deliveryId,
        courierId,
        300
      )

      expect(result).toBe(false)
      // Array is unchanged, but key expiry is refreshed with the current ttlSeconds
      expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId, 'other-courier'], 300)
    })
  })

  describe('removeCourierFromRejectedList', () => {
    it('deletes the key (no save) when the last courier comes off (empty list)', async () => {
      mockCacheService.getOrDefault.mockResolvedValueOnce([courierId])

      await removeCourierFromRejectedList(mockCacheService as unknown as CacheService, deliveryId, courierId, 300)

      expect(mockCacheService.getOrDefault).toHaveBeenCalledWith(key, [])
      expect(mockCacheService.delete).toHaveBeenCalledWith(key)
      expect(mockCacheService.save).not.toHaveBeenCalled()
    })

    it('removes courier and saves remaining list with the passed ttlSeconds (non-empty remainder, no delete)', async () => {
      mockCacheService.getOrDefault.mockResolvedValueOnce([courierId, 'courier-2'])

      await removeCourierFromRejectedList(mockCacheService as unknown as CacheService, deliveryId, courierId, 300)

      expect(mockCacheService.getOrDefault).toHaveBeenCalledWith(key, [])
      expect(mockCacheService.save).toHaveBeenCalledWith(key, ['courier-2'], 300)
      expect(mockCacheService.delete).not.toHaveBeenCalled()
    })

    it('saves with updated ttlSeconds (e.g. 420 s for 7 min setting) when representative changed the setting', async () => {
      mockCacheService.getOrDefault.mockResolvedValueOnce([courierId, 'courier-2'])

      await removeCourierFromRejectedList(mockCacheService as unknown as CacheService, deliveryId, courierId, 420)

      expect(mockCacheService.save).toHaveBeenCalledWith(key, ['courier-2'], 420)
      expect(mockCacheService.delete).not.toHaveBeenCalled()
    })
  })
})
