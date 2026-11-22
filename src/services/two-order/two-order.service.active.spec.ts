import { EnumDeliveryEventType } from '@prisma/types'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryWithLocationsEntity } from 'src/domains/delivery/entities/delivery-with-locations.entity'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { CacheService } from 'src/services/cache/cache.service'
import { CacheHelpers } from 'src/services/cache/cache.helpers'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { EnumTwoOrderPolicy } from 'src/shared-types/stacking'
import { TwoOrderService } from './two-order.service'

// Spec 0048 (row 80): TwoOrderService finds a compatible second waiting delivery for a stack offer.
// AC-1 (switches defaulting off), AC-2 (compatibility and box limits), AC-3 (shortage vs whenever fits),
// AC-4 (stack formation), cross check 4 (filters and distance), cross check 5 (OSRM and delays),
// cross check 9 (pair block in Redis), cross check 11 (both due).
describe('TwoOrderService (spec 0048, row 80)', () => {
  let service: TwoOrderService
  let mockConfigService: any
  let mockDeliveryRepo: any
  let mockDeliveryEventRepo: any
  let mockCourierRepo: any
  let mockCacheService: any
  let mockOsrmService: any

  const courierId = 'courier-r80'
  const riderLocation = { latitude: 39.362, longitude: 22.942 }
  const pickupLoc = { latitude: 39.365, longitude: 22.945 }
  const dropoffLoc = { latitude: 39.372, longitude: 22.955 }

  const makeDelivery = (id: string, partnerId = 'partner-1', boxUnits = 30): DeliveryEntity =>
    new DeliveryEntity({
      id,
      partnerId,
      pickupLocationId: 'loc-pickup-1',
      dropoffLocationId: 'loc-dropoff-1',
      boxUnits,
      orderReference: `ref-${id}`,
      legCount: null,
      foodReadyAt: null,
      readyAt: null,
    } as any)

  const makeDeliveryWithLocs = (id: string): DeliveryWithLocationsEntity =>
    new DeliveryWithLocationsEntity({
      id,
      pickupLocation: pickupLoc,
      dropoffLocation: dropoffLoc,
    } as any)

  beforeEach(() => {
    mockConfigService = {
      instanceConfig: {
        getStackingEnabled: jest.fn().mockResolvedValue(true),
        getTwoOrderPolicy: jest.fn().mockResolvedValue(EnumTwoOrderPolicy.SHORTAGE_ONLY),
        getTwoOrderDelayLimitMinutes: jest.fn().mockResolvedValue(10),
        getMaxAssignmentDistance: jest.fn().mockResolvedValue(5), // 5 km
      },
    }

    mockDeliveryRepo = {
      findStackPartnerCandidates: jest.fn().mockResolvedValue([]),
      findByIdOrThrowWithLocations: jest.fn().mockImplementation((id: string) => Promise.resolve(makeDeliveryWithLocs(id))),
    }

    mockDeliveryEventRepo = {
      findLatestOfTypes: jest.fn().mockResolvedValue({ type: EnumDeliveryEventType.NO_COURIER_AVAILABLE }),
    }

    mockCourierRepo = {
      heldDeliveryCount: jest.fn().mockResolvedValue(0),
      heldBoxUnits: jest.fn().mockResolvedValue(0),
      getCurrentLocation: jest.fn().mockResolvedValue(riderLocation),
    }

    mockCacheService = {
      get: jest.fn().mockResolvedValue(null),
      getOrDefault: jest.fn().mockResolvedValue([]),
    }

    mockOsrmService = {
      getDurationMatrix: jest.fn().mockResolvedValue([
        [0, 60, 70, 150, 180],
        [60, 0, 20, 100, 140],
        [70, 20, 0, 120, 110],
        [150, 100, 120, 0, 80],
        [180, 140, 110, 80, 0],
      ]),
    }

    service = new TwoOrderService(
      mockConfigService as unknown as ConfigDomainService,
      mockDeliveryRepo as unknown as DeliveryRepository,
      mockDeliveryEventRepo as unknown as DeliveryEventRepository,
      mockCourierRepo as unknown as CourierRepository,
      mockCacheService as unknown as CacheService,
      mockOsrmService as unknown as OsrmRoutingService
    )
  })

  describe('findStackPartner', () => {
    it('returns null when stackingEnabled is false (AC-1: switch off)', async () => {
      mockConfigService.instanceConfig.getStackingEnabled.mockResolvedValueOnce(false)
      const first = makeDelivery('del-1')

      const result = await service.findStackPartner(first, courierId, async () => true)

      expect(result).toBeNull()
      expect(mockDeliveryRepo.findStackPartnerCandidates).not.toHaveBeenCalled()
    })

    it('returns null when courier already holds any deliveries (key invariant: rider holds nothing else)', async () => {
      mockCourierRepo.heldDeliveryCount.mockResolvedValueOnce(1)
      const first = makeDelivery('del-1')

      const result = await service.findStackPartner(first, courierId, async () => true)

      expect(result).toBeNull()
      expect(mockDeliveryRepo.findStackPartnerCandidates).not.toHaveBeenCalled()
    })

    it('returns null when remaining box room is less than 1 unit (spec 0043)', async () => {
      const hugeDelivery = makeDelivery('del-1', 'partner-1', 100) // Takes all 100 units
      const result = await service.findStackPartner(hugeDelivery, courierId, async () => true)

      expect(result).toBeNull()
      expect(mockDeliveryRepo.findStackPartnerCandidates).not.toHaveBeenCalled()
    })

    it('returns null when courier has no known location', async () => {
      mockCourierRepo.getCurrentLocation.mockResolvedValueOnce(null)
      const first = makeDelivery('del-1')

      const result = await service.findStackPartner(first, courierId, async () => true)

      expect(result).toBeNull()
      expect(mockDeliveryRepo.findStackPartnerCandidates).not.toHaveBeenCalled()
    })

    it('passes remaining room, courier location and maxAssignmentDistance (in metres) to candidate query', async () => {
      const first = makeDelivery('del-1', 'partner-1', 40)
      mockCourierRepo.heldBoxUnits.mockResolvedValueOnce(10) // 100 - 40 - 10 = 50 units room
      mockConfigService.instanceConfig.getMaxAssignmentDistance.mockResolvedValueOnce(3.5) // 3.5 km = 3500 m

      await service.findStackPartner(first, courierId, async () => true)

      expect(mockDeliveryRepo.findStackPartnerCandidates).toHaveBeenCalledWith(
        first,
        50,
        5,
        {
          rider: riderLocation,
          maxMetres: 3500,
        }
      )
    })

    it('returns null when no candidate deliveries are waiting', async () => {
      mockDeliveryRepo.findStackPartnerCandidates.mockResolvedValueOnce([])
      const first = makeDelivery('del-1')

      const result = await service.findStackPartner(first, courierId, async () => true)

      expect(result).toBeNull()
    })

    it('skips candidates that fail stackRefusal (e.g. two legs of one order)', async () => {
      const first = makeDelivery('del-leg-1', 'partner-1', 40)
      ;(first as any).orderReference = 'order-shared'
      ;(first as any).legCount = 2

      const second = makeDelivery('del-leg-2', 'partner-1', 40)
      ;(second as any).orderReference = 'order-shared'
      ;(second as any).legCount = 2

      mockDeliveryRepo.findStackPartnerCandidates.mockResolvedValueOnce([second])

      const result = await service.findStackPartner(first, courierId, async () => true)

      expect(result).toBeNull()
    })

    it('skips candidates that are blocked as a pair in Redis (cross check 9: 20 min block after decline/expiry)', async () => {
      const first = makeDelivery('del-1')
      const second = makeDelivery('del-2')
      mockDeliveryRepo.findStackPartnerCandidates.mockResolvedValueOnce([second])
      // Pair block exists in cache
      mockCacheService.get.mockResolvedValueOnce(true)

      const result = await service.findStackPartner(first, courierId, async () => true)

      expect(result).toBeNull()
      expect(mockCacheService.get).toHaveBeenCalledWith('stack-pair-block-del-1-del-2')
    })

    it('skips candidates where courier is on candidate skip list (cross check 4)', async () => {
      const first = makeDelivery('del-1')
      const second = makeDelivery('del-2')
      mockDeliveryRepo.findStackPartnerCandidates.mockResolvedValueOnce([second])
      // Courier is on second delivery's rejected list
      mockCacheService.getOrDefault.mockImplementation((key: string) => {
        if (key === CacheHelpers.getDeliveryRejectedCouriersKey(second.id)) return Promise.resolve([courierId])
        return Promise.resolve([])
      })

      const result = await service.findStackPartner(first, courierId, async () => true)

      expect(result).toBeNull()
    })

    describe('AC-3: shortage policy', () => {
      it('under SHORTAGE_ONLY: skips candidate if its newest event is NOT NO_COURIER_AVAILABLE', async () => {
        const first = makeDelivery('del-1')
        const second = makeDelivery('del-2')
        mockDeliveryRepo.findStackPartnerCandidates.mockResolvedValueOnce([second])
        // Second delivery was offered before and not yet NO_COURIER_AVAILABLE
        mockDeliveryEventRepo.findLatestOfTypes.mockResolvedValueOnce({ type: EnumDeliveryEventType.OFFERED })

        const result = await service.findStackPartner(first, courierId, async () => true)

        expect(result).toBeNull()
      })

      it('under SHORTAGE_ONLY: accepts candidate if newest event is NO_COURIER_AVAILABLE', async () => {
        const first = makeDelivery('del-1')
        const second = makeDelivery('del-2')
        mockDeliveryRepo.findStackPartnerCandidates.mockResolvedValueOnce([second])
        mockDeliveryEventRepo.findLatestOfTypes.mockResolvedValueOnce({ type: EnumDeliveryEventType.NO_COURIER_AVAILABLE })

        const result = await service.findStackPartner(first, courierId, async () => true)

        expect(result).not.toBeNull()
        expect(result?.partner.id).toBe('del-2')
      })

      it('under WHENEVER_FITS: accepts candidate without requiring NO_COURIER_AVAILABLE', async () => {
        mockConfigService.instanceConfig.getTwoOrderPolicy.mockResolvedValueOnce(EnumTwoOrderPolicy.WHENEVER_FITS)
        const first = makeDelivery('del-1')
        const second = makeDelivery('del-2')
        mockDeliveryRepo.findStackPartnerCandidates.mockResolvedValueOnce([second])
        mockDeliveryEventRepo.findLatestOfTypes.mockResolvedValueOnce({ type: EnumDeliveryEventType.OFFERED })

        const result = await service.findStackPartner(first, courierId, async () => true)

        expect(result).not.toBeNull()
        expect(result?.partner.id).toBe('del-2')
      })
    })

    it('skips candidate when isDue returns false (cross check 11: timed offers)', async () => {
      const first = makeDelivery('del-1')
      const second = makeDelivery('del-2')
      mockDeliveryRepo.findStackPartnerCandidates.mockResolvedValueOnce([second])

      const result = await service.findStackPartner(first, courierId, async () => false)

      expect(result).toBeNull()
    })

    it('returns null cleanly without throwing when OSRM routing throws (cross check 5: OSRM down)', async () => {
      const first = makeDelivery('del-1')
      const second = makeDelivery('del-2')
      mockDeliveryRepo.findStackPartnerCandidates.mockResolvedValueOnce([second])
      mockOsrmService.getDurationMatrix.mockRejectedValueOnce(new Error('OSRM 503 service unavailable'))

      const result = await service.findStackPartner(first, courierId, async () => true)

      expect(result).toBeNull()
    })

    it('happy path: returns partner and valid 4-stop sequence (AC-4)', async () => {
      const first = makeDelivery('del-1')
      const second = makeDelivery('del-2')
      mockDeliveryRepo.findStackPartnerCandidates.mockResolvedValueOnce([second])

      const result = await service.findStackPartner(first, courierId, async () => true)

      expect(result).not.toBeNull()
      expect(result?.partner.id).toBe('del-2')
      expect(result?.sequence.stops).toHaveLength(4)
      expect(result?.sequence.totalSeconds).toBeGreaterThan(0)
    })
  })
})
