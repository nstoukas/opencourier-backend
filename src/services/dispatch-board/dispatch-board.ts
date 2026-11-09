import { EnumCourierStatus, EnumDeliveryIssueReason, EnumDeliveryStatus } from '@prisma/types'
import { DISPATCH_ATTENTION_ROW_LIMIT, INSTANCE_TIMEZONE } from 'src/constants'
import { dayjs } from 'src/core/utils/time'
import { median } from 'src/domains/partner/wait-record'
import { DeliveryOfferView } from 'src/domains/delivery/types/delivery-offer-view.type'
import {
  DeliveredToday,
  LiveDelivery,
  WorkingCourier,
} from 'src/persistence/repositories/dispatch-board.repository'
import { OpenDeliveryIssue } from 'src/persistence/repositories/delivery-issue.repository'
import { SosIncidentWithPeople } from 'src/persistence/repositories/sos-incident.repository'
import { DELIVERY_ISSUE_REASON_TO_HUMAN } from 'src/shared-types'

// Spec 0034. Plain functions, so each rule of the board can be tested on its own. A row's kind
// depends only on the state of the delivery, the report or the SOS, never on how long a rider has
// spent on anything in their own hands (AC-10), and no figure here is per rider.

const TO_PICKUP: EnumDeliveryStatus[] = [
  EnumDeliveryStatus.ACCEPTED,
  EnumDeliveryStatus.DISPATCHED,
  EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
]
const TO_DROPOFF: EnumDeliveryStatus[] = [
  EnumDeliveryStatus.PICKED_UP,
  EnumDeliveryStatus.ON_THE_WAY,
  EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
]

const MINUTE_MS = 60_000

export const ATTENTION_KIND = {
  SOS: 'SOS',
  WAITING_FOR_RIDER: 'WAITING_FOR_RIDER',
  OFFER_UNANSWERED: 'OFFER_UNANSWERED',
  RESTAURANT_LATE: 'RESTAURANT_LATE',
  RIDER_REPORT: 'RIDER_REPORT',
} as const

export type AttentionRow = {
  id: string
  // A plain string, not a closed union: rows 24 and 111 add kinds (spec 0034's contract).
  kind: string
  // Null means the page shows no minutes: an offer with its deadline running (AC-5).
  since: Date | null
  // Sorting only, never sent: an offer's place in the list must not need its time on the wire.
  sortAt: Date
  deliveryId: string | null
  sosId: string | null
  issueId: string | null
  threadId: string | null
  status: EnumDeliveryStatus | null
  courierId: string | null
  orderReference: string | null
  restaurantName: string | null
  riderName: string | null
  customerLabel: string | null
  detail: string
  held: boolean
}

export type DispatchBoardCards = {
  active: { total: number; toPickup: number; toDropoff: number }
  waiting: { total: number; oldestWaitingMinutes: number | null }
  couriers: { total: number; busy: number; free: number; lastCall: number }
  deliveredToday: { total: number; medianMinutes: number | null }
}

export type DispatchMapCourier = {
  id: string
  name: string
  latitude: number
  longitude: number
  state: 'FREE' | 'BUSY'
  carrying: { deliveryId: string; orderReference: string | null; offered: boolean }[]
}

export type DispatchMapWaitingDelivery = {
  deliveryId: string
  orderReference: string | null
  latitude: number
  longitude: number
}

export type DispatchMap = { couriers: DispatchMapCourier[]; waitingDeliveries: DispatchMapWaitingDelivery[] }

function clock(date: Date): string {
  return dayjs(date).tz(INSTANCE_TIMEZONE).format('HH:mm')
}

function isLooking(delivery: LiveDelivery): boolean {
  return delivery.status === EnumDeliveryStatus.ASSIGNING_COURIER && !delivery.courierId
}

function isCarried(delivery: LiveDelivery): boolean {
  return TO_PICKUP.includes(delivery.status) || TO_DROPOFF.includes(delivery.status)
}

function riderNameOf(delivery: LiveDelivery): string | null {
  return delivery.courier ? `${delivery.courier.firstName} ${delivery.courier.lastName}`.trim() : null
}

// The fields every row about a delivery shares.
function deliveryFields(delivery: {
  status: EnumDeliveryStatus
  courierId: string | null
  orderReference: string | null
  pickupBusinessName: string
  dropoffName: string
  dropoffBusinessName: string | null
}) {
  return {
    status: delivery.status,
    courierId: delivery.courierId,
    orderReference: delivery.orderReference,
    restaurantName: delivery.pickupBusinessName,
    customerLabel: delivery.dropoffBusinessName ?? delivery.dropoffName,
  }
}

const NO_SOURCE_IDS = { sosId: null, issueId: null, threadId: null }

export function buildCards(
  live: LiveDelivery[],
  couriers: WorkingCourier[],
  delivered: DeliveredToday[],
  now: Date
): DispatchBoardCards {
  const toPickup = live.filter((d) => TO_PICKUP.includes(d.status)).length
  const toDropoff = live.filter((d) => TO_DROPOFF.includes(d.status)).length
  const waiting = live.filter(isLooking)
  const oldest = waiting.reduce<Date | null>(
    (soonest, d) => (soonest === null || d.createdAt < soonest ? d.createdAt : soonest),
    null
  )
  const online = couriers.filter((c) => c.status === EnumCourierStatus.ONLINE)
  const busy = online.filter((c) => c.busy).length
  const lastCall = couriers.filter((c) => c.status === EnumCourierStatus.LAST_CALL).length
  const doorToDoor = delivered.map((d) => (d.occurredAt.getTime() - d.createdAt.getTime()) / MINUTE_MS)

  return {
    active: { total: toPickup + toDropoff, toPickup, toDropoff },
    waiting: {
      total: waiting.length,
      oldestWaitingMinutes: oldest === null ? null : Math.floor((now.getTime() - oldest.getTime()) / MINUTE_MS),
    },
    couriers: { total: online.length + lastCall, busy, free: online.length - busy, lastCall },
    deliveredToday: {
      total: delivered.length,
      medianMinutes: doorToDoor.length === 0 ? null : Math.round(median(doorToDoor)),
    },
  }
}

// AC-4. Nobody is offered this delivery. A held one (specs 0031 and 0033) stays listed and says why.
export function waitingForRiderRows(
  live: LiveDelivery[],
  offerViews: Map<string, DeliveryOfferView>,
  offerTimingEnabled: boolean,
  now: Date
): AttentionRow[] {
  return live
    .filter((d) => isLooking(d) && !d.matchedCourierId)
    .map((delivery) => {
      const waitingSince = offerViews.get(delivery.id)?.waitingForCourierSince ?? null
      const readyTime = delivery.foodReadyAt ?? delivery.readyAt
      const held =
        waitingSince === null &&
        (delivery.undispatchedAt !== null || offerTimingEnabled) &&
        readyTime !== null &&
        readyTime > now
      const since = waitingSince ?? delivery.createdAt
      return {
        id: `${ATTENTION_KIND.WAITING_FOR_RIDER}:${delivery.id}`,
        kind: ATTENTION_KIND.WAITING_FOR_RIDER,
        since,
        sortAt: since,
        deliveryId: delivery.id,
        ...NO_SOURCE_IDS,
        ...deliveryFields(delivery),
        riderName: null,
        detail: held && readyTime ? `Not offered yet, food ready ${clock(readyTime)}` : 'No courier accepted',
        held,
      }
    })
}

// AC-5. An offer with its deadline running sends no time at all, so a normal offer never shows a
// rider's response time. Only an offer that never expires, usually a dead phone, shows its minutes.
export function offerUnansweredRows(
  live: LiveDelivery[],
  offerViews: Map<string, DeliveryOfferView>
): AttentionRow[] {
  return live
    .filter((d) => isLooking(d) && d.matchedCourierId)
    .map((delivery) => {
      const offeredAt = delivery.offeredAt ?? delivery.createdAt
      const name = offerViews.get(delivery.id)?.matchedCourierName ?? null
      return {
        id: `${ATTENTION_KIND.OFFER_UNANSWERED}:${delivery.id}`,
        kind: ATTENTION_KIND.OFFER_UNANSWERED,
        since: delivery.offerExpiresAt === null ? offeredAt : null,
        sortAt: offeredAt,
        deliveryId: delivery.id,
        ...NO_SOURCE_IDS,
        ...deliveryFields(delivery),
        riderName: name,
        detail: `Offered to ${name ?? 'a courier'}, unanswered`,
        held: false,
      }
    })
}

// AC-6. The rider is at the restaurant, the food is not marked ready and the promised time has gone.
export function restaurantLateRows(live: LiveDelivery[], now: Date): AttentionRow[] {
  const late: AttentionRow[] = []
  for (const delivery of live) {
    const promised = delivery.promisedReadyAt
    if (
      delivery.status !== EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION ||
      delivery.foodReadyAt !== null ||
      promised === null ||
      promised >= now
    ) {
      continue
    }
    const riderName = riderNameOf(delivery)
    late.push({
      id: `${ATTENTION_KIND.RESTAURANT_LATE}:${delivery.id}`,
      kind: ATTENTION_KIND.RESTAURANT_LATE,
      since: promised,
      sortAt: promised,
      deliveryId: delivery.id,
      ...NO_SOURCE_IDS,
      ...deliveryFields(delivery),
      riderName,
      detail: `${riderName ?? 'A courier'} waiting at ${delivery.pickupBusinessName}, food was due ${clock(promised)}`,
      held: false,
    })
  }
  return late
}

function reasonWords(reason: EnumDeliveryIssueReason): string {
  return DELIVERY_ISSUE_REASON_TO_HUMAN[reason]
}

// AC-7. A report nobody has handled, whatever the delivery's status. The note is the second line.
export function riderReportRows(issues: OpenDeliveryIssue[]): AttentionRow[] {
  return issues.map((issue) => {
    const riderName = `${issue.courier.firstName} ${issue.courier.lastName}`.trim()
    const headline = `${riderName} reported: ${reasonWords(issue.reason)}`
    return {
      id: `${ATTENTION_KIND.RIDER_REPORT}:${issue.id}`,
      kind: ATTENTION_KIND.RIDER_REPORT,
      since: issue.createdAt,
      sortAt: issue.createdAt,
      deliveryId: issue.deliveryId,
      sosId: null,
      issueId: issue.id,
      threadId: null,
      ...deliveryFields(issue.delivery),
      riderName,
      detail: issue.note ? `${headline}\n${issue.note}` : headline,
      held: false,
    }
  })
}

// AC-8. Every incident active or awaiting close. No position on the row.
export function sosRows(incidents: SosIncidentWithPeople[]): AttentionRow[] {
  return incidents.map((incident) => {
    const riderName = `${incident.courier.firstName} ${incident.courier.lastName}`.trim()
    return {
      id: `${ATTENTION_KIND.SOS}:${incident.id}`,
      kind: ATTENTION_KIND.SOS,
      since: incident.startedAt,
      sortAt: incident.startedAt,
      deliveryId: incident.deliveryId,
      sosId: incident.id,
      issueId: null,
      threadId: null,
      status: null,
      courierId: incident.courierId,
      orderReference: null,
      restaurantName: null,
      riderName,
      customerLabel: null,
      detail: `${riderName}, SOS`,
      held: false,
    }
  })
}

// AC-3: SOS first, then every other row, each group oldest first, cut at the limit.
export function orderAttentionRows(rows: AttentionRow[]): { attention: AttentionRow[]; attentionMore: number } {
  const byOldest = (a: AttentionRow, b: AttentionRow) =>
    a.sortAt.getTime() - b.sortAt.getTime() || a.id.localeCompare(b.id)
  const sos = rows.filter((r) => r.kind === ATTENTION_KIND.SOS).sort(byOldest)
  const others = rows.filter((r) => r.kind !== ATTENTION_KIND.SOS).sort(byOldest)
  const ordered = [...sos, ...others]
  return {
    attention: ordered.slice(0, DISPATCH_ATTENTION_ROW_LIMIT),
    attentionMore: Math.max(0, ordered.length - DISPATCH_ATTENTION_ROW_LIMIT),
  }
}

// AC-11 to AC-13. Only the latest position of a working rider with a fresh fix, and no age or history.
export function buildMap(live: LiveDelivery[], couriers: WorkingCourier[]): DispatchMap {
  const carryingOf = (courierId: string) =>
    live.flatMap((d) => {
      if (isCarried(d) && d.courierId === courierId) {
        return [{ deliveryId: d.id, orderReference: d.orderReference, offered: false }]
      }
      if (isLooking(d) && d.matchedCourierId === courierId) {
        return [{ deliveryId: d.id, orderReference: d.orderReference, offered: true }]
      }
      return []
    })

  const mapCouriers: DispatchMapCourier[] = []
  for (const courier of couriers) {
    if (courier.latitude === null || courier.longitude === null) continue
    const carrying = carryingOf(courier.id)
    // A Last Call rider is on the map only while still carrying something (AC-11).
    if (courier.status === EnumCourierStatus.LAST_CALL && !carrying.some((c) => !c.offered)) continue
    mapCouriers.push({
      id: courier.id,
      name: courier.name,
      latitude: courier.latitude,
      longitude: courier.longitude,
      state: courier.status === EnumCourierStatus.LAST_CALL || courier.busy ? 'BUSY' : 'FREE',
      carrying,
    })
  }

  const waitingDeliveries: DispatchMapWaitingDelivery[] = []
  for (const delivery of live) {
    if (!isLooking(delivery) || !delivery.pickupLocation) continue
    waitingDeliveries.push({
      deliveryId: delivery.id,
      orderReference: delivery.orderReference,
      latitude: delivery.pickupLocation.latitude,
      longitude: delivery.pickupLocation.longitude,
    })
  }

  return { couriers: mapCouriers, waitingDeliveries }
}

// The first and last instant of the day `now` falls on, in the co-op's own time zone (AC-2).
export function todayBounds(now: Date): { start: Date; end: Date } {
  const start = dayjs(now).tz(INSTANCE_TIMEZONE).startOf('day')
  return { start: start.toDate(), end: start.add(1, 'day').toDate() }
}
