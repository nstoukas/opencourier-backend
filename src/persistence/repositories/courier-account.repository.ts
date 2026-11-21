import { Injectable } from '@nestjs/common'
import {
  CourierAccountChange,
  EnumCourierAccountChangeKind,
  EnumShiftBookingEventType,
  EnumShiftBookingStatus,
  EnumUserRole,
  Prisma,
} from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { activeSosCourierSubQuery, heldBoxDeliveriesWhere } from './courier.repository'

// One account change to write (spec 0051, AC-5). A password is never passed here, only that it changed.
export interface AccountChangeInput {
  courierId: string
  actorUserId: string | null
  actorIsRider: boolean
  kind: EnumCourierAccountChangeKind
  field?: string | null
  oldValue?: string | null
  newValue?: string | null
  reason?: string | null
}

export type DeactivateOutcome =
  | { outcome: 'DONE'; userId: string; droppedBookings: number }
  | { outcome: 'MISSING' | 'ALREADY' | 'IS_ADMIN' | 'IN_SOS' | 'HOLDS_JOB' }

export type ReactivateOutcome = { outcome: 'DONE'; userId: string } | { outcome: 'MISSING' | 'NOT_DEACTIVATED' }

// An account change as admins read it: the admin's email when an admin acted.
export type AccountChangeWithActor = CourierAccountChange & { actorEmail: string | null }

// Spec 0051 (row 108): deactivating and reactivating a rider, and the record of every account action.
// Each action runs in one transaction under the rider's row lock, the same lock every offer claim takes
// (claimForRiderWithinBox), so no offer or accept can slip between the checks and the writes.
@Injectable()
export class CourierAccountRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  // AC-1, cross checks 1, 4, 5, 6, 8: refuses while the rider is an admin, has an open SOS or holds a job
  // (an accepted delivery or a return trip; an open offer does not count, the cut off ends it). Then sets
  // the fields, ends every session (credentialsChangedAt), drops every BOOKED booking that has not ended
  // (one running now included) with a DROPPED event naming the admin, and records the change.
  async deactivate(courierId: string, adminUserId: string, reason: string, now: Date): Promise<DeactivateOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ userId: string; deactivated: boolean; inSos: boolean; holdsJob: boolean }>
      >`
        SELECT "Courier"."userId" AS "userId",
               ("Courier"."deactivatedAt" IS NOT NULL) AS "deactivated",
               EXISTS (${activeSosCourierSubQuery()}) AS "inSos",
               EXISTS (
                 SELECT 1 FROM "Delivery"
                 WHERE (${heldBoxDeliveriesWhere(Prisma.sql`"Courier"."id"`)})
                   AND "Delivery"."courierId" = "Courier"."id"
               ) AS "holdsJob"
        FROM "Courier" WHERE "Courier"."id" = ${courierId} FOR UPDATE
      `
      const row = locked[0]
      if (!row) return { outcome: 'MISSING' }
      if (row.deactivated) return { outcome: 'ALREADY' }
      const user = await tx.user.findUnique({ where: { id: row.userId }, select: { role: true } })
      if (user?.role.includes(EnumUserRole.ADMIN)) return { outcome: 'IS_ADMIN' }
      if (row.inSos) return { outcome: 'IN_SOS' }
      if (row.holdsJob) return { outcome: 'HOLDS_JOB' }

      await tx.courier.update({
        where: { id: courierId },
        data: { deactivatedAt: now, deactivatedByUserId: adminUserId },
      })
      await tx.user.update({ where: { id: row.userId }, data: { credentialsChangedAt: now } })
      const bookings = await tx.shiftBooking.findMany({
        where: { courierId, status: EnumShiftBookingStatus.BOOKED, endsAt: { gt: now } },
        select: { id: true },
      })
      for (const booking of bookings) {
        await tx.shiftBooking.update({
          where: { id: booking.id },
          data: { status: EnumShiftBookingStatus.DROPPED, endedAt: now, swapOfferedAt: null },
        })
        await tx.shiftBookingEvent.create({
          data: { shiftBookingId: booking.id, type: EnumShiftBookingEventType.DROPPED, courierId, adminUserId },
        })
      }
      await tx.courierAccountChange.create({
        data: { courierId, actorUserId: adminUserId, kind: EnumCourierAccountChangeKind.DEACTIVATED, reason },
      })
      return { outcome: 'DONE', userId: row.userId, droppedBookings: bookings.length }
    })
  }

  // AC-3, cross check 9: clears the fields and the password, ends sessions again, and records it. Bookings
  // and devices are not restored; the rider is Offline already.
  async reactivate(
    courierId: string,
    adminUserId: string,
    reason: string | null,
    now: Date
  ): Promise<ReactivateOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ userId: string; deactivated: boolean }>>`
        SELECT "userId", ("deactivatedAt" IS NOT NULL) AS "deactivated" FROM "Courier" WHERE "id" = ${courierId} FOR UPDATE
      `
      const row = locked[0]
      if (!row) return { outcome: 'MISSING' }
      if (!row.deactivated) return { outcome: 'NOT_DEACTIVATED' }
      await tx.courier.update({ where: { id: courierId }, data: { deactivatedAt: null, deactivatedByUserId: null } })
      await tx.user.update({ where: { id: row.userId }, data: { password: null, credentialsChangedAt: now } })
      await tx.courierAccountChange.create({
        data: { courierId, actorUserId: adminUserId, kind: EnumCourierAccountChangeKind.REACTIVATED, reason },
      })
      return { outcome: 'DONE', userId: row.userId }
    })
  }

  // AC-5: one row per change. `tx` lets a caller write it in its own transaction.
  async record(
    changes: AccountChangeInput[],
    tx: Prisma.TransactionClient | PrismaService = this.prisma
  ): Promise<void> {
    if (changes.length === 0) return
    await tx.courierAccountChange.createMany({
      data: changes.map((change) => ({
        courierId: change.courierId,
        actorUserId: change.actorUserId,
        actorIsRider: change.actorIsRider,
        kind: change.kind,
        field: change.field ?? null,
        oldValue: change.oldValue ?? null,
        newValue: change.newValue ?? null,
        reason: change.reason ?? null,
      })),
    })
  }

  // AC-6, AC-7: this rider's account changes, newest first. Admins also get the acting admin's email.
  async listFor(courierId: string): Promise<AccountChangeWithActor[]> {
    const rows = await this.prisma.courierAccountChange.findMany({
      where: { courierId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    const adminIds = [...new Set(rows.map((row) => row.actorUserId).filter((id): id is string => id !== null))]
    const admins = adminIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, email: true } })
      : []
    const emailOf = new Map(admins.map((admin) => [admin.id, admin.email]))
    return rows.map((row) => ({ ...row, actorEmail: row.actorUserId ? emailOf.get(row.actorUserId) ?? null : null }))
  }
}
