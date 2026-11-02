import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { EnumDeliveryStatus } from '@prisma/types'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { DeliveryNotFoundException } from 'src/errors'
import { DELIVERY_ONGOING_STATUSES, GeoPosition } from 'src/shared-types'
import { isRecordNotFoundError } from 'src/prisma.util'
import { DeliveryRouteLegKind } from './dtos/delivery-route.courier.dto'

// Before pickup the rider rides to the restaurant first; from PICKED_UP on, straight to the customer.
const BEFORE_PICKUP_STATUSES: EnumDeliveryStatus[] = [
  EnumDeliveryStatus.ASSIGNING_COURIER,
  EnumDeliveryStatus.ACCEPTED,
  EnumDeliveryStatus.DISPATCHED,
  EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
]

export const ROUTE_UNAVAILABLE_MESSAGE = "The route can't be drawn right now."

export interface DeliveryRouteLeg {
  kind: DeliveryRouteLegKind
  distanceMetres: number
  durationSeconds: number
  points: GeoPosition[]
}

// Spec 0018 (AC-1, AC-2): the road a rider's offer or job follows, from the co-op's own OSRM.
@Injectable()
export class DeliveryRouteCourierService {
  private readonly logger = new Logger(DeliveryRouteCourierService.name)

  constructor(
    private readonly deliveryDomainService: DeliveryDomainService,
    private readonly osrmRoutingService: OsrmRoutingService
  ) {}

  // `courier` is the one the auth middleware loaded for this request: it already carries the
  // location the app last sent for dispatch (`currentLocation`), so no new location is read.
  async getRoute(deliveryId: string, courier: CourierEntity): Promise<DeliveryRouteLeg[]> {
    // The same read as GET :deliveryId, so "which deliveries can a rider see" has one definition.
    // Prisma's "no such row" (an unknown id, or another rider's delivery) is a 404 here, not the
    // 500 it would otherwise become.
    const delivery = await this.deliveryDomainService
      .getByIdOrThrowWithLocation(deliveryId, {
        OR: [{ courierId: courier.id }, { matchedCourierId: courier.id }],
      })
      .catch((error: unknown) => {
        if (error instanceof Error && isRecordNotFoundError(error)) {
          throw new DeliveryNotFoundException('Delivery not found')
        }
        throw error
      })

    const isOfferToThisRider =
      delivery.status === EnumDeliveryStatus.ASSIGNING_COURIER && delivery.matchedCourierId === courier.id
    const isHeldByThisRider = delivery.courierId === courier.id && DELIVERY_ONGOING_STATUSES.includes(delivery.status)
    if (!isOfferToThisRider && !isHeldByThisRider) {
      // The same sentence for a delivery that is not theirs, finished, or unknown.
      throw new DeliveryNotFoundException('Delivery not found')
    }

    const pickup = delivery.pickupLocation
    const dropoff = delivery.dropoffLocation
    if (!pickup || !dropoff) {
      throw new DeliveryNotFoundException('Delivery not found')
    }
    const rider = courier.currentLocation ?? null

    // Which legs to ask for, in riding order.
    const wanted: { kind: DeliveryRouteLegKind; from: GeoPosition; to: GeoPosition }[] = []
    if (BEFORE_PICKUP_STATUSES.includes(delivery.status)) {
      if (rider) {
        wanted.push({ kind: DeliveryRouteLegKind.RIDER_TO_PICKUP, from: rider, to: pointOf(pickup) })
      }
      wanted.push({ kind: DeliveryRouteLegKind.PICKUP_TO_DROPOFF, from: pointOf(pickup), to: pointOf(dropoff) })
    } else if (rider) {
      wanted.push({ kind: DeliveryRouteLegKind.RIDER_TO_DROPOFF, from: rider, to: pointOf(dropoff) })
    }

    try {
      // Promise.all asks OSRM for every leg at once and waits for all of them.
      return await Promise.all(
        wanted.map(async (leg) => {
          const route = await this.osrmRoutingService.getRoute({ fromLocation: leg.from, toLocation: leg.to })
          return {
            kind: leg.kind,
            distanceMetres: Math.round(route.distanceMetres),
            durationSeconds: Math.round(route.durationSeconds),
            points: route.points,
          }
        })
      )
    } catch (error: unknown) {
      // Any OSRM failure (not configured, down, slow, a bad answer). The app then shows the pins
      // with no line; it never asks another routing server (AC-2). Ids only in the log: a route is
      // a rider's whereabouts (value 5).
      const reason = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Route for delivery ${deliveryId} unavailable: ${reason}`)
      throw new ServiceUnavailableException(ROUTE_UNAVAILABLE_MESSAGE)
    }
  }
}

function pointOf(location: { latitude: number; longitude: number }): GeoPosition {
  return { latitude: location.latitude, longitude: location.longitude }
}
