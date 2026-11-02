import { Logger } from '@nestjs/common'
import { GeoPosition } from 'src/shared-types'
import { IOsrmRouteInput } from 'src/services/osrm/interfaces/IOsrmRouteInput'
import { IOsrmRouteResult } from 'src/services/osrm/interfaces/IOsrmRouteResult'

// Spec 0019 (AC-1): what an offer card shows about the ride. Display only: pay
// always comes from the stored quote, never from these figures.
export interface OfferTrip {
  // Road metres from the rider's stored location to the restaurant; null when unknown.
  toPickupMetres: number | null
  // Road metres from the restaurant to the customer; null when unknown.
  toDropoffMetres: number | null
  // The whole ride in minutes, rounded up; only when both legs are known.
  minutes: number | null
}

export interface OfferTripInput {
  deliveryId: string
  pickup: GeoPosition | null
  dropoff: GeoPosition | null
  rider: GeoPosition | null
}

// Only the one method the helper needs, so a test can hand in a small fake.
type RouteSource = { getRoute(input: IOsrmRouteInput): Promise<IOsrmRouteResult> }

// No figure known: what an offer shows when nothing could be worked out.
export const UNKNOWN_OFFER_TRIP: OfferTrip = { toPickupMetres: null, toDropoffMetres: null, minutes: null }

const logger = new Logger('OfferTrip')

// Asks the co-op's OSRM for both legs at once. `Promise.allSettled` waits for
// both and reports each one's own success or failure, so one failed leg never
// loses the other. A failure is logged with the delivery id only: a leg's
// coordinates are a rider's or a customer's whereabouts (value 5).
export async function offerTripFor(input: OfferTripInput, osrm: RouteSource): Promise<OfferTrip> {
  const { deliveryId, pickup, dropoff, rider } = input
  const leg = (from: GeoPosition | null, to: GeoPosition | null) =>
    from && to ? osrm.getRoute({ fromLocation: from, toLocation: to }) : Promise.resolve(null)

  const [toPickup, toDropoff] = await Promise.allSettled([leg(rider, pickup), leg(pickup, dropoff)])
  const valueOf = (result: PromiseSettledResult<IOsrmRouteResult | null>, name: string) => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
    logger.warn(`Offer trip for delivery ${deliveryId}: the ${name} leg is unknown (${reason})`)
    return null
  }
  const pickupLeg = valueOf(toPickup, 'rider to restaurant')
  const dropoffLeg = valueOf(toDropoff, 'restaurant to customer')

  return {
    toPickupMetres: pickupLeg ? Math.round(pickupLeg.distanceMetres) : null,
    toDropoffMetres: dropoffLeg ? Math.round(dropoffLeg.distanceMetres) : null,
    minutes:
      pickupLeg && dropoffLeg ? Math.ceil((pickupLeg.durationSeconds + dropoffLeg.durationSeconds) / 60) : null,
  }
}
