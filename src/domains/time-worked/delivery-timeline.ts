import { EnumDeliveryEventType, EnumEventActor } from '@prisma/types'

// Spec 0042 (AC-11, decisions 75.7 and 75.27): which events of a delivery a rider sees on a job's
// timeline, and who acted, in fixed words. Pure: no database, no clock. It never returns an event's
// message, an amount, or another rider's id.

export enum EnumTimelineWho {
  YOU = 'YOU',
  RESTAURANT = 'RESTAURANT',
  DISPATCH = 'DISPATCH',
  SYSTEM = 'SYSTEM',
}

export interface TimelineEvent {
  type: EnumDeliveryEventType
  actor: EnumEventActor
  courierId: string | null
  occurredAt: Date
  createdAt: Date
}

// One stretch the rider held the delivery, in the order the server received events (createdAt), as
// pairJobs found it. endCreatedAt null: still held.
export interface TimelineHold {
  acceptCreatedAt: number
  endCreatedAt: number | null
}

export interface TimelineLine {
  type: EnumDeliveryEventType
  at: Date
  who: EnumTimelineWho | null
  // Another rider's accept, shown as one anonymous line ("Another rider took it"). Decision 75.32:
  // a flag, because an accept stored with no rider (before spec 0040) also has nobody named.
  anotherRider: boolean
}

const WHO_BY_ACTOR: Record<EnumEventActor, EnumTimelineWho> = {
  [EnumEventActor.COURIER]: EnumTimelineWho.YOU,
  [EnumEventActor.PARTNER]: EnumTimelineWho.RESTAURANT,
  [EnumEventActor.ADMIN]: EnumTimelineWho.DISPATCH,
  [EnumEventActor.SYSTEM]: EnumTimelineWho.SYSTEM,
}

function insideHold(event: TimelineEvent, holds: TimelineHold[]): boolean {
  const at = event.createdAt.getTime()
  return holds.some((h) => at >= h.acceptCreatedAt && (h.endCreatedAt === null || at <= h.endCreatedAt))
}

export function buildTimeline(courierId: string, events: TimelineEvent[], holds: TimelineHold[]): TimelineLine[] {
  const lines: TimelineLine[] = []
  for (const event of events) {
    const line = { type: event.type, at: event.occurredAt }
    if (event.courierId === courierId) {
      // An event that names this rider: their offer, accept, pay, removal, review, product report.
      lines.push({ ...line, who: WHO_BY_ACTOR[event.actor], anotherRider: false })
    } else if (event.courierId !== null) {
      // Another rider's event: only their accept shows, and never who they are.
      if (event.type === EnumDeliveryEventType.ACCEPTED) lines.push({ ...line, who: null, anotherRider: true })
    } else if (event.type === EnumDeliveryEventType.ACCEPTED) {
      // An accept stored before riders were recorded on it: "Accepted", nobody named.
      lines.push({ ...line, who: null, anotherRider: false })
    } else if (insideHold(event, holds)) {
      // Received while this rider held a job on it: their steps (which carry no rider id), the
      // restaurant's ready signals, a cancel, a hand back.
      lines.push({ ...line, who: WHO_BY_ACTOR[event.actor], anotherRider: false })
    }
  }
  return lines.sort((a, b) => a.at.getTime() - b.at.getTime())
}
