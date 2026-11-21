import { Injectable } from '@nestjs/common'
import {
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumShiftBookingEventType,
  EnumShiftBookingStatus,
  Prisma,
  ShiftBooking,
  ShiftSlot,
} from '@prisma/types'
import { isUniqueConstraintError } from 'src/prisma.util'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

export type BookingWithSlot = ShiftBooking & { shiftSlot: ShiftSlot }

// Spec 0049: an Offline change the minute sweep looks at.
export interface OfflineChange {
  id: string
  courierId: string
  cause: EnumCourierStatusChangeCause
  adminUserId: string | null
  createdAt: Date
}

// Spec 0049 (AC-6): one Offline during a booked shift, as an admin's follow up list shows it.
export interface OfflineEventForAdmin {
  id: string
  offlineAt: Date | null
  cause: EnumCourierStatusChangeCause | null
  followedUpAt: Date | null
  followedUpByEmail: string | null
  courierId: string
  courierName: string
  shiftStartsAt: Date
  shiftEndsAt: Date
  shiftDate: string
}

// Spec 0049 (AC-5, cross check 4): what a rider reads of their own record: its time, cause and shift. Never
// another rider, a swap or an admin.
export interface OwnOfflineRecord {
  id: string
  offlineAt: Date
  cause: EnumCourierStatusChangeCause | null
  shiftStartsAt: Date
  shiftEndsAt: Date
  shiftDate: string
}

// Spec 0027 (row 78): riders' shift bookings and their record. The rules live in ShiftBookingService;
// this keeps the queries and the two advisory locks every book and take takes, rider first, then the
// occurrence, so writers of one rider or one occurrence wait for each other and never deadlock.
@Injectable()
export class ShiftBookingRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work)
  }

  // Held until the transaction ends. $executeRaw, as dispatch-stop.repository.ts does: the lock function
  // returns void, which $queryRaw cannot read back.
  async lockRider(tx: Prisma.TransactionClient, courierId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shift-rider:${courierId}`}))`
  }

  async lockOccurrence(tx: Prisma.TransactionClient, shiftSlotId: string, date: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shift-occ:${shiftSlotId}:${date}`}))`
  }

  // How many places of each listed occurrence are taken: BOOKED rows, keyed "slotId:date".
  async placesTaken(dates: string[], tx: Prisma.TransactionClient | PrismaService = this.prisma): Promise<Map<string, number>> {
    const rows = await tx.shiftBooking.groupBy({
      by: ['shiftSlotId', 'date'],
      where: { status: EnumShiftBookingStatus.BOOKED, date: { in: dates } },
      _count: { _all: true },
    })
    return new Map(rows.map((row) => [`${row.shiftSlotId}:${row.date}`, row._count._all]))
  }

  // This rider's BOOKED bookings that have not ended, soonest first, with their slot (removed or not).
  async currentBookingsOf(courierId: string, now: Date): Promise<BookingWithSlot[]> {
    return this.prisma.shiftBooking.findMany({
      where: { courierId, status: EnumShiftBookingStatus.BOOKED, endsAt: { gt: now } },
      include: { shiftSlot: true },
      orderBy: { startsAt: 'asc' },
    })
  }

  // Spec 0049 (AC-2): which of these riders have a BOOKED booking covering `now` (startsAt <= now < endsAt).
  // "Booked now" is all the matcher ever reads of bookings: never their history or events (AC-7).
  async onShiftNow(courierIds: string[], now: Date): Promise<Set<string>> {
    if (courierIds.length === 0) return new Set()
    const rows = await this.prisma.shiftBooking.findMany({
      where: {
        courierId: { in: courierIds },
        status: EnumShiftBookingStatus.BOOKED,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      select: { courierId: true },
    })
    return new Set(rows.map((row) => row.courierId))
  }

  // Open swaps by other riders on occurrences that have not started, oldest offer first.
  async openSwapsNotBy(courierId: string, now: Date): Promise<ShiftBooking[]> {
    return this.prisma.shiftBooking.findMany({
      where: {
        status: EnumShiftBookingStatus.BOOKED,
        swapOfferedAt: { not: null },
        startsAt: { gt: now },
        courierId: { not: courierId },
      },
      orderBy: [{ swapOfferedAt: 'asc' }, { id: 'asc' }],
    })
  }

  async findBooking(id: string, tx: Prisma.TransactionClient | PrismaService = this.prisma): Promise<BookingWithSlot | null> {
    return tx.shiftBooking.findUnique({ where: { id }, include: { shiftSlot: true } })
  }

  // A BOOKED booking of this rider overlapping [startsAt, endsAt) (half open: touching shifts do not overlap).
  async overlapping(tx: Prisma.TransactionClient, courierId: string, startsAt: Date, endsAt: Date): Promise<ShiftBooking | null> {
    return tx.shiftBooking.findFirst({
      where: { courierId, status: EnumShiftBookingStatus.BOOKED, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    })
  }

  async alreadyBooked(tx: Prisma.TransactionClient, courierId: string, shiftSlotId: string, date: string): Promise<boolean> {
    const found = await tx.shiftBooking.findFirst({
      where: { courierId, shiftSlotId, date, status: EnumShiftBookingStatus.BOOKED },
      select: { id: true },
    })
    return found !== null
  }

  async countBooked(tx: Prisma.TransactionClient, shiftSlotId: string, date: string): Promise<number> {
    return tx.shiftBooking.count({ where: { shiftSlotId, date, status: EnumShiftBookingStatus.BOOKED } })
  }

  async createBooking(
    tx: Prisma.TransactionClient,
    data: { shiftSlotId: string; courierId: string; date: string; startsAt: Date; endsAt: Date; capAtBooking: number },
    event: { otherCourierId: string | null }
  ): Promise<ShiftBooking> {
    const booking = await tx.shiftBooking.create({ data })
    await this.event(tx, booking.id, EnumShiftBookingEventType.BOOKED, data.courierId, event.otherCourierId)
    return booking
  }

  // A conditional write on the booking as the rule needs it to be; false when another write got there first.
  async updateIf(
    tx: Prisma.TransactionClient,
    where: Prisma.ShiftBookingWhereInput & { id: string },
    data: Prisma.ShiftBookingUpdateManyMutationInput
  ): Promise<boolean> {
    const { count } = await tx.shiftBooking.updateMany({ where, data })
    return count > 0
  }

  // Spec 0049 (cross check 1): Offline changes made between `from` and `upTo` that have no event yet.
  async offlineChangesWithoutEvent(from: Date, upTo: Date): Promise<OfflineChange[]> {
    const changes = await this.prisma.courierStatusChange.findMany({
      where: { toStatus: EnumCourierStatus.OFFLINE, createdAt: { gte: from, lte: upTo } },
      select: { id: true, courierId: true, cause: true, adminUserId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    if (changes.length === 0) return []
    const done = await this.prisma.shiftBookingEvent.findMany({
      where: { courierStatusChangeId: { in: changes.map((change) => change.id) } },
      select: { courierStatusChangeId: true },
    })
    const seen = new Set(done.map((row) => row.courierStatusChangeId))
    return changes.filter((change) => !seen.has(change.id))
  }

  // Whether the rider left Offline after `after`, up to `upTo` (a break, not a stop).
  async leftOfflineBetween(courierId: string, after: Date, upTo: Date): Promise<boolean> {
    const change = await this.prisma.courierStatusChange.findFirst({
      where: { courierId, fromStatus: EnumCourierStatus.OFFLINE, createdAt: { gt: after, lte: upTo } },
      select: { id: true },
    })
    return change !== null
  }

  // The rider's BOOKED booking covering `at`, if any (bookings never overlap, spec 0027).
  async bookedCovering(courierId: string, at: Date): Promise<ShiftBooking | null> {
    return this.prisma.shiftBooking.findFirst({
      where: { courierId, status: EnumShiftBookingStatus.BOOKED, startsAt: { lte: at }, endsAt: { gt: at } },
    })
  }

  // One event per Offline change: the unique status change id makes a second writer's insert fail, which
  // is the outcome wanted, so it returns false rather than throwing.
  async createOfflineEvent(data: {
    shiftBookingId: string
    courierId: string
    courierStatusChangeId: string
    cause: EnumCourierStatusChangeCause
    offlineAt: Date
    followedUpAt: Date | null
    followedUpByUserId: string | null
  }): Promise<boolean> {
    try {
      await this.prisma.shiftBookingEvent.create({
        data: { ...data, type: EnumShiftBookingEventType.WENT_OFFLINE_MID_SHIFT },
      })
      return true
    } catch (error) {
      if (error instanceof Error && isUniqueConstraintError(error)) return false
      throw error
    }
  }

  // AC-6, cross check 3: open items, and followed up ones for `keepSince` onwards, newest first. Never
  // grouped, counted or sorted by rider.
  async offlineEventsForAdmin(keepSince: Date): Promise<OfflineEventForAdmin[]> {
    const rows = await this.prisma.shiftBookingEvent.findMany({
      where: {
        type: EnumShiftBookingEventType.WENT_OFFLINE_MID_SHIFT,
        OR: [{ followedUpAt: null }, { followedUpAt: { gte: keepSince } }],
      },
      select: {
        id: true,
        offlineAt: true,
        cause: true,
        followedUpAt: true,
        followedUpBy: { select: { email: true } },
        shiftBooking: {
          select: {
            courierId: true,
            startsAt: true,
            endsAt: true,
            date: true,
            courier: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: [{ offlineAt: 'desc' }, { id: 'desc' }],
    })
    return rows.map((row) => ({
      id: row.id,
      offlineAt: row.offlineAt,
      cause: row.cause,
      followedUpAt: row.followedUpAt,
      followedUpByEmail: row.followedUpBy?.email ?? null,
      courierId: row.shiftBooking.courierId,
      courierName: `${row.shiftBooking.courier.firstName} ${row.shiftBooking.courier.lastName}`.trim(),
      shiftStartsAt: row.shiftBooking.startsAt,
      shiftEndsAt: row.shiftBooking.endsAt,
      shiftDate: row.shiftBooking.date,
    }))
  }

  // AC-6: marks an open item followed up, conditional on it still being open. 'missing' when no such event.
  async markFollowedUp(id: string, adminUserId: string, at: Date): Promise<'done' | 'already' | 'missing'> {
    const { count } = await this.prisma.shiftBookingEvent.updateMany({
      where: { id, type: EnumShiftBookingEventType.WENT_OFFLINE_MID_SHIFT, followedUpAt: null },
      data: { followedUpAt: at, followedUpByUserId: adminUserId },
    })
    if (count > 0) return 'done'
    const exists = await this.prisma.shiftBookingEvent.findFirst({
      where: { id, type: EnumShiftBookingEventType.WENT_OFFLINE_MID_SHIFT },
      select: { id: true },
    })
    return exists ? 'already' : 'missing'
  }

  // AC-5, cross check 4: this rider's own records since `since`, newest first, with only the time, cause and
  // shift (never otherCourierId or any swap data).
  async ownOfflineRecords(courierId: string, since: Date): Promise<OwnOfflineRecord[]> {
    const rows = await this.prisma.shiftBookingEvent.findMany({
      where: {
        type: EnumShiftBookingEventType.WENT_OFFLINE_MID_SHIFT,
        offlineAt: { gte: since },
        shiftBooking: { courierId },
      },
      select: {
        id: true,
        offlineAt: true,
        cause: true,
        shiftBooking: { select: { startsAt: true, endsAt: true, date: true } },
      },
      orderBy: [{ offlineAt: 'desc' }, { id: 'desc' }],
    })
    return rows
      .filter((row): row is typeof row & { offlineAt: Date } => row.offlineAt !== null)
      .map((row) => ({
        id: row.id,
        offlineAt: row.offlineAt,
        cause: row.cause,
        shiftStartsAt: row.shiftBooking.startsAt,
        shiftEndsAt: row.shiftBooking.endsAt,
        shiftDate: row.shiftBooking.date,
      }))
  }

  async event(
    tx: Prisma.TransactionClient,
    shiftBookingId: string,
    type: EnumShiftBookingEventType,
    courierId: string,
    otherCourierId: string | null = null
  ): Promise<void> {
    await tx.shiftBookingEvent.create({ data: { shiftBookingId, type, courierId, otherCourierId } })
  }
}
