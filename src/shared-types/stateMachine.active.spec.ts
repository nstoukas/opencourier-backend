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

  // Test Plan Case 4: Scope row 62 - Busy riders get no second offer: shared definition pinning
  test('pins DELIVERY_ONGOING_STATUSES to exactly the six active statuses against EnumDeliveryStatus', () => {
    const expectedOngoingStatuses: EnumDeliveryStatus[] = [
      EnumDeliveryStatus.ACCEPTED,
      EnumDeliveryStatus.DISPATCHED,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.ON_THE_WAY,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
    ]

    const expectedNonOngoingStatuses: EnumDeliveryStatus[] = [
      EnumDeliveryStatus.CREATED,
      EnumDeliveryStatus.ASSIGNING_COURIER,
      EnumDeliveryStatus.DROPPED_OFF,
      EnumDeliveryStatus.CANCELED,
      EnumDeliveryStatus.FAILED,
    ]

    // 1. Must contain exactly the 6 active statuses
    expect([...DELIVERY_ONGOING_STATUSES].sort()).toEqual([...expectedOngoingStatuses].sort())
    expect(DELIVERY_ONGOING_STATUSES).toHaveLength(6)

    // 2. Finished, cancelled, and pre-assignment statuses must not be present
    for (const nonOngoingStatus of expectedNonOngoingStatuses) {
      expect(DELIVERY_ONGOING_STATUSES).not.toContain(nonOngoingStatus)
    }

    // 3. Complete partition of EnumDeliveryStatus: every status is accounted for with no overlap
    const allEnumStatuses = Object.values(EnumDeliveryStatus)
    const combined = [...expectedOngoingStatuses, ...expectedNonOngoingStatuses]
    expect(allEnumStatuses.sort()).toEqual(combined.sort())
  })
})
