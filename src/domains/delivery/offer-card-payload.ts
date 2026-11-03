import { Delivery, DeliveryQuote, Location } from '@prisma/types'
import { convertToKM } from 'src/shared-types/distance-unit'
import { OfferTrip } from './offer-trip'

// The facts an offer shows a rider, and nothing else (spec 0003, AC-10). The push message is built
// from this. The in app offer card (row 70, spec 0019) reuses its drop off area (dropoffAreaOf),
// so the two name the same place, and since row 100 the push carries the card's trip figures too, so
// the lock screen alert shows what the card shows. A push is visible on a lock screen that other people see, so the customer's
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
  'toPickupMetres',
  'toDropoffMetres',
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
  // The card's trip (spec 0019): road metres to the restaurant and on to the customer, and the
  // minutes for both. Unknown figures are null, as on the card (row 100).
  trip: OfferTrip
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
    // The quote's single figure, kept for an app older than row 100, which shows only this one.
    distanceKm: distanceKmOf(source.quote),
    // The card's figures (row 100): the app words them exactly as the card does.
    toPickupMetres: numberOrEmpty(source.trip.toPickupMetres),
    toDropoffMetres: numberOrEmpty(source.trip.toDropoffMetres),
    minutes: numberOrEmpty(source.trip.minutes),
    insistent: options.insistent ? '1' : '',
  }

  return payload
}

// The street when the house number is kept apart from it, otherwise the town; never a house
// number (spec 0003, value sourcing). Some stored streets carry the number even though it is also
// stored on its own, so a street that contains the house number falls back to the town too, and a
// town that contains it gives nothing. Erring towards less detail is the safe direction (AC-10).
export function dropoffAreaOf(location: OfferCardSource['dropoffLocation']): string {
  if (!location) return ''
  const houseNumber = location.houseNumber?.trim() ?? ''
  const street = location.street?.trim() ?? ''
  const city = location.city?.trim() ?? ''

  if (street && houseNumber && !street.includes(houseNumber)) return street
  if (houseNumber && city.includes(houseNumber)) return ''
  return city
}

// A known whole number as text, or '' for unknown (FCM data carries strings only).
function numberOrEmpty(value: number | null): string {
  return value !== null && Number.isFinite(value) ? String(Math.round(value)) : ''
}

// Restaurant to customer, in km with one decimal ('3.4'), from the quote. Only an app older than row
// 100 shows it; the current app shows the two legs above.
function distanceKmOf(quote: OfferCardSource['quote']): string {
  if (!quote || !Number.isFinite(quote.distance)) return ''
  const km = convertToKM(quote.distance, quote.distanceUnit)
  return (Math.round(km * 10) / 10).toFixed(1)
}
