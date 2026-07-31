import { OsrmDeliveryDurationCalculationService } from './osrm-delivery-duration-calculation.service'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { ServiceUnavailableException } from '@nestjs/common'

describe('OsrmDeliveryDurationCalculationService', () => {
  let service: OsrmDeliveryDurationCalculationService
  let mockOsrmRoutingService: jest.Mocked<OsrmRoutingService>

  beforeEach(() => {
    mockOsrmRoutingService = {
      getRoute: jest.fn(),
    } as unknown as jest.Mocked<OsrmRoutingService>

    service = new OsrmDeliveryDurationCalculationService(mockOsrmRoutingService)
  })

  // Test Plan Case 17: Converts duration from seconds to minutes
  test('converts route durationSeconds to minutes (420s -> 7 minutes)', async () => {
    mockOsrmRoutingService.getRoute.mockResolvedValueOnce({ distanceMetres: 2500, durationSeconds: 420 })

    const result = await service.calculateDeliveryDuration({
      pickupLocation: { latitude: 39.3621, longitude: 22.9427 },
      dropoffLocation: { latitude: 39.3680, longitude: 22.9530 },
    })

    // 420 seconds / 60 = 7 minutes
    expect(result).toBe(7)
  })

  // Test Plan Case 18: Rounds duration in minutes to 2 decimal places
  test('rounds duration in minutes to 2 decimal places (455s -> 7.58 minutes)', async () => {
    mockOsrmRoutingService.getRoute.mockResolvedValueOnce({ distanceMetres: 2500, durationSeconds: 455 })

    const result = await service.calculateDeliveryDuration({
      pickupLocation: { latitude: 39.3621, longitude: 22.9427 },
      dropoffLocation: { latitude: 39.3680, longitude: 22.9530 },
    })

    // 455 / 60 = 7.583333... -> rounded to 7.58 minutes
    expect(result).toBe(7.58)
  })

  // Test Plan Case 19: Error propagation
  test('propagates OsrmRoutingService errors unchanged', async () => {
    mockOsrmRoutingService.getRoute.mockRejectedValueOnce(
      new ServiceUnavailableException('OSRM routing engine is unavailable')
    )

    await expect(
      service.calculateDeliveryDuration({
        pickupLocation: { latitude: 39.3621, longitude: 22.9427 },
        dropoffLocation: { latitude: 39.3680, longitude: 22.9530 },
      })
    ).rejects.toThrow(ServiceUnavailableException)
  })
})
