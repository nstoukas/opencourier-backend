import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { ServiceUnavailableException } from '@nestjs/common'
import { OsrmRoutingService } from './osrm-routing.service'
import { EnvVarMissingException } from 'src/errors'
import { OSRM_CACHE_TTL_SECONDS, OSRM_REQUEST_TIMEOUT_MS, OSRM_URL } from 'src/constants'

describe('OsrmRoutingService', () => {
  let service: OsrmRoutingService
  let mockHttpService: { axiosRef: { get: jest.Mock } }
  let mockConfigService: jest.Mocked<ConfigService>

  beforeEach(() => {
    mockHttpService = {
      axiosRef: {
        get: jest.fn(),
      },
    }

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === OSRM_URL) return 'http://localhost:5000'
        if (key === OSRM_REQUEST_TIMEOUT_MS) return 3000
        if (key === OSRM_CACHE_TTL_SECONDS) return 60
        return undefined
      }),
    } as unknown as jest.Mocked<ConfigService>

    service = new OsrmRoutingService(mockHttpService as unknown as HttpService, mockConfigService)
  })

  // Test Plan Case 6: Successful route extraction
  test('returns distanceMetres and durationSeconds from successful OSRM response', async () => {
    mockHttpService.axiosRef.get.mockResolvedValueOnce({
      data: {
        code: 'Ok',
        routes: [{ distance: 2500, duration: 420 }],
      },
    })

    const result = await service.getRoute({
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.3680, longitude: 22.9530 },
    })

    expect(result).toEqual({ distanceMetres: 2500, durationSeconds: 420 })
  })

  // Test Plan Case 7: Coordinate order check (longitude,latitude)
  test('formats URL with longitude,latitude order (not latitude,longitude)', async () => {
    mockHttpService.axiosRef.get.mockResolvedValueOnce({
      data: {
        code: 'Ok',
        routes: [{ distance: 2500, duration: 420 }],
      },
    })

    await service.getRoute({
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.3680, longitude: 22.9530 },
    })

    // Assert exact URL string containing longitude,latitude ordering
    expect(mockHttpService.axiosRef.get).toHaveBeenCalledWith(
      'http://localhost:5000/route/v1/driving/22.9427,39.3621;22.953,39.368?overview=false&alternatives=false&steps=false',
      expect.objectContaining({ timeout: 3000 })
    )
  })

  // Test Plan Case 8: In-flight request caching for identical coordinate pair
  test('makes only one HTTP request for repeated getRoute calls with identical coordinates', async () => {
    mockHttpService.axiosRef.get.mockResolvedValueOnce({
      data: {
        code: 'Ok',
        routes: [{ distance: 2500, duration: 420 }],
      },
    })

    const input = {
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.3680, longitude: 22.9530 },
    }

    // Call twice concurrently to verify shared in-flight promise
    const [res1, res2] = await Promise.all([service.getRoute(input), service.getRoute(input)])

    expect(res1).toEqual({ distanceMetres: 2500, durationSeconds: 420 })
    expect(res2).toEqual({ distanceMetres: 2500, durationSeconds: 420 })
    expect(mockHttpService.axiosRef.get).toHaveBeenCalledTimes(1)
  })

  // Test Plan Case 9: Failed request is removed from cache so next request retries
  test('does not cache failed requests and allows retry on subsequent call', async () => {
    // First call fails with ECONNREFUSED
    mockHttpService.axiosRef.get.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:5000'))

    const input = {
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.3680, longitude: 22.9530 },
    }

    await expect(service.getRoute(input)).rejects.toThrow(ServiceUnavailableException)

    // Second call succeeds
    mockHttpService.axiosRef.get.mockResolvedValueOnce({
      data: {
        code: 'Ok',
        routes: [{ distance: 2500, duration: 420 }],
      },
    })

    const res = await service.getRoute(input)
    expect(res).toEqual({ distanceMetres: 2500, durationSeconds: 420 })
    expect(mockHttpService.axiosRef.get).toHaveBeenCalledTimes(2)
  })

  // Test Plan Case 10: No silent fallback - throws ServiceUnavailableException with helpful message
  test.each([
    ['connection refused', new Error('connect ECONNREFUSED')],
    ['timeout', new Error('timeout of 3000ms exceeded')],
    ['NoRoute status code', { data: { code: 'NoRoute' } }],
    ['empty routes array', { data: { code: 'Ok', routes: [] } }],
  ])('throws ServiceUnavailableException naming OSRM and URL on %s', async (_description, mockResponseOrError) => {
    if (mockResponseOrError instanceof Error) {
      mockHttpService.axiosRef.get.mockRejectedValueOnce(mockResponseOrError)
    } else {
      mockHttpService.axiosRef.get.mockResolvedValueOnce(mockResponseOrError)
    }

    const input = {
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.3680, longitude: 22.9530 },
    }

    const promise = service.getRoute(input)
    await expect(promise).rejects.toThrow(ServiceUnavailableException)
    await expect(promise).rejects.toThrow(/OSRM routing engine is unavailable at http:\/\/localhost:5000/)
  })

  // Test Plan Case 11: EnvVarMissingException thrown when OSRM_URL is missing
  test('allows service instantiation without OSRM_URL but throws EnvVarMissingException on getRoute call', async () => {
    mockConfigService.get.mockReturnValue(undefined)

    // Creating service without OSRM_URL must NOT throw (allows app to boot)
    let unconfiguredService: OsrmRoutingService | undefined
    expect(() => {
      unconfiguredService = new OsrmRoutingService(mockHttpService as unknown as HttpService, mockConfigService)
    }).not.toThrow()

    // Calling getRoute on unconfigured service throws EnvVarMissingException
    await expect(
      unconfiguredService!.getRoute({
        fromLocation: { latitude: 39.3621, longitude: 22.9427 },
        toLocation: { latitude: 39.3680, longitude: 22.9530 },
      })
    ).rejects.toThrow(EnvVarMissingException)
  })

  // Test Plan Case 12: Request timeout configured from OSRM_REQUEST_TIMEOUT_MS
  test('passes custom timeout from OSRM_REQUEST_TIMEOUT_MS to axios', async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === OSRM_URL) return 'http://localhost:5000'
      if (key === OSRM_REQUEST_TIMEOUT_MS) return 5000
      if (key === OSRM_CACHE_TTL_SECONDS) return 60
      return undefined
    })

    const customTimeoutService = new OsrmRoutingService(mockHttpService as unknown as HttpService, mockConfigService)

    mockHttpService.axiosRef.get.mockResolvedValueOnce({
      data: {
        code: 'Ok',
        routes: [{ distance: 2500, duration: 420 }],
      },
    })

    await customTimeoutService.getRoute({
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.3680, longitude: 22.9530 },
    })

    expect(mockHttpService.axiosRef.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 5000 })
    )
  })
})
