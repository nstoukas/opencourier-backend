import { Injectable } from '@nestjs/common'
import {
  EnumCourierStatus,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumDistanceUnit,
  EnumEventActor,
  Prisma,
} from '@prisma/types'
import { dropoffAreaOf } from 'src/domains/delivery/offer-card-payload'
import { convertToKM } from 'src/shared-types/distance-unit'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types/stateMachine'
import { CompensationRow, JobDeliveryRow, JobEventRow, StatusChangeRow } from 'src/domains/time-worked/worked-shifts'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

// Everything time worked reads (spec 0040), for one rider or, with no rider id, for every rider (the
// co-op totals only, which never return a rider id). Read only: nothing here writes.
export interface TimeWorkedRecords {
  statusChanges: Array<StatusChangeRow & { courierId: string }>
  // Each rider's status at the window's start (the last change before it); a rider not listed was Offline.
  statusBefore: Map<string, EnumCourierStatus>
  // Which deliveries each rider accepted inside the window, or still holds.
  acceptedDeliveries: Map<string, Set<string>>
  events: JobEventRow[]
  deliveries: JobDeliveryRow[]
  compensations: Array<CompensationRow & { courierId: string }>
  // `<courierId>:<deliveryId>` for every delivery a rider ever accepted with a recorded rider.
  everAccepted: Set<string>
}

// Spec 0042: one event of a delivery for the rider's timeline; it also pairs the rider's holds, so it
// carries what pairJobs reads. `message` is never read (AC-11).
export interface TimelineEventRow extends JobEventRow {
  actor: EnumEventActor
}

// Spec 0042 (AC-10): what a job's pay breakdown reads from its delivery and quote.
export interface DeliveryPayRow {
  id: string
  // Read only to tell whether the rider still holds it (pairJobs); never sent.
  status: EnumDeliveryStatus
  courierId: string | null
  totalCompensation: number | null
  tips: number
  pickupName: string
  baseFee: number
  distanceFee: number
  paidKm: number
  dropoffArea: string | null
}

// The street when the house number is kept apart from it, else the town (spec 0042 AC-12); the
// house number itself never leaves this file.
function areaOf(location: { street: string | null; houseNumber: string | null; city: string | null } | null) {
  const area = dropoffAreaOf(location)
  return area === '' ? null : area
}

function paidKmOf(quote: { distance: number; distanceUnit: EnumDistanceUnit }): number {
  return convertToKM(quote.distance, quote.distanceUnit)
}

@Injectable()
export class TimeWorkedRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  // When recording began for the instance: the oldest status change (AC-11). Null when there is none.
  async findRecordedFrom(): Promise<Date | null> {
    const result = await this.prisma.courierStatusChange.aggregate({ _min: { createdAt: true } })
    return result._min.createdAt
  }

  // `courierId` undefined means every rider. `withAdminLabels` adds the admin's email, else username, on
  // admin caused changes (AC-15); the rider's own view never asks for it.
  async findRecords(args: {
    courierId?: string
    windowStart: Date
    windowEnd: Date
    rangeStart: Date
    rangeEnd: Date
    withAdminLabels: boolean
    // Spec 0042: each delivery's paid km and drop off area. Left out of the co-op totals.
    withJobDetails?: boolean
  }): Promise<TimeWorkedRecords> {
    const { courierId, windowStart, windowEnd, rangeStart, rangeEnd } = args

    const changes = await this.prisma.courierStatusChange.findMany({
      where: { ...(courierId ? { courierId } : {}), createdAt: { gte: windowStart, lte: windowEnd } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: args.withAdminLabels ? { adminUser: { select: { email: true, username: true } } } : undefined,
    })
    const statusChanges = changes.map((c) => {
      // `include` widens the row type only when it is set, so the admin is read through a narrow cast.
      const admin = (c as { adminUser?: { email: string | null; username: string | null } | null }).adminUser
      return {
        id: c.id,
        courierId: c.courierId,
        createdAt: c.createdAt,
        fromStatus: c.fromStatus,
        toStatus: c.toStatus,
        cause: c.cause,
        adminUserId: c.adminUserId,
        ...(args.withAdminLabels ? { adminLabel: c.adminUserId ? admin?.email ?? admin?.username ?? null : null } : {}),
      }
    })

    // The newest change before the window, per rider: DISTINCT ON keeps the first row of each rider in
    // the ORDER BY, done in the database (Prisma 5.3's `distinct` would read every row into Node).
    const before = await this.prisma.$queryRaw<Array<{ courierId: string; toStatus: EnumCourierStatus }>>`
      SELECT DISTINCT ON ("courierId") "courierId", "toStatus"::text AS "toStatus"
      FROM "CourierStatusChange"
      WHERE "createdAt" < ${windowStart}
        ${courierId ? Prisma.sql`AND "courierId" = ${courierId}` : Prisma.empty}
      ORDER BY "courierId", "createdAt" DESC, "id" DESC
    `
    const statusBefore = new Map(before.map((row) => [row.courierId, row.toStatus]))

    // This rider's accepts inside the window, plus any delivery still ongoing (a job accepted earlier and
    // still held keeps the shift going).
    const accepts = await this.prisma.deliveryEvent.findMany({
      where: {
        type: EnumDeliveryEventType.ACCEPTED,
        transitionSuccessful: true,
        courierId: courierId ?? { not: null },
        OR: [
          { occurredAt: { gte: windowStart, lte: windowEnd } },
          { delivery: { status: { in: DELIVERY_ONGOING_STATUSES } } },
        ],
      },
      select: { courierId: true, deliveryId: true },
    })
    const acceptedDeliveries = new Map<string, Set<string>>()
    for (const a of accepts) {
      if (!a.courierId) continue
      const set = acceptedDeliveries.get(a.courierId) ?? new Set<string>()
      set.add(a.deliveryId)
      acceptedDeliveries.set(a.courierId, set)
    }
    const deliveryIds = [...new Set(accepts.map((a) => a.deliveryId))]

    const events =
      deliveryIds.length === 0
        ? []
        : await this.prisma.deliveryEvent.findMany({
            where: { deliveryId: { in: deliveryIds }, transitionSuccessful: true },
            select: {
              id: true,
              deliveryId: true,
              type: true,
              oldStatus: true,
              courierId: true,
              occurredAt: true,
              createdAt: true,
            },
          })

    const deliveryRows =
      deliveryIds.length === 0
        ? []
        : await this.prisma.delivery.findMany({
            where: { id: { in: deliveryIds } },
            select: {
              id: true,
              status: true,
              courierId: true,
              totalCompensation: true,
              tips: true,
              pickupBusinessName: true,
              // `delivery` is the quote's relation name on Delivery (the schema's naming).
              ...(args.withJobDetails
                ? {
                    delivery: { select: { distance: true, distanceUnit: true } },
                    dropoffLocation: { select: { street: true, houseNumber: true, city: true } },
                  }
                : {}),
            },
          })
    const deliveries = deliveryRows.map((d) => {
      // The nested selects widen the row type only when set, so they are read through a narrow cast.
      const extra = d as {
        delivery?: { distance: number; distanceUnit: EnumDistanceUnit }
        dropoffLocation?: { street: string | null; houseNumber: string | null; city: string | null } | null
      }
      return {
        id: d.id,
        status: d.status,
        courierId: d.courierId,
        totalCompensation: d.totalCompensation,
        tips: d.tips,
        pickupName: d.pickupBusinessName,
        ...(args.withJobDetails
          ? {
              paidKm: extra.delivery ? paidKmOf(extra.delivery) : null,
              dropoffArea: areaOf(extra.dropoffLocation ?? null),
            }
          : {}),
      }
    })

    // Every compensation for a delivery whose job is in the window, whatever its date (AC-6), and every
    // compensation written in the range (the unlinked ones, AC-7).
    const compensations = await this.prisma.courierCompensation.findMany({
      where: {
        ...(courierId ? { courierId } : {}),
        OR: [{ deliveryId: { in: deliveryIds } }, { createdAt: { gte: rangeStart, lt: rangeEnd } }],
      },
      select: {
        id: true,
        courierId: true,
        deliveryId: true,
        amount: true,
        currencyCode: true,
        reason: true,
        waitMinutes: true,
        createdAt: true,
      },
    })

    const compensationDeliveryIds = [...new Set(compensations.map((c) => c.deliveryId))]
    const everAcceptedRows =
      compensationDeliveryIds.length === 0
        ? []
        : await this.prisma.deliveryEvent.findMany({
            where: {
              type: EnumDeliveryEventType.ACCEPTED,
              transitionSuccessful: true,
              courierId: courierId ?? { not: null },
              deliveryId: { in: compensationDeliveryIds },
            },
            select: { courierId: true, deliveryId: true },
          })
    const everAccepted = new Set(everAcceptedRows.map((row) => `${row.courierId}:${row.deliveryId}`))

    return { statusChanges, statusBefore, acceptedDeliveries, events, deliveries, compensations, everAccepted }
  }

  // Spec 0042 (AC-17): when this rider accepted this delivery, oldest first (empty: never held it).
  async findAcceptTimes(courierId: string, deliveryId: string): Promise<Date[]> {
    const rows = await this.prisma.deliveryEvent.findMany({
      where: { deliveryId, courierId, type: EnumDeliveryEventType.ACCEPTED, transitionSuccessful: true },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { occurredAt: true },
    })
    return rows.map((row) => row.occurredAt)
  }

  // Spec 0042 (AC-10): the delivery's pay parts and where it went, without any address line.
  async findDeliveryPay(deliveryId: string): Promise<DeliveryPayRow | null> {
    const row = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        status: true,
        courierId: true,
        totalCompensation: true,
        tips: true,
        pickupBusinessName: true,
        delivery: { select: { baseFee: true, distanceFee: true, distance: true, distanceUnit: true } },
        dropoffLocation: { select: { street: true, houseNumber: true, city: true } },
      },
    })
    if (!row) return null
    return {
      id: row.id,
      status: row.status,
      courierId: row.courierId,
      totalCompensation: row.totalCompensation,
      tips: row.tips,
      pickupName: row.pickupBusinessName,
      baseFee: row.delivery.baseFee,
      distanceFee: row.delivery.distanceFee,
      paidKm: paidKmOf(row.delivery),
      dropoffArea: areaOf(row.dropoffLocation),
    }
  }

  // Spec 0042 (AC-11): every successful event on the delivery, for the timeline filter. No message.
  async findTimelineEvents(deliveryId: string): Promise<TimelineEventRow[]> {
    return this.prisma.deliveryEvent.findMany({
      where: { deliveryId, transitionSuccessful: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        deliveryId: true,
        type: true,
        oldStatus: true,
        actor: true,
        courierId: true,
        occurredAt: true,
        createdAt: true,
      },
    })
  }
}
