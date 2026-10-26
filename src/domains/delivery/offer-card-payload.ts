import { Delivery, DeliveryQuote, Location } from '@prisma/types'
import { convertToKM } from 'src/shared-types/distance-unit'

// The facts an offer shows a rider, and nothing else (spec 0003, AC-10). The push message is built
// from this, and row 70 will build the in app offer card from the same function, so the two can
// never drift apart. A push is visible on a lock screen that other people see, so the customer's
// name, phone, house number, notes and items must never get in here.
//
// This list IS the allow list: the builder returns exactly these keys, and the push sender copies
// only these keys into the FCM message. `as const` makes TypeScript treat the array as these exact
// strings rather than any string, so the type below can be built from it.
export const OFFER_CARD_PAYLOAD_KEYS = [
  'deliveryId',
  'offeredAt',
  'offerExpiresAt',
  'serverNow',
  'payTotal',
  'currencyCode',
  'restaurantName',
  'dropoffArea',
  'distanceKm',
  'minutes',
  'insistent',
] as const

// `(typeof X)[number]` is "any one element of the array X": the union 'deliveryId' | 'offeredAt' | ...
export type OfferCardPayloadKey = (typeof OFFER_CARD_PAYLOAD_KEYS)[number]

// Every value is a string because FCM data messages carry strings only. An empty string means
// "not known" (no deadline, no distance yet).
export type OfferCardPayload = Record<OfferCardPayloadKey, string>

// What the builder is allowed to read. `Pick<Delivery, 'id' | ...>` is the Delivery type cut down to
// the named fields, so the builder cannot even see the customer's name or phone: reading one would
// be a compile error, not a review comment.
export interface OfferCardSource {
  delivery: Pick<
    Delivery,
    'id' | 'offeredAt' | 'offerExpiresAt' | 'totalCompensation' | 'currencyCode' | 'pickupBusinessName'
  >
  dropoffLocation: Pick<Location, 'street' | 'houseNumber' | 'city'> | null
  // The quote the delivery was priced from: its distance is restaurant to customer, in the unit the
  // quote was made in.
  quote: Pick<DeliveryQuote, 'distance' | 'distanceUnit'> | null
}

export interface OfferCardOptions {
  // The server clock at send, so the phone can count down without trusting its own clock.
  serverNow: Date
  // True only on the 2 minute re-send of an offer with no deadline (AC-7).
  insistent?: boolean
}

export function buildOfferCardPayload(source: OfferCardSource, options: OfferCardOptions): OfferCardPayload {
  const { delivery } = source

  // Typed as OfferCardPayload, so TypeScript refuses a key outside the allow list or a missing one.
  const payload: OfferCardPayload = {
    deliveryId: delivery.id,
    offeredAt: delivery.offeredAt ? delivery.offeredAt.toISOString() : '',
    offerExpiresAt: delivery.offerExpiresAt ? delivery.offerExpiresAt.toISOString() : '',
    serverNow: options.serverNow.toISOString(),
    // Rider pay as the offer shows it, in minor units (cents).
    payTotal: delivery.totalCompensation !== null ? String(Math.round(delivery.totalCompensation)) : '',
    currencyCode: delivery.currencyCode,
    // The business name (what Earnings and History show); pickupName is a contact person.
    restaurantName: delivery.pickupBusinessName,
    dropoffArea: dropoffAreaOf(source.dropoffLocation),
    distanceKm: distanceKmOf(source.quote),
    // Row 70 sends the minutes; until then the phone shows none.
    minutes: '',
    insistent: options.insistent ? '1' : '',
  }

  return payload
}

// The street when the house number is kept apart from it, otherwise the town; never a house
// number (spec 0003, value sourcing). Some stored streets carry the number even though it is also
// stored on its own, so a street that contains the house number falls back to the town too, and a
// town that contains it gives nothing. Erring towards less detail is the safe direction (AC-10).
function dropoffAreaOf(location: OfferCardSource['dropoffLocation']): string {
  if (!location) return ''
  const houseNumber = location.houseNumber?.trim() ?? ''
  const street = location.street?.trim() ?? ''
  const city = location.city?.trim() ?? ''

  if (street && houseNumber && !street.includes(houseNumber)) return street
  if (houseNumber && city.includes(houseNumber)) return ''
  return city
}

// Restaurant to customer, in km with one decimal ('3.4'). Row 70 replaces it with the two leg split.
function distanceKmOf(quote: OfferCardSource['quote']): string {
  if (!quote || !Number.isFinite(quote.distance)) return ''
  const km = convertToKM(quote.distance, quote.distanceUnit)
  return (Math.round(km * 10) / 10).toFixed(1)
}
