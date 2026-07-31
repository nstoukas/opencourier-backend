import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { OSRM_CACHE_TTL_SECONDS, OSRM_REQUEST_TIMEOUT_MS, OSRM_URL } from 'src/constants'
import { EnvVarMissingException } from 'src/errors'
import { IOsrmRouteInput } from './interfaces/IOsrmRouteInput'
import { IOsrmRouteResult } from './interfaces/IOsrmRouteResult'

// NestJS service providing OSRM road routing HTTP client and in-flight request caching
@Injectable()
export class OsrmRoutingService {
  private readonly logger = new Logger(OsrmRoutingService.name)
  private readonly baseUrl: string | null
  private readonly timeoutMs: number
  private readonly cacheTtlSeconds: number

  // Cache the promise, not the result: two callers in the same quote then share one HTTP
  // request instead of racing two. Keyed on the exact coordinates, so a "stale" entry can
  // only be wrong if the road network changed within the TTL.
  private readonly routeCache = new Map<string, { expiresAt: number; route: Promise<IOsrmRouteResult> }>()

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    const rawUrl = this.configService.get<string>(OSRM_URL)
    this.baseUrl = rawUrl ? rawUrl.replace(/\/+$/, '') : null

    const timeoutRaw = this.configService.get<string | number>(OSRM_REQUEST_TIMEOUT_MS)
    this.timeoutMs = timeoutRaw ? Number(timeoutRaw) : 3000

    const ttlRaw = this.configService.get<string | number>(OSRM_CACHE_TTL_SECONDS)
    this.cacheTtlSeconds = ttlRaw ? Number(ttlRaw) : 60
  }

  async getRoute(input: IOsrmRouteInput): Promise<IOsrmRouteResult> {
    if (!this.baseUrl) {
      throw new EnvVarMissingException(OSRM_URL)
    }

    const fromLon = input.fromLocation.longitude.toFixed(6)
    const fromLat = input.fromLocation.latitude.toFixed(6)
    const toLon = input.toLocation.longitude.toFixed(6)
    const toLat = input.toLocation.latitude.toFixed(6)
    const key = `${fromLon},${fromLat};${toLon},${toLat}`

    const cached = this.routeCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.route
    }

    const routePromise = this.fetchRoute(input)

    routePromise.catch(() => {
      this.routeCache.delete(key)
    })

    if (this.routeCache.size >= 500) {
      const oldestKey = this.routeCache.keys().next().value
      if (oldestKey) {
        this.routeCache.delete(oldestKey)
      }
    }

    const expiresAt = Date.now() + this.cacheTtlSeconds * 1000
    this.routeCache.set(key, { expiresAt, route: routePromise })

    return routePromise
  }

  private async fetchRoute(input: IOsrmRouteInput): Promise<IOsrmRouteResult> {
    // OSRM expects longitude,latitude (the opposite order from GeoPosition in this codebase).
    // The 'driving' profile path segment is required by OSRM's URL grammar; osrm-routed serves
    // whichever profile the data was prepared with (our moped profile).
    const from = `${input.fromLocation.longitude},${input.fromLocation.latitude}`
    const to = `${input.toLocation.longitude},${input.toLocation.latitude}`
    const url = `${this.baseUrl}/route/v1/driving/${from};${to}?overview=false&alternatives=false&steps=false`

    try {
      const response = await this.httpService.axiosRef.get(url, { timeout: this.timeoutMs })
      const data = response.data

      if (data?.code !== 'Ok' || !Array.isArray(data?.routes) || data.routes.length === 0) {
        const code = data?.code || 'InvalidResponse'
        throw new Error(`code: ${code}`)
      }

      const route = data.routes[0]
      if (
        typeof route?.distance !== 'number' ||
        typeof route?.duration !== 'number' ||
        !Number.isFinite(route.distance) ||
        !Number.isFinite(route.duration)
      ) {
        throw new Error('invalid route distance or duration')
      }

      return {
        distanceMetres: route.distance,
        durationSeconds: route.duration,
      }
    } catch (error: unknown) {
      // `unknown` is TypeScript's safe type for a caught value — anything can be thrown, not
      // just an Error. It forces the check below instead of letting a bad property access through.
      const reason = error instanceof Error ? error.message : String(error)
      this.logger.error(`OSRM routing request failed: ${reason}`)

      throw new ServiceUnavailableException(
        `OSRM routing engine is unavailable at ${this.baseUrl} (${reason}). ` +
          `Distance and duration cannot be calculated. Falling back to straight-line distance is ` +
          `deliberately not done because it would silently change quotes and courier pay. ` +
          `Start OSRM (yarn docker:osrm) or switch Config.geoCalculationType back to HAVERSINE from the admin panel.`
      )
    }
  }
}
