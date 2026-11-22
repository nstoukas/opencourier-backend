// Spec 0048 (row 81): the rules of a mid job add on, one more order offered to a rider already on a job.
// Pure functions, no database and no network, like stack.ts beside it: TwoOrderService feeds them the
// deliveries and the road table, and the claim holds the same limits under the rider's lock. An add on is
// a pair like a stack (two orders, one box, the same delay limit), so it reuses stack.ts's rules and stop
// shapes; what differs is that the first order is already the rider's job, maybe with its food in the box.

import { EnumDeliveryStatus } from '@prisma/types'
import { DELIVERY_ONGOING_STATUSES, DELIVERY_PICKED_UP_STATUSES } from 'src/shared-types/stateMachine'
import { EnumAddOnMoment } from 'src/shared-types/stacking'
import { POINT, StackCandidate, StackStop, describeStops, stackRefusal, stackStopsOf, stopParts } from './stack'
import { eventPart } from 'src/domains/delivery-event/event-text'
import { EventPart } from 'src/shared-types/event-messages'

// What a phone reads when its automatic accept reaches an add on (AC-8): the rider must look at what it adds.
export const ADD_ON_NOT_AUTOMATIC_SENTENCE =
  'One more order on the way is never accepted automatically. Open it and choose.'

// The statuses in which the rider has not picked up the current job's food yet.
const BEFORE_PICKUP_STATUSES: EnumDeliveryStatus[] = [
  EnumDeliveryStatus.ACCEPTED,
  EnumDeliveryStatus.DISPATCHED,
  EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
]

// Whether the current job's food is already in the box (cross check 2: then an add on is offered calmly).
export function isCarryingFood(status: EnumDeliveryStatus): boolean {
  return DELIVERY_PICKED_UP_STATUSES.includes(status)
}

// Review fix (row 81): the job statuses the co-op's addOnMoment allows, so the candidate query and the locked
// claim ask for exactly these. Before this, the query took the five nearest riders on any job and the moment
// was checked afterwards, so five riders who had already picked up could crowd out a sixth who qualified.
// SAME_RESTAURANT's restaurant check stays in addOnMomentAllows (it needs both deliveries).
export function addOnJobStatuses(moment: EnumAddOnMoment): EnumDeliveryStatus[] {
  return moment === EnumAddOnMoment.BEFORE_DROPOFF ? DELIVERY_ONGOING_STATUSES : BEFORE_PICKUP_STATUSES
}

// AC-6: whether the co-op's addOnMoment allows an add on to a job in this status. `sameRestaurant`: the new
// order comes from the job's restaurant and pickup point (isSameRestaurant).
export function addOnMomentAllows(
  moment: EnumAddOnMoment,
  jobStatus: EnumDeliveryStatus,
  sameRestaurant: boolean
): boolean {
  switch (moment) {
    case EnumAddOnMoment.BEFORE_DROPOFF:
      return DELIVERY_ONGOING_STATUSES.includes(jobStatus)
    case EnumAddOnMoment.SAME_RESTAURANT:
      return BEFORE_PICKUP_STATUSES.includes(jobStatus) && sameRestaurant
    default:
      return BEFORE_PICKUP_STATUSES.includes(jobStatus)
  }
}

// Why the new order can never ride with the current job, or null when it can, for everything that needs no
// road time (AC-2): the stack rule (one box, never two legs of one order, two restaurants only when both are
// marked ready). Food already picked up counts as ready: the rider never waits at that restaurant again.
export function addOnRefusal(current: StackCandidate, next: StackCandidate, currentPickedUp: boolean): string | null {
  const currentAsRead =
    currentPickedUp && current.foodReadyAt === null ? { ...current, foodReadyAt: new Date(0) } : current
  return stackRefusal(currentAsRead, next)
}

export interface AddOnSequenceInput {
  currentId: string
  newId: string
  // Road seconds and metres between the five points of stack.ts's POINT (the current job as FIRST, the new
  // order as SECOND), from one OSRM table (moped profile). null where OSRM gave no route.
  seconds: (number | null)[][]
  metres: (number | null)[][]
  // The current job's food is in the box already: its pickup is behind the rider.
  currentPickedUp: boolean
  // When each order's food is ready (foodReadyAt, else the promised readyAt), as epoch ms; null for no time.
  currentReadyAtMs: number | null
  newReadyAtMs: number | null
  nowMs: number
  // The co-op's twoOrderDelayLimitMinutes, in seconds.
  delayLimitSeconds: number
}

export interface AddOnSequence {
  // The four stops in riding order, the same shape a stack stores (the current job's pickup first and
  // already done when its food is in the box).
  stops: StackStop[]
  // How much later each order's drop off arrives than it would alone, in whole seconds (0 or more).
  delaySeconds: Record<string, number>
  // From the rider's position now to the last drop off, waits included, in whole seconds.
  totalSeconds: number
  // AC-6: what the add on adds over the current job alone, from where the rider is now (whole numbers, 0 or more).
  extraSeconds: number
  extraMetres: number
  // Seconds from now until the rider reaches the new order's pickup (for timed offers, spec 0031).
  secondsToNewPickup: number
}

// The stop orders with the current job's pickup still ahead: each pickup before its own drop off.
const ORDERS_BEFORE_PICKUP: number[][] = [
  [POINT.FIRST_PICKUP, POINT.SECOND_PICKUP, POINT.FIRST_DROPOFF, POINT.SECOND_DROPOFF],
  [POINT.FIRST_PICKUP, POINT.SECOND_PICKUP, POINT.SECOND_DROPOFF, POINT.FIRST_DROPOFF],
  [POINT.SECOND_PICKUP, POINT.FIRST_PICKUP, POINT.FIRST_DROPOFF, POINT.SECOND_DROPOFF],
  [POINT.SECOND_PICKUP, POINT.FIRST_PICKUP, POINT.SECOND_DROPOFF, POINT.FIRST_DROPOFF],
  [POINT.FIRST_PICKUP, POINT.FIRST_DROPOFF, POINT.SECOND_PICKUP, POINT.SECOND_DROPOFF],
  [POINT.SECOND_PICKUP, POINT.SECOND_DROPOFF, POINT.FIRST_PICKUP, POINT.FIRST_DROPOFF],
]

// With the current job's food in the box: three stops left, the new pickup before its drop off.
const ORDERS_AFTER_PICKUP: number[][] = [
  [POINT.FIRST_DROPOFF, POINT.SECOND_PICKUP, POINT.SECOND_DROPOFF],
  [POINT.SECOND_PICKUP, POINT.FIRST_DROPOFF, POINT.SECOND_DROPOFF],
  [POINT.SECOND_PICKUP, POINT.SECOND_DROPOFF, POINT.FIRST_DROPOFF],
]

// The add on's stop order (AC-2, AC-6, cross check 5): of the orders above, the shortest in time to the last
// drop off among those where neither customer's food arrives more than the delay limit later than alone.
// "Alone" is cross check 5's baseline: the same rider, from where they are now, straight there (for the
// current job, from its pickup on once the food is in the box). Each pickup waits for its food. Also what
// it adds over the current job alone, in time and road metres. null when no order keeps both customers
// within the limit, or a road figure is missing (with OSRM down, no add on is offered: cross check 5).
export function bestAddOnSequence(input: AddOnSequenceInput): AddOnSequence | null {
  const { nowMs } = input
  const figure = (table: (number | null)[][], from: number, to: number): number | null => {
    const value = table[from]?.[to]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  const readyMs = (point: number): number | null =>
    point === POINT.FIRST_PICKUP ? input.currentReadyAtMs : point === POINT.SECOND_PICKUP ? input.newReadyAtMs : null
  const afterPickup = (arrivalMs: number, point: number): number => Math.max(arrivalMs, readyMs(point) ?? arrivalMs)

  // One ride through `points` from the rider: the time each point is left, and the road metres in all.
  const ride = (
    points: number[]
  ): { leftAtMs: Map<number, number>; arrivedAtMs: Map<number, number>; metres: number } | null => {
    let position: number = POINT.RIDER
    let clockMs = nowMs
    let metres = 0
    const leftAtMs = new Map<number, number>()
    const arrivedAtMs = new Map<number, number>()
    for (const point of points) {
      const seconds = figure(input.seconds, position, point)
      const distance = figure(input.metres, position, point)
      if (seconds === null || distance === null) return null
      clockMs += seconds * 1000
      metres += distance
      arrivedAtMs.set(point, clockMs)
      if (point === POINT.FIRST_PICKUP || point === POINT.SECOND_PICKUP) clockMs = afterPickup(clockMs, point)
      leftAtMs.set(point, clockMs)
      position = point
    }
    return { leftAtMs, arrivedAtMs, metres }
  }

  const currentAlone = ride(input.currentPickedUp ? [POINT.FIRST_DROPOFF] : [POINT.FIRST_PICKUP, POINT.FIRST_DROPOFF])
  const newAlone = ride([POINT.SECOND_PICKUP, POINT.SECOND_DROPOFF])
  const currentAloneDropMs = currentAlone?.leftAtMs.get(POINT.FIRST_DROPOFF)
  const newAloneDropMs = newAlone?.leftAtMs.get(POINT.SECOND_DROPOFF)
  if (!currentAlone || currentAloneDropMs === undefined || newAloneDropMs === undefined) return null

  let best: AddOnSequence | null = null
  for (const order of input.currentPickedUp ? ORDERS_AFTER_PICKUP : ORDERS_BEFORE_PICKUP) {
    const trip = ride(order)
    const currentDropMs = trip?.leftAtMs.get(POINT.FIRST_DROPOFF)
    const newDropMs = trip?.leftAtMs.get(POINT.SECOND_DROPOFF)
    const newPickupMs = trip?.arrivedAtMs.get(POINT.SECOND_PICKUP)
    if (!trip || currentDropMs === undefined || newDropMs === undefined || newPickupMs === undefined) continue

    const currentDelay = Math.max(0, Math.round((currentDropMs - currentAloneDropMs) / 1000))
    const newDelay = Math.max(0, Math.round((newDropMs - newAloneDropMs) / 1000))
    if (currentDelay > input.delayLimitSeconds || newDelay > input.delayLimitSeconds) continue

    const totalSeconds = Math.round((Math.max(currentDropMs, newDropMs) - nowMs) / 1000)
    if (best === null || totalSeconds < best.totalSeconds) {
      const stops = order.map((point) => toStop(point, input.currentId, input.newId))
      best = {
        // The current job's pickup stays in the list, done, so a stored sequence always has four stops.
        stops: input.currentPickedUp ? [{ deliveryId: input.currentId, stop: 'PICKUP' }, ...stops] : stops,
        delaySeconds: { [input.currentId]: currentDelay, [input.newId]: newDelay },
        totalSeconds,
        extraSeconds: Math.max(0, Math.round((Math.max(currentDropMs, newDropMs) - currentAloneDropMs) / 1000)),
        extraMetres: Math.max(0, Math.round(trip.metres - currentAlone.metres)),
        secondsToNewPickup: Math.max(0, Math.round((newPickupMs - nowMs) / 1000)),
      }
    }
  }
  return best
}

function toStop(point: number, currentId: string, newId: string): StackStop {
  switch (point) {
    case POINT.FIRST_PICKUP:
      return { deliveryId: currentId, stop: 'PICKUP' }
    case POINT.SECOND_PICKUP:
      return { deliveryId: newId, stop: 'PICKUP' }
    case POINT.FIRST_DROPOFF:
      return { deliveryId: currentId, stop: 'DROPOFF' }
    default:
      return { deliveryId: newId, stop: 'DROPOFF' }
  }
}

// What the add on rule reads of a delivery to tell an open add on offer.
export interface AddOnOfferState {
  id: string
  status: EnumDeliveryStatus
  matchedCourierId: string | null
  offerGroupId: string | null
  stopSequence: unknown
}

// Whether this delivery is an open add on offer: still waiting with an offer out, alone (no stack group),
// and carrying a stop list through another delivery, the rider's current job. Every single offer and every
// ended offer clears the stop list, and an accepted add on joins its job's group, so nothing else matches.
export function isAddOnOffer(delivery: AddOnOfferState): boolean {
  return (
    delivery.status === EnumDeliveryStatus.ASSIGNING_COURIER &&
    delivery.matchedCourierId !== null &&
    delivery.offerGroupId === null &&
    stackStopsOf(delivery.stopSequence) !== null
  )
}

// The current job an add on stop list names (the other delivery in it), or null when there is none.
export function addOnJobIdOf(delivery: { id: string; stopSequence: unknown }): string | null {
  const stops = stackStopsOf(delivery.stopSequence)
  return stops?.find((stop) => stop.deliveryId !== delivery.id)?.deliveryId ?? null
}

// The phone's figures: "+2.1 km, +7 min". Km to one decimal, minutes whole, never below 0.
export function addOnFigures(
  extraMetres: number | null,
  extraSeconds: number | null
): { extraKm: number; extraMinutes: number } | null {
  if (extraMetres === null || extraSeconds === null) return null
  return {
    extraKm: Math.round(Math.max(0, extraMetres) / 100) / 10,
    extraMinutes: Math.round(Math.max(0, extraSeconds) / 60),
  }
}

// The OFFERED event's words for an add on (value 1: members read on the record which job it was added to,
// what it added and the stops). Ids only, never an address.
// Review fix (row 81, value 1): it also says why a rider on a job got it rather than a free rider: under
// WHENEVER_FITS with a free rider found, the add on went first (decision 81.3); otherwise no free rider was found.
export function describeAddOn(
  jobId: string,
  sequence: AddOnSequence,
  carryingFood: boolean,
  freeRiderFound: boolean
): string {
  const figures = addOnFigures(sequence.extraMetres, sequence.extraSeconds)
  const adds = figures ? ` (+${figures.extraKm} km, +${figures.extraMinutes} min)` : ''
  const calm = carryingFood ? '; the rider carries food, so twice the time to answer and no insistent ring' : ''
  const why = freeRiderFound
    ? '; a free rider was found, and the co-op offers an add on whenever it fits'
    : '; no free rider was found'
  return `offered as one more order on the way, added to the job of delivery ${jobId}${adds}, stops: ${describeStops(
    sequence.stops
  )}${calm}${why}`
}

// Spec 0054: describeAddOn as a part of the OFFERED record, so each app can say it in its reader's
// language. In English it renders as "; " followed by describeAddOn's sentence, word for word.
export function addOnPart(
  jobId: string,
  sequence: AddOnSequence,
  carryingFood: boolean,
  freeRiderFound: boolean
): EventPart {
  const figures = addOnFigures(sequence.extraMetres, sequence.extraSeconds)
  return eventPart('ADD_ON', {
    jobId,
    figures: figures
      ? [eventPart('ADD_ON_FIGURES', { extraKm: figures.extraKm, extraMinutes: figures.extraMinutes })]
      : [],
    stops: stopParts(sequence.stops),
    calm: carryingFood ? [eventPart('ADD_ON_CARRYING_FOOD', {})] : [],
    why: freeRiderFound ? eventPart('ADD_ON_FREE_RIDER_FOUND', {}) : eventPart('ADD_ON_NO_FREE_RIDER', {}),
  })
}
