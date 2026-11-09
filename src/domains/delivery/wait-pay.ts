import { EnumDeliveryEventType } from '@prisma/types'
import { HAND_OVER_EVENTS } from 'src/domains/partner/wait-record'

// Spec 0033: the rule for restaurant delay pay, as plain functions so each part is tested on its own.
// Nothing is paid before the promised time, and the first free minutes after it are free; after
// that the rider is paid per minute and the restaurant pays all of it. A rider who arrives after
// those free minutes, to food already marked ready, kept nobody waiting and earns nothing.

const MINUTE_MS = 60_000

export type WaitEvent = {
  id: string
  type: EnumDeliveryEventType
  occurredAt: Date
  courierId: string | null
}

export type CompletedWait = {
  endEventId: string
  courierId: string | null
  minutes: number
}

// The events that end a wait: the rider took the food, or left without it.
export const WAIT_END_EVENTS: EnumDeliveryEventType[] = [
  EnumDeliveryEventType.PICKED_UP,
  EnumDeliveryEventType.WAIT_UNDISPATCHED,
]

export type WaitTimes = {
  arrivedAt: Date
  promisedReadyAt: Date
  foodReadyAt: Date | null
  freeMinutes: number
}

// AC-2. When a wait starts earning, or null if it never does: the later of the arrival and the
// promise plus the free minutes, except for a late rider who found the food ready.
export function waitPaidFrom(times: WaitTimes): Date | null {
  const arrived = times.arrivedAt.getTime()
  const freeUntil = times.promisedReadyAt.getTime() + times.freeMinutes * MINUTE_MS
  const riderWasLate = arrived > freeUntil
  if (riderWasLate && times.foodReadyAt && times.foodReadyAt.getTime() <= arrived) return null
  return new Date(Math.max(arrived, freeUntil))
}

// AC-2. Whole minutes from when the wait starts earning to its end, rounded down, never below 0.
export function paidWaitMinutes(input: WaitTimes & { endedAt: Date }): number {
  const paidFrom = waitPaidFrom(input)
  if (!paidFrom) return 0
  return Math.max(0, Math.floor((input.endedAt.getTime() - paidFrom.getTime()) / MINUTE_MS))
}

// AC-6. When a rider may leave: the co-op's minutes after the first promise, so a delay tapped by
// the restaurant cannot push it back.
export function waitLeaveFrom(promisedReadyAt: Date, leaveMinutes: number): Date {
  return new Date(promisedReadyAt.getTime() + leaveMinutes * MINUTE_MS)
}

// The co-op's settings the rider's job card needs. `payOn` is false with delay pay off or a rate of 0.
export type CourierWaitRules = {
  leaveMinutes: number
  freeMinutes: number
  payOn: boolean
}

// Every wait in this delivery's history that earned pay, in time order. A delivery can change hands,
// so each end is matched with the last arrival since the previous end or hand over.
export function completedWaits(
  events: WaitEvent[],
  promisedReadyAt: Date | null,
  foodReadyAt: Date | null,
  freeMinutes: number
): CompletedWait[] {
  if (!promisedReadyAt) return []
  const waits: CompletedWait[] = []
  let arrivedAt: Date | null = null
  for (const event of events) {
    if (event.type === EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION) {
      arrivedAt = event.occurredAt
    } else if (WAIT_END_EVENTS.includes(event.type)) {
      if (arrivedAt) {
        const minutes = paidWaitMinutes({ arrivedAt, promisedReadyAt, foodReadyAt, freeMinutes, endedAt: event.occurredAt })
        if (minutes > 0) waits.push({ endEventId: event.id, courierId: event.courierId, minutes })
      }
      arrivedAt = null
    } else if (HAND_OVER_EVENTS.includes(event.type)) {
      arrivedAt = null
    }
  }
  return waits
}

// The wait closed by the newest end event on the trail, or null when the trail cannot show one: the
// end or its arrival was never saved, or it earned no minutes. A wait from earlier in the delivery's
// history is never returned, so it cannot be paid in place of the one that is owed.
export function latestCompletedWait(
  events: WaitEvent[],
  promisedReadyAt: Date | null,
  foodReadyAt: Date | null,
  freeMinutes: number
): CompletedWait | null {
  const ends = events.filter((event) => WAIT_END_EVENTS.includes(event.type))
  const lastEnd = ends[ends.length - 1]
  const waits = completedWaits(events, promisedReadyAt, foodReadyAt, freeMinutes)
  const last = waits[waits.length - 1]
  return lastEnd && last && last.endEventId === lastEnd.id ? last : null
}

export function waitOfKey(deliveryId: string, endEventId: string): string {
  return `${deliveryId}:${endEventId}`
}
