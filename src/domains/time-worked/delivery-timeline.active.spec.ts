import {
  EnumTimelineWho,
  TimelineEvent,
  TimelineHold,
  buildTimeline,
} from './delivery-timeline'
import { EnumDeliveryEventType, EnumEventActor } from '@prisma/types'

describe('Delivery Timeline (spec 0042 AC-11, decisions 75.7, 75.27, 75.32)', () => {
  const thisCourierId = 'courier-me'
  const otherCourierId = 'courier-other'

  function makeEvent(
    type: EnumDeliveryEventType,
    actor: EnumEventActor,
    courierId: string | null,
    occurredAtIso: string,
    createdAtIso = occurredAtIso
  ): TimelineEvent {
    return {
      type,
      actor,
      courierId,
      occurredAt: new Date(occurredAtIso),
      createdAt: new Date(createdAtIso),
    }
  }

  test('an event naming this rider is shown with who from the actor (COURIER is YOU, PARTNER is RESTAURANT, ADMIN is DISPATCH, SYSTEM is SYSTEM)', () => {
    const events: TimelineEvent[] = [
      makeEvent(
        EnumDeliveryEventType.ACCEPTED,
        EnumEventActor.COURIER,
        thisCourierId,
        '2026-11-20T10:00:00Z'
      ),
      makeEvent(
        EnumDeliveryEventType.COURIER_PAID_FOR_WAIT,
        EnumEventActor.SYSTEM,
        thisCourierId,
        '2026-11-20T10:15:00Z'
      ),
      makeEvent(
        EnumDeliveryEventType.REMOVAL_APPROVED,
        EnumEventActor.ADMIN,
        thisCourierId,
        '2026-11-20T10:20:00Z'
      ),
      makeEvent(
        EnumDeliveryEventType.FOOD_READY,
        EnumEventActor.PARTNER,
        thisCourierId,
        '2026-11-20T10:05:00Z'
      ),
    ]

    const holds: TimelineHold[] = [
      {
        acceptCreatedAt: new Date('2026-11-20T10:00:00Z').getTime(),
        endCreatedAt: new Date('2026-11-20T10:20:00Z').getTime(),
      },
    ]

    const timeline = buildTimeline(thisCourierId, events, holds)

    expect(timeline).toHaveLength(4)

    // Check mapping of actors to who
    const acceptLine = timeline.find((l) => l.type === EnumDeliveryEventType.ACCEPTED)!
    expect(acceptLine.who).toBe(EnumTimelineWho.YOU)
    expect(acceptLine.anotherRider).toBe(false)

    const partnerLine = timeline.find((l) => l.type === EnumDeliveryEventType.FOOD_READY)!
    expect(partnerLine.who).toBe(EnumTimelineWho.RESTAURANT)
    expect(partnerLine.anotherRider).toBe(false)

    const waitPayLine = timeline.find((l) => l.type === EnumDeliveryEventType.COURIER_PAID_FOR_WAIT)!
    expect(waitPayLine.who).toBe(EnumTimelineWho.SYSTEM)
    expect(waitPayLine.anotherRider).toBe(false)

    const removalLine = timeline.find((l) => l.type === EnumDeliveryEventType.REMOVAL_APPROVED)!
    expect(removalLine.who).toBe(EnumTimelineWho.DISPATCH)
    expect(removalLine.anotherRider).toBe(false)
  })

  test("another rider's ACCEPTED is one line with who null and anotherRider true, and no other event naming another rider is shown", () => {
    const events: TimelineEvent[] = [
      // Another rider accepted first, then dropped off
      makeEvent(
        EnumDeliveryEventType.ACCEPTED,
        EnumEventActor.COURIER,
        otherCourierId,
        '2026-11-20T08:00:00Z'
      ),
      makeEvent(
        EnumDeliveryEventType.PICKED_UP,
        EnumEventActor.COURIER,
        otherCourierId,
        '2026-11-20T08:10:00Z'
      ),
      makeEvent(
        EnumDeliveryEventType.DROPPED_OFF,
        EnumEventActor.COURIER,
        otherCourierId,
        '2026-11-20T08:30:00Z'
      ),
      // This rider accepted later
      makeEvent(
        EnumDeliveryEventType.ACCEPTED,
        EnumEventActor.COURIER,
        thisCourierId,
        '2026-11-20T10:00:00Z'
      ),
    ]

    const holds: TimelineHold[] = [
      {
        acceptCreatedAt: new Date('2026-11-20T10:00:00Z').getTime(),
        endCreatedAt: null,
      },
    ]

    const timeline = buildTimeline(thisCourierId, events, holds)

    // Should only have 2 lines: the other rider's ACCEPTED and this rider's ACCEPTED
    // The other rider's PICKED_UP and DROPPED_OFF must be hidden!
    expect(timeline).toHaveLength(2)

    const otherAccept = timeline[0]!
    expect(otherAccept.type).toBe(EnumDeliveryEventType.ACCEPTED)
    expect(otherAccept.who).toBeNull()
    expect(otherAccept.anotherRider).toBe(true)

    const myAccept = timeline[1]!
    expect(myAccept.type).toBe(EnumDeliveryEventType.ACCEPTED)
    expect(myAccept.who).toBe(EnumTimelineWho.YOU)
    expect(myAccept.anotherRider).toBe(false)
  })

  test('an ACCEPTED with null courierId is shown with who null and anotherRider false', () => {
    const events: TimelineEvent[] = [
      makeEvent(
        EnumDeliveryEventType.ACCEPTED,
        EnumEventActor.COURIER,
        null, // No courier stored (historical row)
        '2026-11-20T09:00:00Z'
      ),
      makeEvent(
        EnumDeliveryEventType.ACCEPTED,
        EnumEventActor.COURIER,
        thisCourierId,
        '2026-11-20T10:00:00Z'
      ),
    ]

    const holds: TimelineHold[] = [
      {
        acceptCreatedAt: new Date('2026-11-20T10:00:00Z').getTime(),
        endCreatedAt: null,
      },
    ]

    const timeline = buildTimeline(thisCourierId, events, holds)

    expect(timeline).toHaveLength(2)

    const nullCourierAccept = timeline[0]!
    expect(nullCourierAccept.type).toBe(EnumDeliveryEventType.ACCEPTED)
    expect(nullCourierAccept.who).toBeNull()
    expect(nullCourierAccept.anotherRider).toBe(false)
  })

  test('any other event is shown only if its createdAt falls inside one of the rider holds (inclusive)', () => {
    // Hold 1: 10:00:00 to 10:30:00
    // Hold 2: 12:00:00 to 12:45:00
    const holds: TimelineHold[] = [
      {
        acceptCreatedAt: new Date('2026-11-20T10:00:00Z').getTime(),
        endCreatedAt: new Date('2026-11-20T10:30:00Z').getTime(),
      },
      {
        acceptCreatedAt: new Date('2026-11-20T12:00:00Z').getTime(),
        endCreatedAt: new Date('2026-11-20T12:45:00Z').getTime(),
      },
    ]

    const events: TimelineEvent[] = [
      // 1. Before Hold 1: Partner ready signal at 09:50 -> should be hidden
      makeEvent(
        EnumDeliveryEventType.FOOD_READY,
        EnumEventActor.PARTNER,
        null,
        '2026-11-20T09:50:00Z'
      ),
      // 2. Inside Hold 1: Rider step (ARRIVED) at 10:10 -> shown as YOU
      makeEvent(
        EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
        EnumEventActor.COURIER,
        null,
        '2026-11-20T10:10:00Z'
      ),
      // 3. Exactly at Hold 1 boundary (10:30:00) -> shown
      makeEvent(
        EnumDeliveryEventType.HANDED_BACK,
        EnumEventActor.COURIER,
        null,
        '2026-11-20T10:30:00Z'
      ),
      // 4. Between Hold 1 and Hold 2 (11:15:00) -> hidden
      makeEvent(
        EnumDeliveryEventType.FOOD_READY,
        EnumEventActor.PARTNER,
        null,
        '2026-11-20T11:15:00Z'
      ),
      // 5. Inside Hold 2: Partner ready at 12:10 -> shown as RESTAURANT
      makeEvent(
        EnumDeliveryEventType.FOOD_READY,
        EnumEventActor.PARTNER,
        null,
        '2026-11-20T12:10:00Z'
      ),
      // 6. After Hold 2: Cancel at 13:00:00 -> hidden
      makeEvent(
        EnumDeliveryEventType.CANCELED,
        EnumEventActor.ADMIN,
        null,
        '2026-11-20T13:00:00Z'
      ),
    ]

    const timeline = buildTimeline(thisCourierId, events, holds)

    // Expected shown: events 2, 3, 5
    expect(timeline).toHaveLength(3)

    expect(timeline[0]!.type).toBe(EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION)
    expect(timeline[0]!.who).toBe(EnumTimelineWho.YOU)

    expect(timeline[1]!.type).toBe(EnumDeliveryEventType.HANDED_BACK)
    expect(timeline[1]!.who).toBe(EnumTimelineWho.YOU)

    expect(timeline[2]!.type).toBe(EnumDeliveryEventType.FOOD_READY)
    expect(timeline[2]!.who).toBe(EnumTimelineWho.RESTAURANT)
  })

  test('timeline lines are strictly ordered by occurredAt (at)', () => {
    // Arrival occurredAt 10:15 but createdAt 10:25 (delayed tap arrival)
    // Ready occurredAt 10:20 and createdAt 10:20
    // In occurredAt order: Arrival (10:15) must come before Ready (10:20)
    const holds: TimelineHold[] = [
      {
        acceptCreatedAt: new Date('2026-11-20T10:00:00Z').getTime(),
        endCreatedAt: new Date('2026-11-20T10:40:00Z').getTime(),
      },
    ]

    const events: TimelineEvent[] = [
      makeEvent(
        EnumDeliveryEventType.FOOD_READY,
        EnumEventActor.PARTNER,
        null,
        '2026-11-20T10:20:00Z',
        '2026-11-20T10:20:00Z'
      ),
      makeEvent(
        EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
        EnumEventActor.COURIER,
        null,
        '2026-11-20T10:15:00Z',
        '2026-11-20T10:25:00Z'
      ),
    ]

    const timeline = buildTimeline(thisCourierId, events, holds)

    expect(timeline).toHaveLength(2)
    expect(timeline[0]!.type).toBe(EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION)
    expect(timeline[0]!.at).toEqual(new Date('2026-11-20T10:15:00Z'))
    expect(timeline[1]!.type).toBe(EnumDeliveryEventType.FOOD_READY)
    expect(timeline[1]!.at).toEqual(new Date('2026-11-20T10:20:00Z'))
  })
})
