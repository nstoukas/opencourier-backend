import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { OsrmRoutingService, OSRM_UNAVAILABLE_MESSAGE } from './osrm-routing.service'
import { EnvVarMissingException } from 'src/errors'
import { OSRM_CACHE_TTL_SECONDS, OSRM_REQUEST_TIMEOUT_MS, OSRM_URL } from 'src/constants'

describe('OsrmRoutingService', () => {
  let service: OsrmRoutingService
  let mockHttpService: { axiosRef: { get: jest.Mock } }
  let mockConfigService: jest.Mocked<ConfigService>
  let loggerErrorSpy: jest.SpyInstance

  beforeEach(() => {
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation()

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

  afterEach(() => {
    loggerErrorSpy.mockRestore()
  })

  // Test Plan Case 6: Successful route extraction with points mapped from GeoJSON coordinates
  test('returns distanceMetres, durationSeconds and points mapped from GeoJSON [lon, lat] pairs to { latitude, longitude } in order', async () => {
    mockHttpService.axiosRef.get.mockResolvedValueOnce({
      data: {
        code: 'Ok',
        routes: [
          {
            distance: 2500,
            duration: 420,
            geometry: {
              coordinates: [
                [22.9427, 39.3621],
                [22.9485, 39.3655],
                [22.953, 39.368],
              ],
            },
          },
        ],
      },
    })

    const result = await service.getRoute({
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.368, longitude: 22.953 },
    })

    expect(result).toEqual({
      distanceMetres: 2500,
      durationSeconds: 420,
      points: [
        { latitude: 39.3621, longitude: 22.9427 },
        { latitude: 39.3655, longitude: 22.9485 },
        { latitude: 39.368, longitude: 22.953 },
      ],
    })
  })

  test('returns points [] when geometry is missing or malformed while distance and duration still come back', async () => {
    // Missing geometry property
    mockHttpService.axiosRef.get.mockResolvedValueOnce({
      data: {
        code: 'Ok',
        routes: [{ distance: 2500, duration: 420 }],
      },
    })

    const resultWithoutGeometry = await service.getRoute({
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.368, longitude: 22.953 },
    })

    expect(resultWithoutGeometry).toEqual({
      distanceMetres: 2500,
      durationSeconds: 420,
      points: [],
    })

    // Malformed geometry (coordinates not an array) - using different coordinates to avoid cache hit
    mockHttpService.axiosRef.get.mockResolvedValueOnce({
      data: {
        code: 'Ok',
        routes: [{ distance: 1800, duration: 300, geometry: { coordinates: 'invalid-coords' } }],
      },
    })

    const resultMalformedGeometry = await service.getRoute({
      fromLocation: { latitude: 39.37, longitude: 22.96 },
      toLocation: { latitude: 39.38, longitude: 22.97 },
    })

    expect(resultMalformedGeometry).toEqual({
      distanceMetres: 1800,
      durationSeconds: 300,
      points: [],
    })
  })

  test('drops non-finite and incomplete coordinate pairs from points', async () => {
    mockHttpService.axiosRef.get.mockResolvedValueOnce({
      data: {
        code: 'Ok',
        routes: [
          {
            distance: 2500,
            duration: 420,
            geometry: {
              coordinates: [
                [22.9427, 39.3621], // valid
                [NaN, 39.363], // non-finite lon
                [22.945, Infinity], // non-finite lat
                [-Infinity, 39.364], // non-finite lon
                ['bad', 39.365], // string
                [22.95], // single element
                null, // not array
                [22.953, 39.368], // valid
              ],
            },
          },
        ],
      },
    })

    const result = await service.getRoute({
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.368, longitude: 22.953 },
    })

    expect(result.points).toEqual([
      { latitude: 39.3621, longitude: 22.9427 },
      { latitude: 39.368, longitude: 22.953 },
    ])
  })

  // Test Plan Case 7: Coordinate order check (longitude,latitude) with simplified GeoJSON parameters
  test('formats URL with longitude,latitude order and overview=simplified and geometries=geojson', async () => {
    mockHttpService.axiosRef.get.mockResolvedValueOnce({
      data: {
        code: 'Ok',
        routes: [{ distance: 2500, duration: 420 }],
      },
    })

    await service.getRoute({
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.368, longitude: 22.953 },
    })

    // Assert exact URL string containing longitude,latitude ordering and overview=simplified&geometries=geojson
    expect(mockHttpService.axiosRef.get).toHaveBeenCalledWith(
      'http://localhost:5000/route/v1/driving/22.9427,39.3621;22.953,39.368?overview=simplified&geometries=geojson&alternatives=false&steps=false',
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
      toLocation: { latitude: 39.368, longitude: 22.953 },
    }

    // Call twice concurrently to verify shared in-flight promise
    const [res1, res2] = await Promise.all([service.getRoute(input), service.getRoute(input)])

    expect(res1).toEqual({ distanceMetres: 2500, durationSeconds: 420, points: [] })
    expect(res2).toEqual({ distanceMetres: 2500, durationSeconds: 420, points: [] })
    expect(mockHttpService.axiosRef.get).toHaveBeenCalledTimes(1)
  })

  // Test Plan Case 9: Failed request is removed from cache so next request retries
  test('does not cache failed requests and allows retry on subsequent call', async () => {
    // First call fails with ECONNREFUSED
    mockHttpService.axiosRef.get.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:5000'))

    const input = {
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.368, longitude: 22.953 },
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
    expect(res).toEqual({ distanceMetres: 2500, durationSeconds: 420, points: [] })
    expect(mockHttpService.axiosRef.get).toHaveBeenCalledTimes(2)
  })

  // Test Plan Case 10: Every failure throws ServiceUnavailableException with exact message and logs address
  test.each([
    ['connection refused', new Error('connect ECONNREFUSED')],
    ['timeout', new Error('timeout of 3000ms exceeded')],
    ['NoRoute status code', { data: { code: 'NoRoute' } }],
    ['empty routes array', { data: { code: 'Ok', routes: [] } }],
    ['missing distance property', { data: { code: 'Ok', routes: [{ duration: 420 }] } }],
  ])('throws ServiceUnavailableException with plain sentence (no address) and logs address on %s', async (_description, mockResponseOrError) => {
    if (mockResponseOrError instanceof Error) {
      mockHttpService.axiosRef.get.mockRejectedValueOnce(mockResponseOrError)
    } else {
      mockHttpService.axiosRef.get.mockResolvedValueOnce(mockResponseOrError)
    }

    const input = {
      fromLocation: { latitude: 39.3621, longitude: 22.9427 },
      toLocation: { latitude: 39.368, longitude: 22.953 },
    }

    const promise = service.getRoute(input)
    await expect(promise).rejects.toThrow(ServiceUnavailableException)

    // The thrown message is exactly the user-facing sentence and does NOT contain the address or localhost
    await expect(promise).rejects.toThrow(OSRM_UNAVAILABLE_MESSAGE)
    try {
      await service.getRoute(input)
    } catch (err: any) {
      expect(err.message).toBe('Road distances are not available right now, so this cannot be priced. Try again in a minute.')
      expect(err.message).not.toContain('http://localhost:5000')
      expect(err.message).not.toContain('localhost')
    }

    // The address goes to the backend logger only
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:5000')
    )
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
        toLocation: { latitude: 39.368, longitude: 22.953 },
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
      toLocation: { latitude: 39.368, longitude: 22.953 },
    })

    expect(mockHttpService.axiosRef.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 5000 })
    )
  })
})
