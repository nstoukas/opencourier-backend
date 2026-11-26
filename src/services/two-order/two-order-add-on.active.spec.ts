import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryWithLocationsEntity } from 'src/domains/delivery/entities/delivery-with-locations.entity'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { CacheService } from 'src/services/cache/cache.service'
import { CacheHelpers } from 'src/services/cache/cache.helpers'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { EnumAddOnMoment, EnumTwoOrderPolicy } from 'src/shared-types/stacking'
import { EnumCourierMatcherType, EnumDeliveryStatus } from 'src/shared-types'
import { addOnJobStatuses } from 'src/domains/delivery/add-on'
import { TwoOrderService } from './two-order.service'

// Spec 0048 (row 81): TwoOrderService finds a mid job add on offer for a rider on a job.
// Covers:
// - AC-1: addOnOffersEnabled switch off by default
// - AC-3: shortage rule (SHORTAGE_ONLY vs WHENEVER_FITS, fitting add-on before free rider)
// - AC-6, cross check 3: candidate query for riders holding 1 job, fewest extra minutes wins, tie breaker
// - Cross check 5: OSRM road table failure returns null quietly
// - Decision 81.9: timed offer check (isDue callback)
describe('TwoOrderService add-on offers (spec 0048, row 81)', () => {
  let service: TwoOrderService
  let mockConfigService: any
  let mockDeliveryRepo: any
  let mockDeliveryEventRepo: any
  let mockCourierRepo: any
  let mockCacheService: any
  let mockOsrmService: any

  const pickupLoc = { latitude: 39.365, longitude: 22.945 }
  const dropoffLoc = { latitude: 39.372, longitude: 22.955 }

  const makeDelivery = (id: string, opts: Partial<DeliveryEntity> = {}): DeliveryEntity =>
    new DeliveryEntity({
      id,
      partnerId: 'partner-1',
      pickupLocationId: 'loc-pickup-1',
      dropoffLocationId: 'loc-dropoff-1',
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      boxUnits: 30,
      orderReference: `ref-${id}`,
      legCount: null,
      foodReadyAt: null,
      readyAt: null,
      ...opts,
    } as any)

  const makeDeliveryWithLocs = (id: string, opts: Partial<any> = {}): DeliveryWithLocationsEntity =>
    new DeliveryWithLocationsEntity({
      id,
      partnerId: 'partner-1',
      pickupLocationId: 'loc-pickup-1',
      dropoffLocationId: 'loc-dropoff-1',
      pickupLocation: pickupLoc,
      dropoffLocation: dropoffLoc,
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      boxUnits: 30,
      orderReference: `ref-${id}`,
      foodReadyAt: null,
      readyAt: null,
      ...opts,
    } as any)

  beforeEach(() => {
    mockConfigService = {
      instanceConfig: {
        getAddOnOffersEnabled: jest.fn().mockResolvedValue(true),
        getTwoOrderPolicy: jest.fn().mockResolvedValue(EnumTwoOrderPolicy.SHORTAGE_ONLY),
        getTwoOrderDelayLimitMinutes: jest.fn().mockResolvedValue(10),
        getAddOnMoment: jest.fn().mockResolvedValue(EnumAddOnMoment.BEFORE_PICKUP),
        getMaxAssignmentDistanceInKM: jest.fn().mockResolvedValue(5),
        getCourierMatcherTypeSetting: jest.fn().mockResolvedValue(EnumCourierMatcherType.FAIRNESS),
      },
    }

    mockDeliveryRepo = {
      findByIdOrThrowWithLocations: jest.fn().mockImplementation((id: string) => {
        if (id === 'job-held-1') {
          return Promise.resolve(
            makeDeliveryWithLocs('job-held-1', {
              status: EnumDeliveryStatus.ACCEPTED,
              courierId: 'courier-1',
            })
          )
        }
        return Promise.resolve(makeDeliveryWithLocs(id))
      }),
    }

    mockDeliveryEventRepo = {}

    mockCourierRepo = {
      findAddOnCandidates: jest.fn().mockResolvedValue([
        {
          courierId: 'courier-1',
          jobId: 'job-held-1',
          distance: 500,
          courierLocation: { latitude: 39.362, longitude: 22.942 },
        },
      ]),
    }

    mockCacheService = {
      getOrDefault: jest.fn().mockResolvedValue([]),
      membersStillCounting: jest.fn().mockResolvedValue([]),
    }

    // 5-point matrix: [rider, jobPickup, newPickup, jobDropoff, newDropoff]
    mockOsrmService = {
      getDurationAndDistanceMatrix: jest.fn().mockResolvedValue({
        seconds: [
          [0, 60, 100, 300, 360],
          [60, 0, 50, 240, 300],
          [100, 50, 0, 200, 250],
          [300, 240, 200, 0, 120],
          [360, 300, 250, 120, 0],
        ],
        metres: [
          [0, 500, 800, 2500, 3000],
          [500, 0, 400, 2000, 2500],
          [800, 400, 0, 1800, 2200],
          [2500, 2000, 1800, 0, 900],
          [3000, 2500, 2200, 900, 0],
        ],
      }),
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

  describe('findAddOn switch off (AC-1)', () => {
    it('returns null immediately when addOnOffersEnabled is false without searching candidates', async () => {
      mockConfigService.instanceConfig.getAddOnOffersEnabled.mockResolvedValueOnce(false)
      const delivery = makeDelivery('new-del')

      const result = await service.findAddOn(delivery, false, async () => true)

      expect(result).toBeNull()
      expect(mockCourierRepo.findAddOnCandidates).not.toHaveBeenCalled()
    })
  })

  describe('policy check: SHORTAGE_ONLY vs WHENEVER_FITS (AC-3, decision 81.3)', () => {
    it('under SHORTAGE_ONLY, returns null when a free rider was found', async () => {
      mockConfigService.instanceConfig.getTwoOrderPolicy.mockResolvedValueOnce(EnumTwoOrderPolicy.SHORTAGE_ONLY)
      const delivery = makeDelivery('new-del')

      // freeRiderFound = true
      const result = await service.findAddOn(delivery, true, async () => true)

      expect(result).toBeNull()
      expect(mockCourierRepo.findAddOnCandidates).not.toHaveBeenCalled()
    })

    it('under SHORTAGE_ONLY, proceeds when NO free rider was found (shortage)', async () => {
      mockConfigService.instanceConfig.getTwoOrderPolicy.mockResolvedValueOnce(EnumTwoOrderPolicy.SHORTAGE_ONLY)
      const delivery = makeDelivery('new-del')

      // freeRiderFound = false
      const result = await service.findAddOn(delivery, false, async () => true)

      expect(result).not.toBeNull()
      expect(result!.courierId).toBe('courier-1')
      expect(mockCourierRepo.findAddOnCandidates).toHaveBeenCalled()
    })

    it('under WHENEVER_FITS, searches and returns add on even when a free rider was found', async () => {
      mockConfigService.instanceConfig.getTwoOrderPolicy.mockResolvedValueOnce(EnumTwoOrderPolicy.WHENEVER_FITS)
      const delivery = makeDelivery('new-del')

      // freeRiderFound = true: under WHENEVER_FITS, a fitting add on goes before the free rider!
      const result = await service.findAddOn(delivery, true, async () => true)

      expect(result).not.toBeNull()
      expect(result!.courierId).toBe('courier-1')
      expect(result!.policy).toBe(EnumTwoOrderPolicy.WHENEVER_FITS)
      expect(result!.freeRiderFound).toBe(true)
      expect(result!.jobStatuses).toEqual(addOnJobStatuses(EnumAddOnMoment.BEFORE_PICKUP))
      expect(mockCourierRepo.findAddOnCandidates).toHaveBeenCalled()
    })
  })

  describe('STATIC matcher (Decision 81.15, row 185)', () => {
    it('returns null immediately without searching candidates when courierMatcherType is STATIC', async () => {
      mockConfigService.instanceConfig.getCourierMatcherTypeSetting.mockResolvedValueOnce(
        EnumCourierMatcherType.STATIC
      )
      const delivery = makeDelivery('new-del')

      const result = await service.findAddOn(delivery, false, async () => true)

      expect(result).toBeNull()
      expect(mockCourierRepo.findAddOnCandidates).not.toHaveBeenCalled()
    })
  })

  describe('candidate filtering & queries (cross check 3)', () => {
    it('passes pickupLocation, maxDistanceInKM, skip list, boxUnits, siblingOfDeliveryId, and jobStatuses to candidate query', async () => {
      const delivery = makeDelivery('del-to-match', { boxUnits: 45 })
      mockCacheService.membersStillCounting.mockResolvedValueOnce(['courier-skipped-1'])

      await service.findAddOn(delivery, false, async () => true)

      expect(mockCourierRepo.findAddOnCandidates).toHaveBeenCalledWith(
        {
          location: pickupLoc,
          maxDistanceInKM: 5,
          excludeCourierIds: ['courier-skipped-1'],
          boxUnits: 45,
          siblingOfDeliveryId: 'del-to-match',
        },
        5, // ADD_ON_CANDIDATE_LIMIT
        addOnJobStatuses(EnumAddOnMoment.BEFORE_PICKUP)
      )
    })

    it('passes DELIVERY_ONGOING_STATUSES to candidate query when addOnMoment is BEFORE_DROPOFF', async () => {
      mockConfigService.instanceConfig.getAddOnMoment.mockResolvedValueOnce(EnumAddOnMoment.BEFORE_DROPOFF)
      const delivery = makeDelivery('del-to-match')

      await service.findAddOn(delivery, false, async () => true)

      expect(mockCourierRepo.findAddOnCandidates).toHaveBeenCalledWith(
        expect.any(Object),
        5,
        addOnJobStatuses(EnumAddOnMoment.BEFORE_DROPOFF)
      )
    })

    describe('SAME_RESTAURANT moment and crowding out prevention (spec 0048, agy review, decision 81.22)', () => {
      it('returns null immediately without querying candidates when delivery has no partnerId', async () => {
        mockConfigService.instanceConfig.getAddOnMoment.mockResolvedValueOnce(EnumAddOnMoment.SAME_RESTAURANT)
        const delivery = makeDelivery('del-no-partner', { partnerId: null as any })

        const result = await service.findAddOn(delivery, false, async () => true)

        expect(result).toBeNull()
        expect(mockCourierRepo.findAddOnCandidates).not.toHaveBeenCalled()
      })

      it('passes sameRestaurantAs with partnerId and pickupLocationId to candidate query when partnerId is set', async () => {
        mockConfigService.instanceConfig.getAddOnMoment.mockResolvedValueOnce(EnumAddOnMoment.SAME_RESTAURANT)
        const delivery = makeDelivery('del-same-rest', {
          partnerId: 'partner-taverna-1',
          pickupLocationId: 'loc-pickup-taverna',
        })

        await service.findAddOn(delivery, false, async () => true)

        expect(mockCourierRepo.findAddOnCandidates).toHaveBeenCalledWith(
          expect.objectContaining({
            sameRestaurantAs: {
              partnerId: 'partner-taverna-1',
              pickupLocationId: 'loc-pickup-taverna',
            },
          }),
          5,
          addOnJobStatuses(EnumAddOnMoment.SAME_RESTAURANT)
        )
      })

      it('leaves sameRestaurantAs undefined for BEFORE_PICKUP and BEFORE_DROPOFF moments', async () => {
        // 1. BEFORE_PICKUP
        mockConfigService.instanceConfig.getAddOnMoment.mockResolvedValueOnce(EnumAddOnMoment.BEFORE_PICKUP)
        const del1 = makeDelivery('del-1', { partnerId: 'partner-1', pickupLocationId: 'loc-1' })
        await service.findAddOn(del1, false, async () => true)
        expect(mockCourierRepo.findAddOnCandidates).toHaveBeenLastCalledWith(
          expect.objectContaining({ sameRestaurantAs: undefined }),
          5,
          addOnJobStatuses(EnumAddOnMoment.BEFORE_PICKUP)
        )

        // 2. BEFORE_DROPOFF
        mockConfigService.instanceConfig.getAddOnMoment.mockResolvedValueOnce(EnumAddOnMoment.BEFORE_DROPOFF)
        const del2 = makeDelivery('del-2', { partnerId: 'partner-1', pickupLocationId: 'loc-1' })
        await service.findAddOn(del2, false, async () => true)
        expect(mockCourierRepo.findAddOnCandidates).toHaveBeenLastCalledWith(
          expect.objectContaining({ sameRestaurantAs: undefined }),
          5,
          addOnJobStatuses(EnumAddOnMoment.BEFORE_DROPOFF)
        )
      })

      it('prevents candidate crowding out: passes sameRestaurantAs so riders on jobs for other stores do not displace eligible rider', async () => {
        mockConfigService.instanceConfig.getAddOnMoment.mockResolvedValueOnce(EnumAddOnMoment.SAME_RESTAURANT)
        const delivery = makeDelivery('del-target', {
          partnerId: 'partner-target',
          pickupLocationId: 'loc-pickup-target',
        })

        mockCourierRepo.findAddOnCandidates.mockResolvedValueOnce([
          {
            courierId: 'courier-target-restaurant',
            jobId: 'job-target-restaurant',
            distance: 800,
            courierLocation: { latitude: 39.362, longitude: 22.942 },
          },
        ])

        mockDeliveryRepo.findByIdOrThrowWithLocations.mockImplementation((id: string) => {
          if (id === 'job-target-restaurant') {
            return Promise.resolve(
              makeDeliveryWithLocs('job-target-restaurant', {
                partnerId: 'partner-target',
                pickupLocationId: 'loc-pickup-target',
                status: EnumDeliveryStatus.ACCEPTED,
                courierId: 'courier-target-restaurant',
              })
            )
          }
          return Promise.resolve(
            makeDeliveryWithLocs(id, {
              partnerId: 'partner-target',
              pickupLocationId: 'loc-pickup-target',
            })
          )
        })

        const result = await service.findAddOn(delivery, false, async () => true)

        expect(result).not.toBeNull()
        expect(result!.courierId).toBe('courier-target-restaurant')
        expect(mockCourierRepo.findAddOnCandidates).toHaveBeenCalledWith(
          expect.objectContaining({
            sameRestaurantAs: { partnerId: 'partner-target', pickupLocationId: 'loc-pickup-target' },
          }),
          5,
          addOnJobStatuses(EnumAddOnMoment.SAME_RESTAURANT)
        )
      })
    })

    it('skips candidates whose job is not allowed by addOnMoment', async () => {
      // Moment is BEFORE_PICKUP, but candidate's job is already PICKED_UP
      mockDeliveryRepo.findByIdOrThrowWithLocations.mockImplementation((id: string) => {
        if (id === 'job-held-1') {
          return Promise.resolve(
            makeDeliveryWithLocs('job-held-1', {
              status: EnumDeliveryStatus.PICKED_UP,
              courierId: 'courier-1',
            })
          )
        }
        return Promise.resolve(makeDeliveryWithLocs(id))
      })

      const delivery = makeDelivery('new-del')
      const result = await service.findAddOn(delivery, false, async () => true)

      expect(result).toBeNull()
      expect(mockOsrmService.getDurationAndDistanceMatrix).not.toHaveBeenCalled()
    })

    it('skips candidates whose job + new delivery exceeds 100 box units', async () => {
      mockDeliveryRepo.findByIdOrThrowWithLocations.mockImplementation((id: string) => {
        if (id === 'job-held-1') {
          return Promise.resolve(
            makeDeliveryWithLocs('job-held-1', {
              boxUnits: 70,
              status: EnumDeliveryStatus.ACCEPTED,
              courierId: 'courier-1',
            })
          )
        }
        return Promise.resolve(makeDeliveryWithLocs(id, { boxUnits: 40 }))
      })

      const delivery = makeDelivery('new-del', { boxUnits: 40 }) // 70 + 40 = 110 > 100
      const result = await service.findAddOn(delivery, false, async () => true)

      expect(result).toBeNull()
      expect(mockOsrmService.getDurationAndDistanceMatrix).not.toHaveBeenCalled()
    })
  })

  describe('OSRM road tables and failure handling (cross check 5)', () => {
    it('returns null quietly when OSRM routing fails or is down', async () => {
      mockOsrmService.getDurationAndDistanceMatrix.mockRejectedValueOnce(new Error('OSRM 503 unavailable'))
      const delivery = makeDelivery('new-del')

      const result = await service.findAddOn(delivery, false, async () => true)

      expect(result).toBeNull()
    })
  })

  describe('winner selection & tie breaking (cross check 3, decision 81.4)', () => {
    it('picks the candidate that adds the fewest whole minutes', async () => {
      // Two candidates: candidate-A (+3 min, 180s) vs candidate-B (+1 min, 60s)
      mockCourierRepo.findAddOnCandidates.mockResolvedValueOnce([
        {
          courierId: 'courier-A',
          jobId: 'job-A',
          distance: 500,
          courierLocation: { latitude: 39.36, longitude: 22.94 },
        },
        {
          courierId: 'courier-B',
          jobId: 'job-B',
          distance: 600,
          courierLocation: { latitude: 39.361, longitude: 22.941 },
        },
      ])

      mockDeliveryRepo.findByIdOrThrowWithLocations.mockImplementation((id: string) => {
        if (id === 'job-A' || id === 'job-B') {
          return Promise.resolve(
            makeDeliveryWithLocs(id, {
              status: EnumDeliveryStatus.ACCEPTED,
              courierId: id === 'job-A' ? 'courier-A' : 'courier-B',
            })
          )
        }
        return Promise.resolve(makeDeliveryWithLocs(id))
      })

      // Return shorter matrix for B than for A
      mockOsrmService.getDurationAndDistanceMatrix
        .mockResolvedValueOnce({
          // Matrix for A: extra time ~ 180s (3 min)
          seconds: [
            [0, 60, 200, 300, 500],
            [60, 0, 150, 240, 440],
            [200, 150, 0, 180, 200],
            [300, 240, 180, 0, 100],
            [500, 440, 200, 100, 0],
          ],
          metres: [
            [0, 500, 1500, 2500, 4000],
            [500, 0, 1000, 2000, 3500],
            [1500, 1000, 0, 1800, 2000],
            [2500, 2000, 1800, 0, 1000],
            [4000, 3500, 2000, 1000, 0],
          ],
        })
        .mockResolvedValueOnce({
          // Matrix for B: extra time ~ 60s (1 min)
          seconds: [
            [0, 50, 60, 200, 260],
            [50, 0, 20, 150, 210],
            [60, 20, 0, 140, 190],
            [200, 150, 140, 0, 60],
            [260, 210, 190, 60, 0],
          ],
          metres: [
            [0, 400, 500, 1500, 2000],
            [400, 0, 200, 1100, 1600],
            [500, 200, 0, 1000, 1400],
            [1500, 1100, 1000, 0, 500],
            [2000, 1600, 1400, 500, 0],
          ],
        })

      const delivery = makeDelivery('new-del')
      const result = await service.findAddOn(delivery, false, async () => true)

      expect(result).not.toBeNull()
      expect(result!.courierId).toBe('courier-B')
      expect(result!.candidateCount).toBe(2)
      expect(result!.strategy).toBe(EnumCourierMatcherType.FAIRNESS)
    })

    it('breaks ties in whole minutes by shorter road time to the new pickup (secondsToNewPickup)', async () => {
      // Both candidates add 1 whole minute (e.g. 70s vs 80s, both round to 1 min),
      // but courier-near is 50s from new pickup vs courier-far is 120s from new pickup
      mockCourierRepo.findAddOnCandidates.mockResolvedValueOnce([
        {
          courierId: 'courier-far',
          jobId: 'job-far',
          distance: 500,
          courierLocation: { latitude: 39.36, longitude: 22.94 },
        },
        {
          courierId: 'courier-near',
          jobId: 'job-near',
          distance: 600,
          courierLocation: { latitude: 39.361, longitude: 22.941 },
        },
      ])

      mockDeliveryRepo.findByIdOrThrowWithLocations.mockImplementation((id: string) => {
        if (id === 'job-far' || id === 'job-near') {
          return Promise.resolve(
            makeDeliveryWithLocs(id, {
              status: EnumDeliveryStatus.ACCEPTED,
              courierId: id === 'job-far' ? 'courier-far' : 'courier-near',
            })
          )
        }
        return Promise.resolve(makeDeliveryWithLocs(id))
      })

      // Matrix for far: to new pickup is 120s
      mockOsrmService.getDurationAndDistanceMatrix
        .mockResolvedValueOnce({
          seconds: [
            [0, 50, 120, 200, 270],
            [50, 0, 70, 150, 220],
            [120, 70, 0, 140, 190],
            [200, 150, 140, 0, 60],
            [270, 220, 190, 60, 0],
          ],
          metres: [
            [0, 400, 1000, 1500, 2000],
            [400, 0, 600, 1100, 1600],
            [1000, 600, 0, 1000, 1400],
            [1500, 1100, 1000, 0, 500],
            [2000, 1600, 1400, 500, 0],
          ],
        })
        .mockResolvedValueOnce({
          // Matrix for near: to new pickup is 50s
          seconds: [
            [0, 50, 50, 200, 270],
            [50, 0, 20, 150, 220],
            [50, 20, 0, 140, 190],
            [200, 150, 140, 0, 60],
            [270, 220, 190, 60, 0],
          ],
          metres: [
            [0, 400, 400, 1500, 2000],
            [400, 0, 200, 1100, 1600],
            [400, 200, 0, 1000, 1400],
            [1500, 1100, 1000, 0, 500],
            [2000, 1600, 1400, 500, 0],
          ],
        })

      const delivery = makeDelivery('new-del')
      const result = await service.findAddOn(delivery, false, async () => true)

      expect(result).not.toBeNull()
      expect(result!.courierId).toBe('courier-near')
    })
  })

  describe('timed offers (decision 81.9)', () => {
    it('skips candidate when isDue returns false, passing courierId, secondsToNewPickup, and pickupLocation', async () => {
      const delivery = makeDelivery('new-del')
      const isDueSpy = jest.fn().mockResolvedValue(false)
      const result = await service.findAddOn(delivery, false, isDueSpy)

      expect(result).toBeNull()
      expect(isDueSpy).toHaveBeenCalledWith('courier-1', expect.any(Number), pickupLoc)
    })
  })
})
