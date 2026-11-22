// Spec 0048 (row 80): the rules of a stacked offer, two waiting orders offered together to one rider.
// Pure functions, no database and no network, so each rule can be tested on its own (like legs.ts and
// box.ts). TwoOrderService feeds them the deliveries and the road times; the claim and the accept in the
// repositories hold the same limits under a lock.

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
}

// Why two deliveries cannot be stacked, or null when they can, for everything that needs no road time
// (AC-2). Slice 1 stacks orders of the same restaurant only: the same partner and the same pickup point
// (operator, 2026-11-20: "same restaurant stacks first"). Two legs of one order are never stacked: legs
// exist so that one rider never carries the whole order (spec 0046).
export function stackRefusal(first: StackCandidate, second: StackCandidate): string | null {
  if (first.id === second.id) return 'the same delivery'
  if (first.boxUnits + second.boxUnits > RIDER_BOX_UNITS) return 'they do not fit in one box together'
  if (!first.partnerId || first.partnerId !== second.partnerId) return 'not the same restaurant'
  if (first.pickupLocationId !== second.pickupLocationId) return 'not the same pickup point'
  if (
    first.legCount !== null &&
    second.legCount !== null &&
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
// route; the first one found wins a tie, so the answer is always the same for the same input.
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
