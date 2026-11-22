import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { EnumDeliveryStatus } from '@prisma/types'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { DeliveryNotFoundException } from 'src/errors'
import { DELIVERY_ONGOING_STATUSES, GeoPosition } from 'src/shared-types'
import { isRecordNotFoundError } from 'src/prisma.util'
import { DeliveryRouteLegKind } from './dtos/delivery-route.courier.dto'
import { StackStop, StackStopKind, isStopDone, stackStopsOf } from 'src/domains/delivery/stack'

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
  // Spec 0048 (AC-10): for a stack, the number (1 to 4) of the stop this leg ends at; absent otherwise.
  toStopNumber?: number
}

// Spec 0048 (AC-10): one numbered stop of a stack's route, the waypoints the map pins 1 to 4.
export interface DeliveryRouteStop {
  number: number
  deliveryId: string
  stop: StackStopKind
  latitude: number
  longitude: number
  // Already behind the rider (picked up, or handed over); the route's legs skip it.
  done: boolean
}

// The legs of a route and, for a stack, its numbered stops (an empty list for a single delivery).
export interface DeliveryRoute {
  legs: DeliveryRouteLeg[]
  stops: DeliveryRouteStop[]
}

// What a delivery of a stack needs for its stops: its status and its two places.
interface StackRouteMember {
  id: string
  status: EnumDeliveryStatus
  pickupLocation: { latitude: number; longitude: number } | null
  dropoffLocation: { latitude: number; longitude: number } | null
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
    return (await this.getRouteWithStops(deliveryId, courier)).legs
  }

  // The legs, plus a stack's numbered stops (spec 0048, AC-10). The controller answers with this; getRoute
  // above keeps its older answer for the callers and tests written before stacks.
  async getRouteWithStops(deliveryId: string, courier: CourierEntity): Promise<DeliveryRoute> {
    const delivery = await this.readVisible(deliveryId, courier)

    const pickup = delivery.pickupLocation
    const dropoff = delivery.dropoffLocation
    if (!pickup || !dropoff) {
      throw new DeliveryNotFoundException('Delivery not found')
    }
    const rider = courier.currentLocation ?? null

    // Spec 0048 (AC-10): a delivery of a stack draws the route through every stop still ahead, in the
    // stack's order, whichever of its two deliveries the app asks with.
    const stackStops = stackStopsOf(delivery.stopSequence)
    if (stackStops && delivery.offerGroupId) {
      const route = await this.stackRoute(delivery, stackStops, courier, rider)
      if (route) return route
    }

    // Which legs to ask for, in riding order.
    const wanted: { kind: DeliveryRouteLegKind; from: GeoPosition; to: GeoPosition; toStopNumber?: number }[] = []
    if (BEFORE_PICKUP_STATUSES.includes(delivery.status)) {
      if (rider) {
        wanted.push({ kind: DeliveryRouteLegKind.RIDER_TO_PICKUP, from: rider, to: pointOf(pickup) })
      }
      wanted.push({ kind: DeliveryRouteLegKind.PICKUP_TO_DROPOFF, from: pointOf(pickup), to: pointOf(dropoff) })
    } else if (rider) {
      wanted.push({ kind: DeliveryRouteLegKind.RIDER_TO_DROPOFF, from: rider, to: pointOf(dropoff) })
    }

    return { legs: await this.askLegs(deliveryId, wanted), stops: [] }
  }

  // The same read as GET :deliveryId, so "which deliveries can a rider see" has one definition: an offer
  // made to this rider, or a job they hold. Prisma's "no such row" (an unknown id, or another rider's
  // delivery) is a 404 here, not the 500 it would otherwise become.
  private async readVisible(deliveryId: string, courier: CourierEntity) {
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
    return delivery
  }

  // Spec 0048 (AC-10): a stack's route, "row 69's route endpoint gains waypoints". The four stops numbered in
  // the stack's order, each marked done once behind the rider, and the legs from the rider through every stop
  // still ahead. The other delivery is read through the same visibility rule, so a rider only ever sees both
  // orders of their own pair (security model); if it is no longer theirs, null, and the caller draws this
  // delivery alone (its sequence is then being cleared, cross check 6).
  private async stackRoute(
    delivery: StackRouteMember & { offerGroupId: string | null },
    stops: StackStop[],
    courier: CourierEntity,
    rider: GeoPosition | null
  ): Promise<DeliveryRoute | null> {
    const partnerId = stops.find((stop) => stop.deliveryId !== delivery.id)?.deliveryId
    if (!partnerId || !stops.some((stop) => stop.deliveryId === delivery.id)) return null
    let partner: (StackRouteMember & { offerGroupId: string | null }) | null = null
    try {
      partner = await this.readVisible(partnerId, courier)
    } catch (error) {
      if (error instanceof DeliveryNotFoundException) return null
      throw error
    }
    if (partner.offerGroupId !== delivery.offerGroupId) return null

    const members = new Map<string, StackRouteMember>([
      [delivery.id, delivery],
      [partner.id, partner],
    ])
    const numbered: DeliveryRouteStop[] = []
    for (const [index, stop] of stops.entries()) {
      const member = members.get(stop.deliveryId)
      const place = stop.stop === 'PICKUP' ? member?.pickupLocation : member?.dropoffLocation
      if (!member || !place) return null
      numbered.push({
        number: index + 1,
        deliveryId: stop.deliveryId,
        stop: stop.stop,
        latitude: place.latitude,
        longitude: place.longitude,
        done: isStopDone(stop.stop, member.status),
      })
    }

    // From the rider (when the app has sent a position) through each stop still ahead, in order.
    const ahead = numbered.filter((stop) => !stop.done)
    const wanted: { kind: DeliveryRouteLegKind; from: GeoPosition; to: GeoPosition; toStopNumber?: number }[] = []
    let from: GeoPosition | null = rider
    let fromRider = rider !== null
    for (const stop of ahead) {
      const to = pointOf(stop)
      if (from) {
        const kind = fromRider
          ? stop.stop === 'PICKUP'
            ? DeliveryRouteLegKind.RIDER_TO_PICKUP
            : DeliveryRouteLegKind.RIDER_TO_DROPOFF
          : DeliveryRouteLegKind.BETWEEN_STOPS
        wanted.push({ kind, from, to, toStopNumber: stop.number })
      }
      from = to
      fromRider = false
    }
    return { legs: await this.askLegs(delivery.id, wanted), stops: numbered }
  }

  // Asks the co-op's OSRM for each leg, all at once, in riding order.
  private async askLegs(
    deliveryId: string,
    wanted: { kind: DeliveryRouteLegKind; from: GeoPosition; to: GeoPosition; toStopNumber?: number }[]
  ): Promise<DeliveryRouteLeg[]> {
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
            ...(leg.toStopNumber !== undefined ? { toStopNumber: leg.toStopNumber } : {}),
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
