import { Injectable, Logger } from '@nestjs/common'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { OsrmRoutingService } from '../osrm/osrm-routing.service'
import { TimeWorkedService } from '../time-worked/time-worked.service'
import { ICourierMatcherService } from './interfaces/ICourierMatcherService'
import { ICourierMatcherInput } from './interfaces/ICourierMatcherInput'
import { ICourierMatcherResult } from './interfaces/ICourierMatcherResult'
import { EnumCourierMatcherType } from 'src/shared-types/courier-matching'
import {
  FairnessCandidate,
  coopMeanCentsPerHour,
  estimatedRoadSeconds,
  scoreCandidates,
} from 'src/domains/matching/fairness-score'

// How many riders passing the filters are read, to know how many the shortlist left out (ridersInRange).
const RIDERS_IN_RANGE_READ_LIMIT = 200

// Spec 0044 (rows 12 and 13): the fairness matcher. The same filters as Nearest (a position, Online or
// Last Call, not busy, no open SOS, not skip listed, within the distance, room in the box), then the
// nearest `fairnessCandidateLimit` by straight line, scored by road time, what the co-op paid them per
// hour today, and how long they have waited, with the co-op's weights. Lowest score wins.
@Injectable()
export class FairnessCourierMatcherService implements ICourierMatcherService {
  private readonly logger = new Logger(FairnessCourierMatcherService.name)

  constructor(
    private readonly courierDomainService: CourierDomainService,
    private readonly configDomainService: ConfigDomainService,
    private readonly osrmRoutingService: OsrmRoutingService,
    private readonly timeWorkedService: TimeWorkedService
  ) {}

  async findCourierForDelivery(input: ICourierMatcherInput): Promise<ICourierMatcherResult | null> {
    const { pickupLocation, rejectedCourierIds, boxUnits } = input
    const config = this.configDomainService.instanceConfig
    // Read at offer time, so a saved change applies to the next offer (AC-5).
    const [maxDistanceInKM, limit, minOnlineMinutes, roadTime, earnings, waiting] = await Promise.all([
      config.getMaxAssignmentDistanceInKM(),
      config.getFairnessCandidateLimit(),
      config.getFairnessMinOnlineMinutes(),
      config.getFairnessWeightRoadTime(),
      config.getFairnessWeightEarnings(),
      config.getFairnessWeightWaiting(),
    ])
    const weights = { roadTime, earnings, waiting }

    const inRange = await this.courierDomainService.getNearestAvailableCandidates(
      { location: pickupLocation, maxDistanceInKM, excludeCourierIds: rejectedCourierIds, boxUnits },
      RIDERS_IN_RANGE_READ_LIMIT
    )
    if (inRange.length === 0) return null
    const shortlist = inRange.slice(0, limit)

    const roads = await this.roadSecondsFor(
      pickupLocation,
      shortlist.map((c) => c.courierLocation),
      shortlist.map((c) => c.distance)
    )

    const now = new Date()
    const today = await this.timeWorkedService.todayForFairness(now)
    const minSeconds = minOnlineMinutes * 60
    // AC-3, cross check 3: the mean of the rates of every rider with enough time online today.
    const mean = coopMeanCentsPerHour(
      [...today.values()]
        .filter((f) => f.workSeconds >= minSeconds && f.centsPerHour !== null)
        .map((f) => f.centsPerHour as number)
    )

    const candidates: FairnessCandidate[] = shortlist.map((candidate, index) => {
      const figures = today.get(candidate.courierId)
      const own = figures && figures.workSeconds >= minSeconds ? figures.centsPerHour : null
      const earningsAssumed = own === null
      // A rider the records do not know (no status change since the look back) waits from now: 0.
      const waitFrom = figures
        ? Math.max(figures.lastJobEndAt?.getTime() ?? 0, figures.onlineSpellStartAt.getTime())
        : now.getTime()
      return {
        courierId: candidate.courierId,
        straightMetres: Math.round(candidate.distance),
        roadSeconds: roads.seconds[index] ?? estimatedRoadSeconds(candidate.distance),
        roadEstimated: roads.estimated,
        centsPerHour: earningsAssumed ? mean ?? 0 : (own as number),
        earningsAssumed,
        earningsEqual: mean === null,
        waitingSeconds: Math.max(0, Math.round((now.getTime() - waitFrom) / 1000)),
      }
    })

    const scored = scoreCandidates(candidates, weights)
    const best = scored[0]
    if (!best) return null

    const describe = (c: (typeof scored)[number]) => ({
      courierId: c.courierId,
      roadSeconds: c.roadSeconds,
      roadEstimated: c.roadEstimated,
      centsPerHour: Math.round(c.centsPerHour),
      earningsAssumed: c.earningsAssumed,
      earningsEqual: c.earningsEqual,
      waitingSeconds: c.waitingSeconds,
      straightMetres: c.straightMetres,
      scaled: c.scaled,
      score: c.score,
    })
    const { courierId: _chosen, ...values } = describe(best)

    return {
      courierId: best.courierId,
      distance: best.straightMetres,
      // Offer timing (spec 0031) reads a real road time only; an estimate leaves it to ask again.
      travelSeconds: best.roadEstimated ? null : best.roadSeconds,
      reason: {
        strategy: EnumCourierMatcherType.FAIRNESS,
        weights,
        values,
        score: best.score,
        candidateCount: scored.length,
        ridersInRange: inRange.length,
        candidates: scored.map(describe),
      },
    }
  }

  // AC-2, cross check 7: one OSRM table call for the shortlist; if it fails, or leaves any rider without
  // a time, every rider is estimated at 20 km/h (never a mix of real and estimated values).
  private async roadSecondsFor(
    pickup: { latitude: number; longitude: number },
    origins: { latitude: number; longitude: number }[],
    straightMetres: number[]
  ): Promise<{ seconds: number[]; estimated: boolean }> {
    try {
      const table = await this.osrmRoutingService.getTableSecondsTo(pickup, origins)
      if (table.every((value): value is number => value !== null)) {
        return { seconds: table.map((value) => Math.round(value)), estimated: false }
      }
      this.logger.warn('OSRM gave no road time for a candidate; every candidate is estimated')
    } catch (error) {
      this.logger.warn(`No road times for the fairness candidates, estimating: ${error}`)
    }
    return { seconds: straightMetres.map((metres) => estimatedRoadSeconds(metres)), estimated: true }
  }
}
