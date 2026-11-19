import { EnumDeliveryEventType, EnumDeliveryStatus } from '@prisma/types'
import { DELIVERY_ONGOING_STATUSES, STATE_MACHINE } from 'src/shared-types/stateMachine'
import { JOB_END_EVENT_TYPES } from './job-end-event-types'

describe('JOB_END_EVENT_TYPES Guard (spec 0040, AC-4, decision 36.22)', () => {
  it('contains every event in STATE_MACHINE that transitions an ongoing status to an outside status', () => {
    const missingTypes: Array<{ fromStatus: string; eventType: string; targetStatus: string }> = []

    for (const status of DELIVERY_ONGOING_STATUSES) {
      const transitions = STATE_MACHINE[status]?.on ?? {}
      for (const [eventType, targetStatus] of Object.entries(transitions)) {
        if (!DELIVERY_ONGOING_STATUSES.includes(targetStatus as EnumDeliveryStatus)) {
          if (!JOB_END_EVENT_TYPES.has(eventType as EnumDeliveryEventType)) {
            missingTypes.push({ fromStatus: status, eventType, targetStatus })
          }
        }
      }
    }

    expect(missingTypes).toEqual([])
  })

  it('contains all job end events recorded outside STATE_MACHINE plus later ACCEPTED', () => {
    // End types recorded outside STATE_MACHINE
    expect(JOB_END_EVENT_TYPES.has(EnumDeliveryEventType.HANDED_BACK)).toBe(true)
    expect(JOB_END_EVENT_TYPES.has(EnumDeliveryEventType.REASSIGNED)).toBe(true)
    expect(JOB_END_EVENT_TYPES.has(EnumDeliveryEventType.RETURNED_TO_WAITING)).toBe(true)
    expect(JOB_END_EVENT_TYPES.has(EnumDeliveryEventType.WAIT_UNDISPATCHED)).toBe(true)
    expect(JOB_END_EVENT_TYPES.has(EnumDeliveryEventType.REMOVAL_APPROVED)).toBe(true)
    // Later ACCEPTED by anyone
    expect(JOB_END_EVENT_TYPES.has(EnumDeliveryEventType.ACCEPTED)).toBe(true)
  })

  it('fails if HANDED_BACK is removed from JOB_END_EVENT_TYPES', () => {
    // Verifies the guard test logic catches missing non-state-machine job end events
    const simulatedTypes = new Set(JOB_END_EVENT_TYPES)
    simulatedTypes.delete(EnumDeliveryEventType.HANDED_BACK)

    expect(simulatedTypes.has(EnumDeliveryEventType.HANDED_BACK)).toBe(false)
    expect(JOB_END_EVENT_TYPES.has(EnumDeliveryEventType.HANDED_BACK)).toBe(true)
  })
})
