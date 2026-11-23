import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { OSRM_CACHE_TTL_SECONDS, OSRM_REQUEST_TIMEOUT_MS, OSRM_URL } from 'src/constants'
import { EnvVarMissingException } from 'src/errors'
import { IOsrmRouteInput } from './interfaces/IOsrmRouteInput'
import { IOsrmRoutePoint, IOsrmRouteResult } from './interfaces/IOsrmRouteResult'
import { errorSummaryForLog } from 'src/utils/errorForLog'

// What a restaurant reads when a quote cannot be priced because OSRM did not answer.
export const OSRM_UNAVAILABLE_MESSAGE =
  'Road distances are not available right now, so this cannot be priced. Try again in a minute.'

// OSRM's GeoJSON line lists [longitude, latitude] pairs; the rest of this codebase speaks
// { latitude, longitude }. A missing or malformed shape gives no points rather than a failure,
// because the distance and duration (what quotes need) are still good.
function toRoutePoints(geometry: unknown): IOsrmRoutePoint[] {
  const coordinates = (geometry as { coordinates?: unknown } | undefined)?.coordinates
  if (!Array.isArray(coordinates)) {
    return []
  }
  return coordinates
    .filter(
      (pair): pair is [number, number] =>
        Array.isArray(pair) && pair.length >= 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1])
    )
    .map(([longitude, latitude]) => ({ latitude, longitude }))
}

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
    // overview=simplified with geojson also returns the road's shape (spec 0018); quotes ignore it,
    // and one request shape keeps one cache for quotes and drawn routes.
    const url = `${this.baseUrl}/route/v1/driving/${from};${to}?overview=simplified&geometries=geojson&alternatives=false&steps=false`

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
        points: toRoutePoints(route.geometry),
      }
    } catch (error: unknown) {
      // `unknown` is TypeScript's safe type for a caught value — anything can be thrown, not
      // just an Error. It forces the check below instead of letting a bad property access through.
      const reason = errorSummaryForLog(error)
      // The address and the cause are for the co-op's log only. Restaurants read the refusal
      // below, and it must not tell them where the co-op's servers are (decision 69.4).
      // There is deliberately no fallback to straight line distance: it would silently change
      // quotes and courier pay. Start OSRM (./devup.sh docker) or switch Geo calculation back to
      // HAVERSINE in admin.
      this.logger.error(`OSRM routing request to ${this.baseUrl} failed: ${reason}`)

      throw new ServiceUnavailableException(OSRM_UNAVAILABLE_MESSAGE)
    }
  }

  // Spec 0044 (AC-2): road seconds from each of `origins` (riders' positions) to one `destination` (the
  // pickup), in one OSRM table request, so the fairness matcher asks once per offer however many riders
  // it compares. Not cached: rider positions move between offers. An entry OSRM could not route is null;
  // a failed request throws ServiceUnavailableException, and the caller then estimates every rider
  // (cross check 7: never a mix of real and estimated). No coordinate reaches a log line (value 5).
  async getTableSecondsTo(
    destination: { latitude: number; longitude: number },
    origins: { latitude: number; longitude: number }[]
  ): Promise<(number | null)[]> {
    if (!this.baseUrl) {
      throw new EnvVarMissingException(OSRM_URL)
    }
    if (origins.length === 0) return []
    // OSRM expects longitude,latitude. The destination is index 0, the origins 1..n.
    const points = [destination, ...origins].map((p) => `${p.longitude},${p.latitude}`).join(';')
    const sources = origins.map((_, index) => index + 1).join(';')
    const url = `${this.baseUrl}/table/v1/driving/${points}?sources=${sources}&destinations=0&annotations=duration`
    try {
      const response = await this.httpService.axiosRef.get(url, { timeout: this.timeoutMs })
      const data = response.data
      if (data?.code !== 'Ok' || !Array.isArray(data?.durations) || data.durations.length !== origins.length) {
        throw new Error(`code: ${data?.code || 'InvalidResponse'}`)
      }
      return data.durations.map((row: unknown) => {
        const value = Array.isArray(row) ? row[0] : null
        return typeof value === 'number' && Number.isFinite(value) ? value : null
      })
    } catch (error: unknown) {
      const reason = errorSummaryForLog(error)
      this.logger.error(`OSRM table request failed: ${reason}`)
      throw new ServiceUnavailableException(OSRM_UNAVAILABLE_MESSAGE)
    }
  }

  // Spec 0048 (AC-2): road seconds between every pair of `points`, in one OSRM table request:
  // `result[from][to]`. A stack's sequence needs the rider, both pickups and both drop offs, at most five
  // points, so no solver is needed (VROOM stays last). Not cached: the rider's position moves. An entry
  // OSRM could not route is null; a failed request throws ServiceUnavailableException, and the caller then
  // offers no stack. No coordinate reaches a log line (value 5).
  // Spec 0048 (row 81, AC-6): the same table with road metres as well, for an add on's "+2.1 km". One call
  // asks OSRM for both annotations. Throws ServiceUnavailableException like getDurationMatrix.
  async getDurationAndDistanceMatrix(
    points: { latitude: number; longitude: number }[]
  ): Promise<{ seconds: (number | null)[][]; metres: (number | null)[][] }> {
    if (!this.baseUrl) {
      throw new EnvVarMissingException(OSRM_URL)
    }
    if (points.length === 0) return { seconds: [], metres: [] }
    const coordinates = points.map((p) => `${p.longitude},${p.latitude}`).join(';')
    const url = `${this.baseUrl}/table/v1/driving/${coordinates}?annotations=duration,distance`
    // Each row of OSRM's answer as numbers, or null where it found no route.
    const read = (rows: unknown[]): (number | null)[][] =>
      rows.map((row) =>
        points.map((_, to) => {
          const value = Array.isArray(row) ? row[to] : null
          return typeof value === 'number' && Number.isFinite(value) ? value : null
        })
      )
    try {
      const response = await this.httpService.axiosRef.get(url, { timeout: this.timeoutMs })
      const data = response.data
      if (
        data?.code !== 'Ok' ||
        !Array.isArray(data?.durations) ||
        !Array.isArray(data?.distances) ||
        data.durations.length !== points.length ||
        data.distances.length !== points.length
      ) {
        throw new Error(`code: ${data?.code || 'InvalidResponse'}`)
      }
      return { seconds: read(data.durations), metres: read(data.distances) }
    } catch (error: unknown) {
      const reason = errorSummaryForLog(error)
      this.logger.error(`OSRM table request failed: ${reason}`)
      throw new ServiceUnavailableException(OSRM_UNAVAILABLE_MESSAGE)
    }
  }

  async getDurationMatrix(points: { latitude: number; longitude: number }[]): Promise<(number | null)[][]> {
    if (!this.baseUrl) {
      throw new EnvVarMissingException(OSRM_URL)
    }
    if (points.length === 0) return []
    // OSRM expects longitude,latitude. With no sources or destinations given, it answers every pair.
    const coordinates = points.map((p) => `${p.longitude},${p.latitude}`).join(';')
    const url = `${this.baseUrl}/table/v1/driving/${coordinates}?annotations=duration`
    try {
      const response = await this.httpService.axiosRef.get(url, { timeout: this.timeoutMs })
      const data = response.data
      if (data?.code !== 'Ok' || !Array.isArray(data?.durations) || data.durations.length !== points.length) {
        throw new Error(`code: ${data?.code || 'InvalidResponse'}`)
      }
      return data.durations.map((row: unknown) =>
        points.map((_, to) => {
          const value = Array.isArray(row) ? row[to] : null
          return typeof value === 'number' && Number.isFinite(value) ? value : null
        })
      )
    } catch (error: unknown) {
      const reason = errorSummaryForLog(error)
      this.logger.error(`OSRM table request failed: ${reason}`)
      throw new ServiceUnavailableException(OSRM_UNAVAILABLE_MESSAGE)
    }
  }
}
