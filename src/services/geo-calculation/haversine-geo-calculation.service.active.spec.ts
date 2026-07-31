import { EnumDistanceUnit } from '@prisma/types'
import { HaversineGeoCalculationService } from './haversine-geo-calculation.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'

describe('HaversineGeoCalculationService', () => {
  let service: HaversineGeoCalculationService
  let mockConfigDomainService: jest.Mocked<ConfigDomainService>

  beforeEach(() => {
    // Mock ConfigDomainService and its nested instanceConfig property
    mockConfigDomainService = {
      instanceConfig: {
        getDistanceUnit: jest.fn(),
      },
    } as unknown as jest.Mocked<ConfigDomainService>

    service = new HaversineGeoCalculationService(mockConfigDomainService)
  })

  // Test Plan Case 4: Literal output check for Volos coordinates under KILOMETERS
  test('calculates exact haversine distance in kilometres for Volos coordinates', async () => {
    ;(mockConfigDomainService.instanceConfig.getDistanceUnit as jest.Mock).mockResolvedValue(EnumDistanceUnit.KILOMETERS)

    const result = await service.calculateDistance({
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.3680, longitude: 22.9530 },
    })

    // Assert literal pinned value (1.102 kilometres for these Volos points)
    expect(result).toBe(1.102)
  })

  // Test Plan Case 5: Literal output check for Volos coordinates under MILES
  test('calculates exact haversine distance in miles by applying 0.621371 multiplier', async () => {
    ;(mockConfigDomainService.instanceConfig.getDistanceUnit as jest.Mock).mockResolvedValue(EnumDistanceUnit.MILES)

    const result = await service.calculateDistance({
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.3680, longitude: 22.9530 },
    })

    // Assert exact miles value (unrounded haversine km 1.1020176527581977 * 0.621371)
    const expectedUnroundedMiles = 1.1020176527581977 * 0.621371
    expect(result).toBeCloseTo(expectedUnroundedMiles, 8)
  })
})
