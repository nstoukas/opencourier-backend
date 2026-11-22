// Spec 0048 (row 80): the rules of a stacked offer, two waiting orders offered together to one rider.
// Pure functions, no database and no network, so each rule can be tested on its own (like legs.ts and
// box.ts). TwoOrderService feeds them the deliveries and the road times; the claim and the accept in the
// repositories hold the same limits under a lock.

import { EnumDeliveryStatus } from '@prisma/types'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types/stateMachine'
import { RIDER_BOX_UNITS } from './box'

// Never more than two deliveries held by one rider at once (spec 0048, key invariants; cross check 10).
// VROOM is the locked tool for 3 or more, and it comes last (AGENTS.md, staged dispatch path).
export const MAX_DELIVERIES_HELD = 2

// What an admin reads when a hand offer or a reassign would give a rider a third delivery. No confirm
// can push past it, unlike the box (cross check 10).
export const THIRD_DELIVERY_REFUSED_SENTENCE =
  'This rider already holds two orders. A third is never allowed; move one of theirs first.'

// What a phone reads when its automatic accept reaches a stack: a pair is never accepted on its own,
// because the rider must check that both bags fit (spec 0048, AC-8 and Follow-up).
export const STACK_NOT_AUTOMATIC_SENTENCE = 'A pair of orders is never accepted automatically. Open it and choose.'

// What a rider reads when one order of their pair was taken or ended before their accept arrived (AC-5).
// Nothing was accepted; their offers screen shows what is still open.
export const STACK_CHANGED_SENTENCE =
  'One order of this pair changed before your answer arrived, so nothing was accepted. Check your offers again.'

// One stop of a stack's route: picking an order up at its restaurant, or handing it over at its drop off.
export type StackStopKind = 'PICKUP' | 'DROPOFF'
export interface StackStop {
  deliveryId: string
  stop: StackStopKind
}

// What the compatibility rule reads of each delivery. A `Pick` of the entity would do; a small interface
// keeps the tests free of every other column.
export interface StackCandidate {
  id: string
  partnerId: string | null
  pickupLocationId: string
  boxUnits: number
  orderReference: string | null
  legCount: number | null
  // When the restaurant marked the food ready (row 21), or null while it has not.
  foodReadyAt: Date | null
}

// Same restaurant means the same partner and the same pickup point (decision 80.1a): the stops are then
// worked out from one real place. A partner with two kitchens counts as two restaurants.
export function isSameRestaurant(
  first: Pick<StackCandidate, 'partnerId' | 'pickupLocationId'>,
  second: Pick<StackCandidate, 'partnerId' | 'pickupLocationId'>
): boolean {
  return first.partnerId !== null && first.partnerId === second.partnerId && first.pickupLocationId === second.pickupLocationId
}

// Why two deliveries cannot be stacked, or null when they can, for everything that needs no road time
// (AC-2). Orders of the same restaurant (slice 1), or of two restaurants when both are already marked
// ready (slice 2, row 80's Done when): a rider never waits at one restaurant while the other order's
// food goes cold. Two legs of one order are never stacked: legs exist so that one rider never carries
// the whole order (spec 0046).
export function stackRefusal(first: StackCandidate, second: StackCandidate): string | null {
  if (first.id === second.id) return 'the same delivery'
  if (first.boxUnits + second.boxUnits > RIDER_BOX_UNITS) return 'they do not fit in one box together'
  if (!isSameRestaurant(first, second) && (first.foodReadyAt === null || second.foodReadyAt === null)) {
    return 'two restaurants, and not both marked ready'
  }
  // Legs of one order share their restaurant and orderReference (spec 0046); two restaurants may both use "1001".
  if (
    first.legCount !== null &&
    second.legCount !== null &&
    first.partnerId !== null &&
    first.partnerId === second.partnerId &&
    first.orderReference !== null &&
    first.orderReference === second.orderReference
  ) {
    return 'two legs of one order'
  }
  return null
}

// The road times the sequence is worked out from: `seconds[from][to]` between the points numbered below,
// from one OSRM table (moped profile). null where OSRM gave no route.
export const POINT = { RIDER: 0, FIRST_PICKUP: 1, SECOND_PICKUP: 2, FIRST_DROPOFF: 3, SECOND_DROPOFF: 4 } as const

export interface StackSequenceInput {
  firstId: string
  secondId: string
  seconds: (number | null)[][]
  // When each order's food is ready (foodReadyAt, else the promised readyAt), as epoch milliseconds; null
  // when there is no time. A rider who arrives earlier waits for it (cross check 5).
  firstReadyAtMs: number | null
  secondReadyAtMs: number | null
  nowMs: number
  // The co-op's twoOrderDelayLimitMinutes, in seconds.
  delayLimitSeconds: number
}

export interface StackSequence {
  stops: StackStop[]
  // How much later each order's drop off arrives than it would alone, in whole seconds (0 or more).
  delaySeconds: Record<string, number>
  // From the rider's position now to the last drop off, waits included, in whole seconds.
  totalSeconds: number
}

// The four stops as point numbers, in every order where each pickup comes before its own drop off: six
// orders in all. A same restaurant pair has both pickups at one point, so some of these are the same
// route; two restaurants (slice 2) give six different routes. The first one found wins a tie, so the answer is always the same for the same input.
const ORDERS: number[][] = [
  [POINT.FIRST_PICKUP, POINT.SECOND_PICKUP, POINT.FIRST_DROPOFF, POINT.SECOND_DROPOFF],
  [POINT.FIRST_PICKUP, POINT.SECOND_PICKUP, POINT.SECOND_DROPOFF, POINT.FIRST_DROPOFF],
  [POINT.SECOND_PICKUP, POINT.FIRST_PICKUP, POINT.FIRST_DROPOFF, POINT.SECOND_DROPOFF],
  [POINT.SECOND_PICKUP, POINT.FIRST_PICKUP, POINT.SECOND_DROPOFF, POINT.FIRST_DROPOFF],
  [POINT.FIRST_PICKUP, POINT.FIRST_DROPOFF, POINT.SECOND_PICKUP, POINT.SECOND_DROPOFF],
  [POINT.SECOND_PICKUP, POINT.SECOND_DROPOFF, POINT.FIRST_PICKUP, POINT.FIRST_DROPOFF],
]

// The stack's stop order (AC-2, cross check 5): of the orders above, the shortest in time to the last drop
// off among those where neither customer's food arrives more than the delay limit later than it would if
// the same rider took that order alone, from where they are now, straight there. Each pickup waits for
// the food to be ready. null when no order keeps both customers within the limit, or a road time is
// missing (with OSRM down, no stack is offered: cross check 5).
export function bestStackSequence(input: StackSequenceInput): StackSequence | null {
  const { seconds, nowMs } = input
  const at = (from: number, to: number): number | null => {
    const value = seconds[from]?.[to]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  const readyMs = (point: number): number | null =>
    point === POINT.FIRST_PICKUP ? input.firstReadyAtMs : point === POINT.SECOND_PICKUP ? input.secondReadyAtMs : null
  // `afterPickup` waits at a pickup until the food is ready.
  const afterPickup = (arrivalMs: number, point: number): number => Math.max(arrivalMs, readyMs(point) ?? arrivalMs)

  // Alone: the rider goes from here to the order's restaurant, waits for its food, then to its customer.
  const alone = (pickup: number, dropoff: number): number | null => {
    const toPickup = at(POINT.RIDER, pickup)
    const toDropoff = at(pickup, dropoff)
    if (toPickup === null || toDropoff === null) return null
    return afterPickup(nowMs + toPickup * 1000, pickup) + toDropoff * 1000
  }
  const firstAlone = alone(POINT.FIRST_PICKUP, POINT.FIRST_DROPOFF)
  const secondAlone = alone(POINT.SECOND_PICKUP, POINT.SECOND_DROPOFF)
  if (firstAlone === null || secondAlone === null) return null

  let best: StackSequence | null = null
  for (const order of ORDERS) {
    let position: number = POINT.RIDER
    let clockMs = nowMs
    let firstDropMs: number | null = null
    let secondDropMs: number | null = null
    let routable = true
    for (const point of order) {
      const leg = at(position, point)
      if (leg === null) {
        routable = false
        break
      }
      clockMs += leg * 1000
      if (point === POINT.FIRST_PICKUP || point === POINT.SECOND_PICKUP) clockMs = afterPickup(clockMs, point)
      if (point === POINT.FIRST_DROPOFF) firstDropMs = clockMs
      if (point === POINT.SECOND_DROPOFF) secondDropMs = clockMs
      position = point
    }
    if (!routable || firstDropMs === null || secondDropMs === null) continue

    const firstDelay = Math.max(0, Math.round((firstDropMs - firstAlone) / 1000))
    const secondDelay = Math.max(0, Math.round((secondDropMs - secondAlone) / 1000))
    if (firstDelay > input.delayLimitSeconds || secondDelay > input.delayLimitSeconds) continue

    const totalSeconds = Math.round((Math.max(firstDropMs, secondDropMs) - nowMs) / 1000)
    if (best === null || totalSeconds < best.totalSeconds) {
      best = {
        stops: order.map((point) => toStop(point, input.firstId, input.secondId)),
        delaySeconds: { [input.firstId]: firstDelay, [input.secondId]: secondDelay },
        totalSeconds,
      }
    }
  }
  return best
}

function toStop(point: number, firstId: string, secondId: string): StackStop {
  switch (point) {
    case POINT.FIRST_PICKUP:
      return { deliveryId: firstId, stop: 'PICKUP' }
    case POINT.SECOND_PICKUP:
      return { deliveryId: secondId, stop: 'PICKUP' }
    case POINT.FIRST_DROPOFF:
      return { deliveryId: firstId, stop: 'DROPOFF' }
    default:
      return { deliveryId: secondId, stop: 'DROPOFF' }
  }
}

// "pickup A, pickup B, drop off B, drop off A", with the first 8 characters of each id, for the OFFERED
// event's message (value 1: members can read the order of stops on the record). Ids only, no address.
export function describeStops(stops: StackStop[]): string {
  return stops.map((s) => `${s.stop === 'PICKUP' ? 'pickup' : 'drop off'} ${s.deliveryId.slice(0, 8)}`).join(', ')
}

// The Redis key that keeps two orders from being stacked together again for 20 minutes after their stack
// was declined or missed (cross check 9). The same key whichever of the two is matched first.
export function stackPairBlockKey(oneId: string, otherId: string): string {
  const [low, high] = [oneId, otherId].sort()
  return `stack-pair-block-${low}-${high}`
}

// Spec 0048 (cross check 6): the stored `stopSequence` read back, or null when it is missing or not the
// shape the stack offer writes (four stops of exactly two deliveries). A Json column can hold anything,
// so every reader goes through this check rather than trusting a cast.
export function stackStopsOf(value: unknown): StackStop[] | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  const stops: StackStop[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null
    const { deliveryId, stop } = item as Record<string, unknown>
    if (typeof deliveryId !== 'string' || (stop !== 'PICKUP' && stop !== 'DROPOFF')) return null
    stops.push({ deliveryId, stop })
  }
  return new Set(stops.map((s) => s.deliveryId)).size === 2 ? stops : null
}

// What the stop sequence rule reads of each delivery of a stack.
export interface StackMemberState {
  status: EnumDeliveryStatus
  matchedCourierId: string | null
  courierId: string | null
}

// Spec 0048 (cross check 6): whether the two deliveries of a stack are still with one rider, so their
// stop sequence still holds: both open offers to that rider, or both jobs that rider holds (or one of
// each, while a group accept lands). Anything else (an order delivered, cancelled, moved, handed back,
// offered to someone else) means the survivor goes on alone and the sequence is cleared on both.
export function pairStillTogether(members: StackMemberState[]): boolean {
  if (members.length !== 2) return false
  const riders = members.map((member) => {
    if (member.status === EnumDeliveryStatus.ASSIGNING_COURIER) return member.matchedCourierId
    return DELIVERY_ONGOING_STATUSES.includes(member.status) ? member.courierId : null
  })
  return riders[0] !== null && riders[0] === riders[1]
}

// The statuses in which a delivery's pickup is still ahead of the rider (the route's own list, spec 0018).
const PICKUP_STILL_AHEAD_STATUSES: EnumDeliveryStatus[] = [
  EnumDeliveryStatus.ASSIGNING_COURIER,
  EnumDeliveryStatus.ACCEPTED,
  EnumDeliveryStatus.DISPATCHED,
  EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
]

// Spec 0048 (AC-10): whether a stop is already behind the rider, from its delivery's status. A pickup is
// done once the food is picked up; a drop off once the order is no longer on its way (delivered or ended).
export function isStopDone(stop: StackStopKind, status: EnumDeliveryStatus): boolean {
  if (stop === 'PICKUP') return !PICKUP_STILL_AHEAD_STATUSES.includes(status)
  return status !== EnumDeliveryStatus.ASSIGNING_COURIER && !DELIVERY_ONGOING_STATUSES.includes(status)
}
