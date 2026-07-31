import { EnumDistanceUnit } from '@prisma/types'
import { OsrmGeoCalculationService } from './osrm-geo-calculation.service'
import { HaversineGeoCalculationService } from './haversine-geo-calculation.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { ServiceUnavailableException } from '@nestjs/common'

describe('OsrmGeoCalculationService', () => {
  let service: OsrmGeoCalculationService
  let haversineService: HaversineGeoCalculationService
  let mockConfigDomainService: jest.Mocked<ConfigDomainService>
  let mockOsrmRoutingService: jest.Mocked<OsrmRoutingService>

  beforeEach(() => {
    mockConfigDomainService = {
      instanceConfig: {
        getDistanceUnit: jest.fn(),
      },
    } as unknown as jest.Mocked<ConfigDomainService>

    mockOsrmRoutingService = {
      getRoute: jest.fn(),
    } as unknown as jest.Mocked<OsrmRoutingService>

    service = new OsrmGeoCalculationService(mockConfigDomainService, mockOsrmRoutingService)
    haversineService = new HaversineGeoCalculationService(mockConfigDomainService)
  })

  // Test Plan Case 13: Unit-parity with KILOMETERS
  test('converts route distanceMetres to kilometres when distanceUnit is KILOMETERS', async () => {
    ;(mockConfigDomainService.instanceConfig.getDistanceUnit as jest.Mock).mockResolvedValue(EnumDistanceUnit.KILOMETERS)
    mockOsrmRoutingService.getRoute.mockResolvedValueOnce({ distanceMetres: 2500, durationSeconds: 420 })

    const result = await service.calculateDistance({
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.3680, longitude: 22.9530 },
    })

    // 2500 metres = 2.5 kilometres
    expect(result).toBe(2.5)
  })

  // Test Plan Case 14: Unit-parity with MILES
  test('converts route distanceMetres to miles when distanceUnit is MILES', async () => {
    ;(mockConfigDomainService.instanceConfig.getDistanceUnit as jest.Mock).mockResolvedValue(EnumDistanceUnit.MILES)
    mockOsrmRoutingService.getRoute.mockResolvedValueOnce({ distanceMetres: 2500, durationSeconds: 420 })

    const result = await service.calculateDistance({
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.3680, longitude: 22.9530 },
    })

    // 2.5 km * 0.621371 = 1.5534275 miles
    expect(result).toBe(2.5 * 0.621371)
  })

  // Test Plan Case 15: Direct parity comparison with Haversine engine
  test('produces identical output to Haversine engine when given identical distance in metres', async () => {
    const fromLocation = { latitude: 39.3621, longitude: 22.9427 }
    const toLocation = { latitude: 39.3680, longitude: 22.9530 }

    // Test under KILOMETERS
    ;(mockConfigDomainService.instanceConfig.getDistanceUnit as jest.Mock).mockResolvedValue(EnumDistanceUnit.KILOMETERS)
    const haversineKm = await haversineService.calculateDistance({ fromLocation, toLocation })

    // Feed raw metres derived from haversine km to OSRM mock
    const haversineMetres = 1.1020176527581977 * 1000
    mockOsrmRoutingService.getRoute.mockResolvedValueOnce({ distanceMetres: haversineMetres, durationSeconds: 300 })

    const osrmKm = await service.calculateDistance({ fromLocation, toLocation })
    expect(osrmKm).toBe(haversineKm)

    // Test under MILES
    ;(mockConfigDomainService.instanceConfig.getDistanceUnit as jest.Mock).mockResolvedValue(EnumDistanceUnit.MILES)
    const haversineMiles = await haversineService.calculateDistance({ fromLocation, toLocation })

    mockOsrmRoutingService.getRoute.mockResolvedValueOnce({ distanceMetres: haversineMetres, durationSeconds: 300 })
    const osrmMiles = await service.calculateDistance({ fromLocation, toLocation })
    expect(osrmMiles).toBeCloseTo(haversineMiles, 8)
  })

  // Test Plan Case 16: Failure propagation without fallback
  test('propagates OsrmRoutingService errors without catching or falling back to straight line', async () => {
    ;(mockConfigDomainService.instanceConfig.getDistanceUnit as jest.Mock).mockResolvedValue(EnumDistanceUnit.KILOMETERS)
    mockOsrmRoutingService.getRoute.mockRejectedValueOnce(
      new ServiceUnavailableException('OSRM routing engine is unavailable')
    )

    await expect(
      service.calculateDistance({
        fromLocation: { latitude: 39.3621, longitude: 22.9427 },
        toLocation: { latitude: 39.3680, longitude: 22.9530 },
      })
    ).rejects.toThrow(ServiceUnavailableException)
  })
})
