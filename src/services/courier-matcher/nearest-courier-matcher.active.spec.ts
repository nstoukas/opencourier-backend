import { NearestCourierMatcherService } from './nearest-courier-matcher.service'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { GeoPosition } from 'src/shared-types'

// Acceptance Criteria AC-1, AC-4, AC-5: NearestCourierMatcherService tests
describe('NearestCourierMatcherService (Spec 0031: AC-1, AC-4, AC-5)', () => {
  let service: NearestCourierMatcherService
  let courierDomainService: jest.Mocked<CourierDomainService>
  let configDomainService: jest.Mocked<ConfigDomainService>
  let osrmRoutingService: jest.Mocked<OsrmRoutingService>
  let instanceConfig: any

  const pickupLocation: GeoPosition = { latitude: 39.3621, longitude: 22.9421 }
  const dropoffLocation: GeoPosition = { latitude: 39.3701, longitude: 22.9501 }

  beforeEach(() => {
    instanceConfig = {
      getMaxAssignmentDistanceInKM: jest.fn().mockResolvedValue(20),
      getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
      getOfferTimingCandidates: jest.fn().mockResolvedValue(5),
    }

    configDomainService = {
      instanceConfig,
    } as any

    courierDomainService = {
      getNearestAvailableCourier: jest.fn(),
      getNearestAvailableCandidates: jest.fn(),
    } as any

    osrmRoutingService = {
      getRoute: jest.fn(),
    } as any

    service = new NearestCourierMatcherService(
      courierDomainService,
      configDomainService,
      osrmRoutingService
    )
  })

  describe('AC-1: With offerTimingEnabled = false', () => {
    it('picks the nearest rider by straight distance and makes no OSRM road time calls', async () => {
      courierDomainService.getNearestAvailableCourier.mockResolvedValueOnce({
        courier: { id: 'courier-straight-nearest' },
        distance: 450,
      } as any)

      const result = await service.findCourierForDelivery({
        pickupLocation,
        dropoffLocation,
        rejectedCourierIds: ['courier-rejected-1'],
      })

      // Must call getNearestAvailableCourier with straight distance
      expect(courierDomainService.getNearestAvailableCourier).toHaveBeenCalledWith({
        location: { latitude: pickupLocation.latitude, longitude: pickupLocation.longitude },
        maxDistanceInKM: 20,
        excludeCourierIds: ['courier-rejected-1'],
      })
      // Must NOT call candidates or OSRM
      expect(courierDomainService.getNearestAvailableCandidates).not.toHaveBeenCalled()
      expect(osrmRoutingService.getRoute).not.toHaveBeenCalled()

      expect(result).toEqual({
        courierId: 'courier-straight-nearest',
        distance: 450,
      })
      // travelSeconds is undefined when timing is off
      expect(result?.travelSeconds).toBeUndefined()
    })

    it('returns null when no courier is available within max distance', async () => {
      courierDomainService.getNearestAvailableCourier.mockResolvedValueOnce(null)

      const result = await service.findCourierForDelivery({
        pickupLocation,
        dropoffLocation,
        rejectedCourierIds: [],
      })

      expect(result).toBeNull()
    })
  })

  describe('AC-4: With offerTimingEnabled = true', () => {
    beforeEach(() => {
      instanceConfig.getOfferTimingEnabled.mockResolvedValue(true)
    })

    it('ranks the nearest offerTimingCandidates riders by OSRM road time to pickup', async () => {
      // 3 candidates in straight-line order:
      // Candidate A: 500m straight line, road time 600s
      // Candidate B: 800m straight line, road time 240s (FASTEST ON ROAD)
      // Candidate C: 1200m straight line, road time 400s
      const candidates = [
        {
          courierId: 'courier-A',
          distance: 500,
          courierLocation: { latitude: 39.36, longitude: 22.94 },
        },
        {
          courierId: 'courier-B',
          distance: 800,
          courierLocation: { latitude: 39.37, longitude: 22.95 },
        },
        {
          courierId: 'courier-C',
          distance: 1200,
          courierLocation: { latitude: 39.38, longitude: 22.96 },
        },
      ]

      courierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce(candidates)

      osrmRoutingService.getRoute.mockImplementation(async (args) => {
        if (args.fromLocation.latitude === 39.36) return { durationSeconds: 600 } as any
        if (args.fromLocation.latitude === 39.37) return { durationSeconds: 240 } as any
        if (args.fromLocation.latitude === 39.38) return { durationSeconds: 400 } as any
        throw new Error('Unknown coordinate')
      })

      const result = await service.findCourierForDelivery({
        pickupLocation,
        dropoffLocation,
        rejectedCourierIds: [],
      })

      expect(instanceConfig.getOfferTimingCandidates).toHaveBeenCalled()
      expect(courierDomainService.getNearestAvailableCandidates).toHaveBeenCalledWith(
        { location: pickupLocation, maxDistanceInKM: 20, excludeCourierIds: [] },
        5
      )

      // Courier B should win because of shortest road travel time (240s vs 600s and 400s)
      expect(result).toEqual({
        courierId: 'courier-B',
        distance: 800,
        travelSeconds: 240,
      })
    })

    it('resolves ties in road time by preferring the nearer rider by straight distance', async () => {
      // Candidates A and B have identical road time (300s), but Candidate A is closer straight-line (400m vs 700m)
      const candidates = [
        {
          courierId: 'courier-A',
          distance: 400,
          courierLocation: { latitude: 39.36, longitude: 22.94 },
        },
        {
          courierId: 'courier-B',
          distance: 700,
          courierLocation: { latitude: 39.37, longitude: 22.95 },
        },
      ]

      courierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce(candidates)
      osrmRoutingService.getRoute.mockResolvedValue({ durationSeconds: 300 } as any)

      const result = await service.findCourierForDelivery({
        pickupLocation,
        dropoffLocation,
        rejectedCourierIds: [],
      })

      // Courier A wins because candidate order is preserved on equal road times
      expect(result).toEqual({
        courierId: 'courier-A',
        distance: 400,
        travelSeconds: 300,
      })
    })

    it('ranks a rider whose route cannot be worked out (OSRM error) LAST', async () => {
      // Candidate A: 300m straight line, but OSRM throws error
      // Candidate B: 900m straight line, road time 500s
      const candidates = [
        {
          courierId: 'courier-A',
          distance: 300,
          courierLocation: { latitude: 39.36, longitude: 22.94 },
        },
        {
          courierId: 'courier-B',
          distance: 900,
          courierLocation: { latitude: 39.37, longitude: 22.95 },
        },
      ]

      courierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce(candidates)

      osrmRoutingService.getRoute.mockImplementation(async (args) => {
        if (args.fromLocation.latitude === 39.36) {
          throw new Error('OSRM routing engine unreachable')
        }
        return { durationSeconds: 500 } as any
      })

      const result = await service.findCourierForDelivery({
        pickupLocation,
        dropoffLocation,
        rejectedCourierIds: [],
      })

      // Candidate B wins because Candidate A failed routing and ranks last
      expect(result).toEqual({
        courierId: 'courier-B',
        distance: 900,
        travelSeconds: 500,
      })
    })

    it('picks the straight-line nearest rider with travelSeconds null when all candidate routes fail', async () => {
      const candidates = [
        {
          courierId: 'courier-A',
          distance: 300,
          courierLocation: { latitude: 39.36, longitude: 22.94 },
        },
        {
          courierId: 'courier-B',
          distance: 600,
          courierLocation: { latitude: 39.37, longitude: 22.95 },
        },
      ]

      courierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce(candidates)
      osrmRoutingService.getRoute.mockRejectedValue(new Error('OSRM 503 Service Unavailable'))

      const result = await service.findCourierForDelivery({
        pickupLocation,
        dropoffLocation,
        rejectedCourierIds: [],
      })

      // All unroutable: candidate A is nearest straight-line, returned with travelSeconds null
      expect(result).toEqual({
        courierId: 'courier-A',
        distance: 300,
        travelSeconds: null,
      })
    })

    it('returns null when candidates list is empty', async () => {
      courierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce([])

      const result = await service.findCourierForDelivery({
        pickupLocation,
        dropoffLocation,
        rejectedCourierIds: [],
      })

      expect(result).toBeNull()
      expect(osrmRoutingService.getRoute).not.toHaveBeenCalled()
    })
  })
})
