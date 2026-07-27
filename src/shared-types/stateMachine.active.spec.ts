import { EnumDeliveryStatus, EnumDeliveryEventType } from '@prisma/types'
import { STATE_MACHINE, DELIVERY_ONGOING_STATUSES } from './stateMachine'

describe('stateMachine', () => {
  // Test Plan Case 1: Equivalence between DELIVERY_ONGOING_STATUSES and REASSIGNED transition in STATE_MACHINE
  test('allows REASSIGNED transition to ASSIGNING_COURIER if and only if status is in DELIVERY_ONGOING_STATUSES', () => {
    const allStatuses = Object.values(EnumDeliveryStatus)

    for (const status of allStatuses) {
      const transition = STATE_MACHINE[status]?.on?.[EnumDeliveryEventType.REASSIGNED]
      const isOngoing = DELIVERY_ONGOING_STATUSES.includes(status)

      if (isOngoing) {
        // Ongoing status must transition to ASSIGNING_COURIER on REASSIGNED
        expect(transition).toBe(EnumDeliveryStatus.ASSIGNING_COURIER)
      } else {
        // Non-ongoing status must NOT have a REASSIGNED transition
        expect(transition).toBeUndefined()
      }
    }
  })

  // Test Plan Case 2: Terminal statuses remain terminal
  test('ensures terminal statuses DROPPED_OFF and FAILED have empty transition maps', () => {
    // DROPPED_OFF is terminal and should accept no new event transitions
    expect(STATE_MACHINE[EnumDeliveryStatus.DROPPED_OFF].on).toEqual({})

    // FAILED is terminal and should accept no new event transitions
    expect(STATE_MACHINE[EnumDeliveryStatus.FAILED].on).toEqual({})
  })

  // Test Plan Case 3: Specific non-ongoing statuses have no REASSIGNED transition
  test('explicitly verifies CREATED, ASSIGNING_COURIER, and CANCELED have no REASSIGNED transition', () => {
    expect(STATE_MACHINE[EnumDeliveryStatus.CREATED].on[EnumDeliveryEventType.REASSIGNED]).toBeUndefined()
    expect(STATE_MACHINE[EnumDeliveryStatus.ASSIGNING_COURIER].on[EnumDeliveryEventType.REASSIGNED]).toBeUndefined()
    expect(STATE_MACHINE[EnumDeliveryStatus.CANCELED].on[EnumDeliveryEventType.REASSIGNED]).toBeUndefined()
  })
})
