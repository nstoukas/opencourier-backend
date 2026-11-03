import { Injectable } from '@nestjs/common'
import { EnumShiftBookingEventType, EnumShiftBookingStatus, Prisma, ShiftBooking, ShiftSlot } from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

export type BookingWithSlot = ShiftBooking & { shiftSlot: ShiftSlot }

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
