import { EnumCourierMatcherType } from 'src/shared-types/courier-matching'
import { Injectable, Logger } from '@nestjs/common'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { ICourierMatcherInput } from './interfaces/ICourierMatcherInput'
import { ICourierMatcherResult } from './interfaces/ICourierMatcherResult'
import { ICourierMatcherService } from './interfaces/ICourierMatcherService'
import { GeoPosition } from 'src/shared-types/index'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'

@Injectable()
export class NearestCourierMatcherService implements ICourierMatcherService {
  private readonly logger = new Logger(NearestCourierMatcherService.name)
  constructor(
    private readonly courierDomainService: CourierDomainService,
    private readonly configDomainService: ConfigDomainService,
    private readonly osrmRoutingService: OsrmRoutingService
  ) {}

  async findCourierForDelivery(input: ICourierMatcherInput) {
    const { pickupLocation, rejectedCourierIds, boxUnits, deliveryId } = input

    const maxAssignmentDistance = await this.configDomainService.instanceConfig.getMaxAssignmentDistanceInKM()

    // Spec 0031: with offers timed, compare the nearest few by road time to the pickup.
    if (await this.configDomainService.instanceConfig.getOfferTimingEnabled()) {
      return this.findByRoadTime(pickupLocation, maxAssignmentDistance, rejectedCourierIds, boxUnits, deliveryId)
    }

    const result = await this.courierDomainService.getNearestAvailableCourier({
      location: {
        latitude: pickupLocation.latitude,
        longitude: pickupLocation.longitude,
      },
      maxDistanceInKM: maxAssignmentDistance,
      excludeCourierIds: rejectedCourierIds,
      boxUnits,
      siblingOfDeliveryId: deliveryId,
    })

    if (!result?.courier) {
      return null
    }

    return {
      courierId: result.courier.id,
      distance: result.distance,
      // Spec 0044 (AC-6): the nearest in a straight line (no road time asked).
      reason: {
        strategy: EnumCourierMatcherType.NEAREST_COURIER,
        values: { straightMetres: Math.round(result.distance) },
      },
    }
  }

  private async findByRoadTime(
    pickupLocation: GeoPosition,
    maxDistanceInKM: number | null,
    rejectedCourierIds: string[],
    boxUnits?: number,
    deliveryId?: string
  ): Promise<ICourierMatcherResult | null> {
    const limit = await this.configDomainService.instanceConfig.getOfferTimingCandidates()
    const candidates = await this.courierDomainService.getNearestAvailableCandidates(
      { location: pickupLocation, maxDistanceInKM, excludeCourierIds: rejectedCourierIds, boxUnits, siblingOfDeliveryId: deliveryId },
      limit
    )
    if (candidates.length === 0) return null

    const ranked = await Promise.all(
      candidates.map(async (candidate) => ({ candidate, travelSeconds: await this.roadSeconds(candidate.courierLocation, pickupLocation) }))
    )
    // A rider whose route cannot be worked out comes last. Ties, and two riders with no route, go to the
    // nearer rider: the list is already closest first, and sort keeps that order for equals.
    ranked.sort((a, b) => {
      if (a.travelSeconds === null && b.travelSeconds === null) return 0
      if (a.travelSeconds === null) return 1
      if (b.travelSeconds === null) return -1
      return a.travelSeconds - b.travelSeconds
    })
    const best = ranked[0]
    if (!best) return null
    return {
      courierId: best.candidate.courierId,
      distance: best.candidate.distance,
      travelSeconds: best.travelSeconds,
      // Spec 0044 (AC-6): the shortest road time among the nearest few (spec 0031).
      reason: {
        strategy: EnumCourierMatcherType.NEAREST_COURIER,
        values: { straightMetres: Math.round(best.candidate.distance), roadSeconds: best.travelSeconds },
        candidateCount: ranked.length,
      },
    }
  }

  private async roadSeconds(from: GeoPosition, to: GeoPosition): Promise<number | null> {
    try {
      const route = await this.osrmRoutingService.getRoute({ fromLocation: from, toLocation: to })
      return route.durationSeconds
    } catch (error) {
      this.logger.warn(`No route for a matching candidate: ${error}`)
      return null
    }
  }
}
