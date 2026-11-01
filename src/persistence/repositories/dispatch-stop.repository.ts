import { Injectable } from '@nestjs/common'
import { DispatchStop, EnumDispatchStopReason, Prisma } from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

// Spec 0014. The dispatch stops: the record members read and the state the platform obeys.
// A stop is ON while it has started, is not cancelled or ended, and its planned end has not passed.
export const ON_AT = (now: Date): Prisma.DispatchStopWhereInput => ({
  startsAt: { lte: now },
  cancelledAt: null,
  endedAt: null,
  OR: [{ endsAt: null }, { endsAt: { gt: now } }],
})

@Injectable()
export class DispatchStopRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  // The stop on at `now`, if any. Stops never overlap, so there is at most one.
  async findOn(now: Date): Promise<DispatchStop | null> {
    return this.prisma.dispatchStop.findFirst({ where: ON_AT(now), orderBy: { startsAt: 'desc' } })
  }

  // Stops that have not started and are not cancelled, soonest first.
  async findScheduled(now: Date): Promise<DispatchStop[]> {
    return this.prisma.dispatchStop.findMany({
      where: { startsAt: { gt: now }, cancelledAt: null },
      orderBy: { startsAt: 'asc' },
    })
  }

  // The latest stops, newest first: the record (spec 0014, AC-8).
  async findHistory(limit: number): Promise<DispatchStop[]> {
    return this.prisma.dispatchStop.findMany({ orderBy: { startsAt: 'desc' }, take: limit })
  }

  async findById(id: string): Promise<DispatchStop | null> {
    return this.prisma.dispatchStop.findUnique({ where: { id } })
  }

  // Creates a stop unless its window overlaps a stop that is not ended or cancelled. Check and
  // insert happen in one transaction under an advisory lock, so two admins saving at once cannot
  // both pass (spec 0014, AC-2). Returns null on an overlap.
  async createIfNoOverlap(data: {
    reason: EnumDispatchStopReason
    startsAt: Date
    endsAt: Date | null
    createdByUserId: string
  }): Promise<DispatchStop | null> {
    return this.prisma.$transaction(async (tx) => {
      // `pg_advisory_xact_lock` waits for any other transaction holding this lock and releases it
      // when this transaction ends; hashtext turns the name into the lock's number. $executeRaw, not
      // $queryRaw: the function returns `void`, which $queryRaw cannot read back (seen live).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('dispatch-stop'))`
      const overlapping = await tx.dispatchStop.findFirst({
        where: {
          cancelledAt: null,
          endedAt: null,
          // Overlap: it starts before the new one ends, and ends (or never ends) after the new start.
          ...(data.endsAt ? { startsAt: { lt: data.endsAt } } : {}),
          OR: [{ endsAt: null }, { endsAt: { gt: data.startsAt } }],
        },
      })
      if (overlapping) return null
      return tx.dispatchStop.create({ data })
    })
  }

  // Ends a stop that is on (a restart) or cancels one that has not started. Conditional, so two
  // admins pressing at once end it once; returns the stop, or null if it was already ended or
  // cancelled.
  async endOrCancel(id: string, now: Date, userId: string): Promise<DispatchStop | null> {
    const stop = await this.findById(id)
    if (!stop || stop.endedAt || stop.cancelledAt) return null
    const notStarted = stop.startsAt > now
    const changed = await this.prisma.dispatchStop.updateMany({
      where: { id, endedAt: null, cancelledAt: null },
      data: notStarted ? { cancelledAt: now, cancelledByUserId: userId } : { endedAt: now, endedByUserId: userId },
    })
    return changed.count === 1 ? this.findById(id) : null
  }

  // Stops whose start work is due: on now, and not yet started.
  async findDueToStart(now: Date): Promise<DispatchStop[]> {
    return this.prisma.dispatchStop.findMany({ where: { ...ON_AT(now), startedAt: null } })
  }

  // Stops whose end work is due: started, end work not done, and ended or past their planned end.
  // A stop whose whole window passed while the server was down never started: it gets the end work
  // too, which only matches waiting deliveries again.
  async findDueToEnd(now: Date): Promise<DispatchStop[]> {
    return this.prisma.dispatchStop.findMany({
      where: {
        endWorkDoneAt: null,
        cancelledAt: null,
        startsAt: { lte: now },
        OR: [{ endedAt: { not: null } }, { endsAt: { lte: now } }],
      },
    })
  }

  // Marks the start (or end) work as done, only once: returns false if another tick did it first.
  async markStarted(id: string, at: Date): Promise<boolean> {
    const changed = await this.prisma.dispatchStop.updateMany({ where: { id, startedAt: null }, data: { startedAt: at } })
    return changed.count === 1
  }

  async markEndWorkDone(id: string, at: Date): Promise<boolean> {
    const changed = await this.prisma.dispatchStop.updateMany({
      where: { id, endWorkDoneAt: null },
      data: { endWorkDoneAt: at },
    })
    return changed.count === 1
  }
}
