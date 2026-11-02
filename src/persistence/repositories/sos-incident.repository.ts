import { Injectable } from '@nestjs/common'
import { EnumSosOutcome, Prisma, SosIncident, SosLocationPoint } from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { ACTIVE_SOS_WHERE } from 'src/domains/sos/sos-incident-state'

// What every admin read of an incident carries besides its own columns: the rider's name (never
// more of the rider) and who closed it. `satisfies` checks the object against Prisma's type without
// widening it, so Prisma still knows exactly which fields come back.
const ADMIN_INCLUDE = {
  courier: { select: { id: true, firstName: true, lastName: true } },
  closedBy: { select: { id: true, email: true, username: true } },
} satisfies Prisma.SosIncidentInclude

export type SosIncidentWithPeople = Prisma.SosIncidentGetPayload<{ include: typeof ADMIN_INCLUDE }>

export type NewSosPoint = {
  latitude: number
  longitude: number
  accuracyMetres: number | null
  recordedAt: Date
}

// Spec 0022. The SOS incidents and the positions shared during them. This file and the SOS service
// are the only code that reads SosLocationPoint (AC-13); nothing here logs a coordinate.
@Injectable()
export class SosIncidentRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  // Starts an SOS, or returns the one this start already made or the one already active (AC-4).
  // Runs in one transaction that first locks the rider's row (`FOR UPDATE`), so two starts sent at
  // once (a retry racing the original) wait for each other and can never make two active incidents.
  // The order matters: the phone's own id first, so a retried start whose original an admin has
  // since closed returns that closed one instead of opening a second SOS nobody asked for.
  async startOrReturn(data: {
    courierId: string
    clientId: string
    deliveryId: string | null
    startedAt: Date
  }): Promise<{ incident: SosIncident; created: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Courier" WHERE "id" = ${data.courierId} FOR UPDATE`
      const same = await tx.sosIncident.findUnique({
        where: { courierId_clientId: { courierId: data.courierId, clientId: data.clientId } },
      })
      if (same) return { incident: same, created: false }
      const active = await tx.sosIncident.findFirst({
        where: { courierId: data.courierId, ...ACTIVE_SOS_WHERE },
        orderBy: { startedAt: 'desc' },
      })
      if (active) return { incident: active, created: false }
      const incident = await tx.sosIncident.create({ data })
      return { incident, created: true }
    })
  }

  async findById(id: string): Promise<SosIncident | null> {
    return this.prisma.sosIncident.findUnique({ where: { id } })
  }

  // The rider's active incident, if any (AC-12: the phone resumes it after a restart).
  async findActiveForCourier(courierId: string): Promise<SosIncident | null> {
    return this.prisma.sosIncident.findFirst({
      where: { courierId, ...ACTIVE_SOS_WHERE },
      orderBy: { startedAt: 'desc' },
    })
  }

  // Stores points for an incident only while it is active (AC-5, AC-6), checked under a lock on the
  // incident's row so an end or a close that lands at the same moment cannot let a point slip in
  // after it. Returns the number stored, or null when the incident is no longer active.
  async addPointsIfActive(incidentId: string, points: NewSosPoint[]): Promise<number | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SosIncident" WHERE "id" = ${incidentId} FOR UPDATE`
      const stillActive = await tx.sosIncident.findFirst({
        where: { id: incidentId, ...ACTIVE_SOS_WHERE },
        select: { id: true },
      })
      if (!stillActive) return null
      const result = await tx.sosLocationPoint.createMany({
        data: points.map((point) => ({ ...point, incidentId })),
      })
      return result.count
    })
  }

  // The rider's "I'm safe" or "False alarm" (AC-6): one conditional write, so it only lands on an
  // incident still active. Returns false when it matched nothing (ended or closed meanwhile).
  async endByRiderIfActive(incidentId: string, field: 'safeAt' | 'falseAlarmAt', at: Date): Promise<boolean> {
    const result = await this.prisma.sosIncident.updateMany({
      where: { id: incidentId, ...ACTIVE_SOS_WHERE },
      data: { [field]: at },
    })
    return result.count === 1
  }

  // An admin's close (AC-10): conditional on not being closed yet, so two admins closing at once
  // cannot both write. Returns false when it was already closed.
  async closeIfOpen(
    incidentId: string,
    data: { closedAt: Date; closedByUserId: string; outcome: EnumSosOutcome; note: string | null }
  ): Promise<boolean> {
    const result = await this.prisma.sosIncident.updateMany({
      where: { id: incidentId, closedAt: null },
      data,
    })
    return result.count === 1
  }

  // Active and awaiting close, newest first, all of them (AC-9: the top of the list, not paginated).
  async findCurrentWithPeople(): Promise<SosIncidentWithPeople[]> {
    return this.prisma.sosIncident.findMany({
      where: { closedAt: null },
      include: ADMIN_INCLUDE,
      orderBy: { startedAt: 'desc' },
    })
  }

  // Closed ones, newest first, one page (AC-9).
  async findClosedPageWithPeople(page: number, limit: number): Promise<{ data: SosIncidentWithPeople[]; total: number }> {
    const where: Prisma.SosIncidentWhereInput = { closedAt: { not: null } }
    const [total, data] = await Promise.all([
      this.prisma.sosIncident.count({ where }),
      this.prisma.sosIncident.findMany({
        where,
        include: ADMIN_INCLUDE,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])
    return { data, total }
  }

  async findByIdWithPeople(id: string): Promise<SosIncidentWithPeople | null> {
    return this.prisma.sosIncident.findUnique({ where: { id }, include: ADMIN_INCLUDE })
  }

  // The trail, oldest first, for the admin incident page only (AC-9, AC-13).
  async findPoints(incidentId: string): Promise<SosLocationPoint[]> {
    return this.prisma.sosLocationPoint.findMany({
      where: { incidentId },
      orderBy: { recordedAt: 'asc' },
    })
  }

  // The daily retention job (AC-11): deletes the points of every incident whose newest point is
  // older than `cutoff`, active or not, and marks each such incident with `pointsDeletedAt`. The
  // incident itself stays. One transaction, so an incident is never left marked with points kept,
  // or with points gone and no mark. Returns how many incidents had their points deleted.
  async deleteOldPoints(cutoff: Date, now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const stale = await tx.$queryRaw<Array<{ incidentId: string }>>`
        SELECT "incidentId"
        FROM "SosLocationPoint"
        GROUP BY "incidentId"
        HAVING MAX("recordedAt") < ${cutoff}
      `
      const ids = stale.map((row) => row.incidentId)
      if (ids.length === 0) return 0
      await tx.sosLocationPoint.deleteMany({ where: { incidentId: { in: ids } } })
      await tx.sosIncident.updateMany({ where: { id: { in: ids } }, data: { pointsDeletedAt: now } })
      return ids.length
    })
  }
}
