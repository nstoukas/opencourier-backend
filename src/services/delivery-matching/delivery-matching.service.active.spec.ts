import { DeliveryMatchingService } from './delivery-matching.service'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { LocationDomainService } from 'src/domains/location/location.domain.service'
import { CourierMatcherService } from '../courier-matcher/courier-matcher.service'
import { CacheService } from '../cache/cache.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryNotFoundException, DeliveryOfferAlreadyMatchedException } from 'src/errors'
import { CacheHelpers } from '../cache/cache.helpers'

// Scope row 148: Matching reads each rider's skip time from Redis sorted set.
// A rider on a delivery's skip list must never be picked when matching that delivery.
describe('DeliveryMatchingService (Row 148: Skip list reader pinned)', () => {
  let service: DeliveryMatchingService
  let mockCourierDomainService: jest.Mocked<CourierDomainService>
  let mockLocationDomainService: jest.Mocked<LocationDomainService>
  let mockCourierMatcherService: jest.Mocked<CourierMatcherService>
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>
  let mockCacheService: jest.Mocked<CacheService>

  const dummyDelivery = {
    id: 'del-148',
    partnerId: 'partner-1',
    courierId: null,
    matchedCourierId: null,
    pickupLocationId: 'loc-pickup',
    dropoffLocationId: 'loc-dropoff',
    boxUnits: 25,
  }

  const dummyPickup = { id: 'loc-pickup', latitude: 39.3621, longitude: 22.9421 }
  const dummyDropoff = { id: 'loc-dropoff', latitude: 39.3701, longitude: 22.9501 }

  beforeEach(() => {
    mockCourierDomainService = {
      getByIdOrThrow: jest.fn().mockImplementation(async (id: string) => ({
        id,
        status: 'ONLINE',
      })),
    } as unknown as jest.Mocked<CourierDomainService>

    mockLocationDomainService = {
      getByIdOrThrow: jest.fn().mockImplementation(async (id: string) => {
        if (id === 'loc-pickup') return dummyPickup
        if (id === 'loc-dropoff') return dummyDropoff
        throw new Error(`Unknown location ${id}`)
      }),
    } as unknown as jest.Mocked<LocationDomainService>

    mockCourierMatcherService = {
      findCourierForDelivery: jest.fn(),
    } as unknown as jest.Mocked<CourierMatcherService>

    mockDeliveryRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue(dummyDelivery as any),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockCacheService = {
      membersStillCounting: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<CacheService>

    service = new DeliveryMatchingService(
      mockCourierDomainService,
      mockLocationDomainService,
      mockCourierMatcherService,
      mockDeliveryRepository,
      mockCacheService
    )
  })

  describe('Row 148 check (1): Rider on skip list is excluded and never picked', () => {
    it('never picks a rider who is on the delivery skip list, passing excluded courier IDs to matcher', async () => {
      // courier-skipped is on the delivery's skip list (still counting in Redis sorted set)
      mockCacheService.membersStillCounting.mockResolvedValueOnce(['courier-skipped'])

      // The matcher ranks courier-skipped first (e.g. closest or highest fairness score),
      // but must exclude any courier present in input.rejectedCourierIds.
      mockCourierMatcherService.findCourierForDelivery.mockImplementation(async (input) => {
        const candidateRanking = ['courier-skipped', 'courier-eligible-next']
        const eligible = candidateRanking.filter((id) => !input.rejectedCourierIds.includes(id))
        if (eligible.length === 0) return null
        return {
          courierId: eligible[0]!,
          distance: 500,
          travelSeconds: 180,
          reason: { strategy: 'fairness', candidates: [] } as any,
        }
      })

      const match = await service.findCourierForDelivery('del-148')

      // Assert: matcher input carried the rejected courier ID from getRejectedCourierIds
      expect(mockCourierMatcherService.findCourierForDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-148',
          rejectedCourierIds: ['courier-skipped'],
          boxUnits: 25,
        })
      )

      // Crucial assertion: the matched courier MUST NOT be courier-skipped
      expect(match).toBeDefined()
      expect(match?.courier.id).not.toBe('courier-skipped')
      expect(match?.courier.id).toBe('courier-eligible-next')
      expect(match?.travelSeconds).toBe(180)
    })

    it('returns undefined when all candidate couriers are on the delivery skip list', async () => {
      // Both couriers are on the skip list
      mockCacheService.membersStillCounting.mockResolvedValueOnce(['courier-1', 'courier-2'])

      mockCourierMatcherService.findCourierForDelivery.mockImplementation(async (input) => {
        const candidateRanking = ['courier-1', 'courier-2']
        const eligible = candidateRanking.filter((id) => !input.rejectedCourierIds.includes(id))
        if (eligible.length === 0) return null
        return { courierId: eligible[0]!, distance: 600 }
      })

      const match = await service.findCourierForDelivery('del-148')

      expect(mockCourierMatcherService.findCourierForDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          rejectedCourierIds: ['courier-1', 'courier-2'],
        })
      )
      expect(match).toBeUndefined()
    })

    it('getRejectedCourierIds queries membersStillCounting with the delivery rejected-couriers key and current time', async () => {
      mockCacheService.membersStillCounting.mockResolvedValueOnce(['courier-A', 'courier-B'])

      const before = Date.now()
      const rejectedIds = await service.getRejectedCourierIds('del-148')
      const after = Date.now()

      const expectedKey = CacheHelpers.getDeliveryRejectedCouriersKey('del-148')
      expect(mockCacheService.membersStillCounting).toHaveBeenCalledTimes(1)
      const call = mockCacheService.membersStillCounting.mock.calls[0]
      expect(call).toBeDefined()
      expect(call![0]).toBe(expectedKey)
      expect(call![1]).toBeGreaterThanOrEqual(before)
      expect(call![1]).toBeLessThanOrEqual(after)

      expect(rejectedIds).toEqual(['courier-A', 'courier-B'])
    })
  })

  describe('Happy path & edge cases', () => {
    it('matches top candidate when skip list is empty', async () => {
      mockCacheService.membersStillCounting.mockResolvedValueOnce([])

      mockCourierMatcherService.findCourierForDelivery.mockResolvedValueOnce({
        courierId: 'courier-top-choice',
        distance: 400,
        travelSeconds: 120,
        reason: { strategy: 'fairness', candidates: [] } as any,
      })

      const match = await service.findCourierForDelivery('del-148')

      expect(mockCourierMatcherService.findCourierForDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-148',
          rejectedCourierIds: [],
        })
      )
      expect(match?.courier.id).toBe('courier-top-choice')
      expect(match?.travelSeconds).toBe(120)
    })

    it('throws DeliveryNotFoundException if delivery has no partnerId', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        ...dummyDelivery,
        partnerId: null as any,
      } as any)

      await expect(service.findCourierForDelivery('del-148')).rejects.toThrow(DeliveryNotFoundException)
      expect(mockCourierMatcherService.findCourierForDelivery).not.toHaveBeenCalled()
    })

    it('throws DeliveryOfferAlreadyMatchedException if delivery already has courierId', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        ...dummyDelivery,
        courierId: 'already-assigned',
      } as any)

      await expect(service.findCourierForDelivery('del-148')).rejects.toThrow(DeliveryOfferAlreadyMatchedException)
      expect(mockCourierMatcherService.findCourierForDelivery).not.toHaveBeenCalled()
    })

    it('throws DeliveryOfferAlreadyMatchedException if delivery already has matchedCourierId', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        ...dummyDelivery,
        matchedCourierId: 'already-offered',
      } as any)

      await expect(service.findCourierForDelivery('del-148')).rejects.toThrow(DeliveryOfferAlreadyMatchedException)
      expect(mockCourierMatcherService.findCourierForDelivery).not.toHaveBeenCalled()
    })
  })
})
