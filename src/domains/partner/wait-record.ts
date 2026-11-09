import { EnumDeliveryEventType } from '@prisma/types'

// Spec 0030: a restaurant's wait record, worked out on read from its deliveries and their events.
// A plain function, so each rule (the last arrival and pickup, the median) is tested on its own.

export const WAIT_RECORD_DAYS = [7, 30, 90]
export const DEFAULT_WAIT_RECORD_DAYS = 30

const MINUTE_MS = 60_000

// The events that take a delivery from one rider and give it to another (or back to waiting).
export const HAND_OVER_EVENTS: EnumDeliveryEventType[] = [
  EnumDeliveryEventType.REASSIGNED,
  EnumDeliveryEventType.RETURNED_TO_WAITING,
  EnumDeliveryEventType.HANDED_BACK,
  EnumDeliveryEventType.WAIT_UNDISPATCHED,
]

export type WaitRecordDelivery = {
  id: string
  createdAt: Date
  readyAt: Date | null
  foodReadyAt: Date | null
  events: { type: EnumDeliveryEventType; occurredAt: Date }[]
}

export type WaitRecord = {
  orderCount: number
  waitSamples: number
  averageWaitMinutes: number | null
  lateShare: number | null
  prepSamples: number
  medianPrepMinutes: number | null
  usualPrepMinutes: number
}

// Spec 0030, AC-3. A reassigned delivery can hold two arrivals and two pickups, so this measures the
// last pickup against the last arrival at or before it: the rider who actually took the food. Waiting
// is counted from the later of the arrival and the ready time, so a rider who came early does not
// count against the restaurant. Null when there is no arrival to measure from.
export function waitMinutesOf(delivery: WaitRecordDelivery): number | null {
  if (!delivery.readyAt) return null
  const pickups = delivery.events.filter((event) => event.type === EnumDeliveryEventType.PICKED_UP)
  const lastPickup = latest(pickups.map((event) => event.occurredAt))
  if (!lastPickup) return null
  // A delivery that changed hands: an arrival from before the last hand over is the earlier rider's.
  const lastHandOver = latest(
    delivery.events.filter((event) => HAND_OVER_EVENTS.includes(event.type)).map((event) => event.occurredAt)
  )
  const arrivals = delivery.events.filter(
    (event) =>
      event.type === EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION &&
      event.occurredAt.getTime() <= lastPickup.getTime() &&
      (lastHandOver === null || event.occurredAt.getTime() >= lastHandOver.getTime())
  )
  const lastArrival = latest(arrivals.map((event) => event.occurredAt))
  if (!lastArrival) return null
  const from = Math.max(lastArrival.getTime(), delivery.readyAt.getTime())
  return Math.max(0, lastPickup.getTime() - from) / MINUTE_MS
}

// Spec 0030, AC-4.
function ranLate(delivery: WaitRecordDelivery): boolean {
  if (delivery.events.some((event) => event.type === EnumDeliveryEventType.READY_DELAYED)) return true
  return (
    delivery.foodReadyAt !== null &&
    delivery.readyAt !== null &&
    delivery.foodReadyAt.getTime() > delivery.readyAt.getTime()
  )
}

export function waitRecordOf(deliveries: WaitRecordDelivery[], usualPrepMinutes: number): WaitRecord {
  const waits = deliveries.map(waitMinutesOf).filter((wait): wait is number => wait !== null)
  const preps = deliveries
    .filter((delivery) => delivery.foodReadyAt !== null)
    .map((delivery) => ((delivery.foodReadyAt as Date).getTime() - delivery.createdAt.getTime()) / MINUTE_MS)
  return {
    orderCount: deliveries.length,
    waitSamples: waits.length,
    // Rounded to one decimal.
    averageWaitMinutes: waits.length === 0 ? null : Math.round((sum(waits) / waits.length) * 10) / 10,
    lateShare: deliveries.length === 0 ? null : deliveries.filter(ranLate).length / deliveries.length,
    prepSamples: preps.length,
    medianPrepMinutes: preps.length === 0 ? null : Math.round(median(preps)),
    usualPrepMinutes,
  }
}

function latest(dates: Date[]): Date | null {
  return dates.length === 0 ? null : dates.reduce((a, b) => (b.getTime() > a.getTime() ? b : a))
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

// With an even count, the mean of the two middle values (AC-5).
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
