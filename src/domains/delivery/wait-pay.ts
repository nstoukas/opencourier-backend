import { EnumDeliveryEventType } from '@prisma/types'
import { HAND_OVER_EVENTS } from 'src/domains/partner/wait-record'

// Spec 0033: the rule for restaurant delay pay, as plain functions so each part is tested on its own.
// Nothing is paid before the promised time, and the first free minutes after it are free; after
// that the rider is paid per minute and the restaurant pays all of it.

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

// AC-2. Whole minutes from the later of the arrival and the promise plus the free minutes, to the
// end, rounded down, never below 0.
export function paidWaitMinutes(input: {
  arrivedAt: Date
  promisedReadyAt: Date
  freeMinutes: number
  endedAt: Date
}): number {
  const start = Math.max(input.arrivedAt.getTime(), input.promisedReadyAt.getTime() + input.freeMinutes * MINUTE_MS)
  return Math.max(0, Math.floor((input.endedAt.getTime() - start) / MINUTE_MS))
}

// Every wait in this delivery's history that earned pay, in time order. A delivery can change hands,
// so each end is matched with the last arrival since the previous end or hand over.
export function completedWaits(events: WaitEvent[], promisedReadyAt: Date | null, freeMinutes: number): CompletedWait[] {
  if (!promisedReadyAt) return []
  const waits: CompletedWait[] = []
  let arrivedAt: Date | null = null
  for (const event of events) {
    if (event.type === EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION) {
      arrivedAt = event.occurredAt
    } else if (WAIT_END_EVENTS.includes(event.type)) {
      if (arrivedAt) {
        const minutes = paidWaitMinutes({ arrivedAt, promisedReadyAt, freeMinutes, endedAt: event.occurredAt })
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
  freeMinutes: number
): CompletedWait | null {
  const ends = events.filter((event) => WAIT_END_EVENTS.includes(event.type))
  const lastEnd = ends[ends.length - 1]
  const waits = completedWaits(events, promisedReadyAt, freeMinutes)
  const last = waits[waits.length - 1]
  return lastEnd && last && last.endEventId === lastEnd.id ? last : null
}

export function waitOfKey(deliveryId: string, endEventId: string): string {
  return `${deliveryId}:${endEventId}`
}
