import { Injectable, Logger } from '@nestjs/common'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { OsrmRoutingService } from '../osrm/osrm-routing.service'
import { FairnessDayFigures, TimeWorkedService, instanceDayStart } from '../time-worked/time-worked.service'
import { ICourierMatcherService } from './interfaces/ICourierMatcherService'
import { ICourierMatcherInput } from './interfaces/ICourierMatcherInput'
import { ICourierMatcherResult } from './interfaces/ICourierMatcherResult'
import { EnumCourierMatcherType } from 'src/shared-types/courier-matching'
import { ShiftBookingRepository } from 'src/persistence/repositories/shift-booking.repository'
import {
  FairnessCandidate,
  FairnessWeights,
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
    private readonly timeWorkedService: TimeWorkedService,
    // Spec 0049. Optional (`?`) only so older tests that build the matcher by hand keep compiling; Nest
    // always injects it (decision 12.6's pattern).
    private readonly shiftBookingRepository?: ShiftBookingRepository
  ) {}

  async findCourierForDelivery(input: ICourierMatcherInput): Promise<ICourierMatcherResult | null> {
    const { pickupLocation, rejectedCourierIds, boxUnits } = input
    const config = this.configDomainService.instanceConfig
    // Read at offer time, so a saved change applies to the next offer (AC-5).
    const [maxDistanceInKM, limit, minOnlineMinutes, roadTime, earnings, waiting, shiftsEnabled, shift] =
      await Promise.all([
        config.getMaxAssignmentDistanceInKM(),
        config.getFairnessCandidateLimit(),
        config.getFairnessMinOnlineMinutes(),
        config.getFairnessWeightRoadTime(),
        config.getFairnessWeightEarnings(),
        config.getFairnessWeightWaiting(),
        config.getShiftsEnabled(),
        config.getFairnessWeightShift(),
      ])

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
    // Review fix: a failed read of today's figures must not stop every offer. Without them, pay per hour
    // counts equal for everyone and so does waiting, so road time decides, and the reason says so.
    let today: Map<string, FairnessDayFigures>
    let figuresKnown = true
    try {
      today = await this.timeWorkedService.todayForFairness(now)
    } catch (error) {
      this.logger.error(`Today's figures could not be read for the fairness matcher; road time decides: ${error}`)
      today = new Map()
      figuresKnown = false
    }
    const onShift = shiftsEnabled ? await this.ridersOnShift(shortlist.map((c) => c.courierId), now) : null
    // Spec 0049 (AC-2, cross check 5): the shift weight joins only while shifts are on and the bookings
    // could be read; otherwise it is out of the score, its sum and the recorded weights (review fix: a failed
    // read no longer records everyone as off shift).
    const shiftApplies = onShift !== null
    const weights: FairnessWeights = shiftApplies ? { roadTime, earnings, waiting, shift } : { roadTime, earnings, waiting }
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
      // Review fix (binding value 4): a rider the records do not know has been Online since before the
      // look back, so waits from today's start, like a rider known only from before it; never 0. With no
      // figures at all (the read failed), everyone waits the same.
      const waitFrom = !figuresKnown
        ? now.getTime()
        : figures
          ? Math.max(figures.lastJobEndAt?.getTime() ?? 0, figures.onlineSpellStartAt.getTime())
          : instanceDayStart(now).getTime()
      return {
        courierId: candidate.courierId,
        straightMetres: Math.round(candidate.distance),
        roadSeconds: roads.seconds[index] ?? estimatedRoadSeconds(candidate.distance),
        roadEstimated: roads.estimated,
        centsPerHour: earningsAssumed ? mean ?? 0 : (own as number),
        earningsAssumed,
        earningsEqual: mean === null || !figuresKnown,
        waitingSeconds: Math.max(0, Math.round((now.getTime() - waitFrom) / 1000)),
        ...(onShift ? { onShift: onShift.has(candidate.courierId) } : {}),
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
      // Spec 0049 (AC-3): recorded only while shifts are on.
      ...(c.onShift !== undefined ? { onShift: c.onShift } : {}),
      scaled: c.scaled,
      score: c.score,
    })
    const { courierId: _chosen, ...values } = describe(best)

    return {
      courierId: best.courierId,
      distance: best.straightMetres,
      // Offer timing (spec 0031) reads a real road time only; an estimate leaves it undefined, so timing
      // asks the router itself (review fix: null means "tried and could not" there, and sent the offer at once).
      travelSeconds: best.roadEstimated ? undefined : best.roadSeconds,
      reason: {
        strategy: EnumCourierMatcherType.FAIRNESS,
        // The weights that applied: the shift weight only while shifts are on (spec 0049, AC-3).
        weights: shiftApplies ? { roadTime, earnings, waiting, shift } : { roadTime, earnings, waiting },
        values,
        score: best.score,
        candidateCount: scored.length,
        ridersInRange: inRange.length,
        candidates: scored.map(describe),
      },
    }
  }

  // Spec 0049 (AC-2): who among the shortlist is on a booked shift now. null when the bookings cannot be
  // read: that offer is then made as with Shifts off (logged, never thrown), so its record stays true.
  private async ridersOnShift(courierIds: string[], now: Date): Promise<Set<string> | null> {
    if (!this.shiftBookingRepository) return null
    try {
      return await this.shiftBookingRepository.onShiftNow(courierIds, now)
    } catch (error) {
      this.logger.error(`Booked shifts could not be read for the fairness matcher; this offer leaves shifts out: ${error}`)
      return null
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
