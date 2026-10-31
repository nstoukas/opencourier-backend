import { EnumDeliveryEventType } from '@prisma/types'
import {
  occurredAtForTap,
  MAX_TAP_AGE_MS,
  TAP_FLOOR_EVENT_TYPES,
} from './occurred-at.util'

describe('occurredAtForTap (Spec 0009, AC-7 bounds)', () => {
  const receivedAt = new Date('2026-10-31T12:00:00.000Z')
  const floor = new Date('2026-10-31T11:00:00.000Z') // 1 hour before receivedAt

  test('returns receivedAt minus tapAgeMs when within bounds', () => {
    // 30 seconds age
    const tapAgeMs = 30 * 1000
    const result = occurredAtForTap({ receivedAt, tapAgeMs, floor })

    expect(result).toEqual(new Date('2026-10-31T11:59:30.000Z'))
  })

  test('never earlier than floor: clamps to floor when tapAgeMs reaches before floor', () => {
    // 2 hours age (older than floor of 1 hour ago)
    const tapAgeMs = 2 * 60 * 60 * 1000
    const result = occurredAtForTap({ receivedAt, tapAgeMs, floor })

    expect(result).toEqual(floor)
  })

  test('never later than receivedAt: clamps to receivedAt when tapAgeMs is negative', () => {
    // Negative age would compute a time in the future
    const tapAgeMs = -5000
    const result = occurredAtForTap({ receivedAt, tapAgeMs, floor })

    expect(result).toEqual(receivedAt)
  })

  test('never later than receivedAt even if floor is after receivedAt', () => {
    // Pathological case: floor in the future relative to receivedAt
    const futureFloor = new Date('2026-10-31T12:05:00.000Z')
    const tapAgeMs = 10 * 1000
    const result = occurredAtForTap({ receivedAt, tapAgeMs, floor: futureFloor })

    expect(result).toEqual(receivedAt)
  })

  test('tapAgeMs of 0 returns exact receivedAt', () => {
    const result = occurredAtForTap({ receivedAt, tapAgeMs: 0, floor })

    expect(result).toEqual(receivedAt)
  })

  test('constants pin spec 0009 constraints', () => {
    // 7 days in milliseconds
    expect(MAX_TAP_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000)
    expect(MAX_TAP_AGE_MS).toBe(604800000)

    // Job step events that bound the next step's tap time from below
    expect(TAP_FLOOR_EVENT_TYPES).toEqual([
      EnumDeliveryEventType.ACCEPTED,
      EnumDeliveryEventType.DISPATCHED,
      EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
      EnumDeliveryEventType.PICKED_UP,
      EnumDeliveryEventType.ON_THE_WAY,
      EnumDeliveryEventType.ARRIVED_AT_DROPOFF_LOCATION,
    ])
  })
})
