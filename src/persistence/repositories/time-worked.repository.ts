import { Injectable } from '@nestjs/common'
import { EnumCourierStatus, EnumDeliveryEventType, Prisma } from '@prisma/types'
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
            },
          })
    const deliveries = deliveryRows.map((d) => ({
      id: d.id,
      status: d.status,
      courierId: d.courierId,
      totalCompensation: d.totalCompensation,
      tips: d.tips,
      pickupName: d.pickupBusinessName,
    }))

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
}
