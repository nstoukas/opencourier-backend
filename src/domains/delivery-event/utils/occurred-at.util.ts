import { EnumDeliveryEventType } from '@prisma/types'

// The longest a job step may have waited on a rider's phone before it reached the server (spec 0009,
// AC-7): 7 days in milliseconds. A step older than this is refused with a 400 rather than guessed at.
export const MAX_TAP_AGE_MS = 7 * 24 * 60 * 60 * 1000

// The job step events whose time bounds the next step's tap time from below (spec 0009, AC-7):
// a step cannot have happened before the rider accepted the delivery, nor before the step that
// came before it, so the job's timeline never runs backwards.
export const TAP_FLOOR_EVENT_TYPES: EnumDeliveryEventType[] = [
  EnumDeliveryEventType.ACCEPTED,
  EnumDeliveryEventType.DISPATCHED,
  EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
  EnumDeliveryEventType.PICKED_UP,
  EnumDeliveryEventType.ON_THE_WAY,
  EnumDeliveryEventType.ARRIVED_AT_DROPOFF_LOCATION,
]

// When a rider's job step happened, from what the phone says and what the server knows (spec 0009).
// - receivedAt: the server's clock when it handled the request.
// - tapAgeMs: how long before sending the rider tapped, measured on the phone. An age, not a date,
//   so a phone whose clock is set to the wrong day cannot move pay.
// - floor: the earliest the step can have happened (the delivery's latest job step, or its creation).
// The result is never before the floor and never after receivedAt.
export function occurredAtForTap(input: { receivedAt: Date; tapAgeMs: number; floor: Date }): Date {
  const received = input.receivedAt.getTime()
  const tapped = received - input.tapAgeMs
  const atLeastFloor = Math.max(tapped, input.floor.getTime())
  return new Date(Math.min(atLeastFloor, received))
}
