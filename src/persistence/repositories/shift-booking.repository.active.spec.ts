import { EnumShiftBookingEventType, EnumShiftBookingStatus } from '@prisma/types'
import { PrismaService } from 'src/services/prisma/prisma.service'
import { ShiftBookingRepository } from './shift-booking.repository'

// Spec 0027 (row 78): the booking queries and the two advisory locks. No SQL runs here (decision 61.20):
// the lock SQL is checked as text, and the Prisma calls as the `where` they send.
describe('ShiftBookingRepository (spec 0027)', () => {
  let repository: ShiftBookingRepository
  let prisma: any
  let tx: any
  const now = new Date('2026-11-03T10:00:00.000Z')

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
      shiftBooking: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'booking-new', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        groupBy: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      shiftBookingEvent: { create: jest.fn().mockResolvedValue({}) },
    }
    prisma = {
      $transaction: jest.fn((work) => work(tx)),
      shiftBooking: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    }
    repository = new ShiftBookingRepository(prisma as unknown as PrismaService)
  })

  // The SQL a tagged template call sent, with its bound values as `$n`.
  function sentSql(mock: jest.Mock, call = 0): { sql: string; values: unknown[] } {
    const [strings, ...values] = mock.mock.calls[call] as [TemplateStringsArray, ...unknown[]]
    return { sql: strings.reduce((text, part, i) => text + (i > 0 ? `$${i}` : '') + part, ''), values }
  }

  describe('the advisory locks (concurrency precisions)', () => {
    it("lockRider takes pg_advisory_xact_lock(hashtext('shift-rider:' || courierId)) through $executeRaw on the tx", async () => {
      await repository.lockRider(tx, 'courier-7')
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
      expect(tx.$queryRaw).not.toHaveBeenCalled()
      expect(sentSql(tx.$executeRaw)).toEqual({
        sql: 'SELECT pg_advisory_xact_lock(hashtext($1))',
        values: ['shift-rider:courier-7'],
      })
    })

    it("lockOccurrence takes pg_advisory_xact_lock(hashtext('shift-occ:' || slot || ':' || date)) through $executeRaw on the tx", async () => {
      await repository.lockOccurrence(tx, 'slot-fri', '2026-11-06')
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
      expect(tx.$queryRaw).not.toHaveBeenCalled()
      expect(sentSql(tx.$executeRaw)).toEqual({
        sql: 'SELECT pg_advisory_xact_lock(hashtext($1))',
        values: ['shift-occ:slot-fri:2026-11-06'],
      })
    })

    it('the rider and occurrence keys never collide: different prefixes', async () => {
      await repository.lockRider(tx, 'x')
      await repository.lockOccurrence(tx, 'x', '2026-11-06')
      expect(sentSql(tx.$executeRaw, 0).values[0]).not.toEqual(sentSql(tx.$executeRaw, 1).values[0])
    })

    it('uses the transaction-scoped lock (xact), never a session lock', async () => {
      await repository.lockRider(tx, 'c')
      await repository.lockOccurrence(tx, 's', 'd')
      for (const call of [0, 1]) {
        expect(sentSql(tx.$executeRaw, call).sql).toContain('pg_advisory_xact_lock(')
        expect(sentSql(tx.$executeRaw, call).sql).not.toMatch(/pg_advisory_lock\(/)
      }
    })
  })

  describe('transaction', () => {
    it('runs the work in prisma.$transaction with its tx', async () => {
      const result = await repository.transaction((given) => {
        expect(given).toBe(tx)
        return Promise.resolve('done')
      })
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(result).toBe('done')
    })
  })

  describe('overlapping (AC-6)', () => {
    it('is half open: a BOOKED booking of this rider with startsAt < end and endsAt > start', async () => {
      const startsAt = new Date('2026-11-06T17:00:00.000Z')
      const endsAt = new Date('2026-11-06T21:00:00.000Z')
      await repository.overlapping(tx, 'courier-7', startsAt, endsAt)
      expect(tx.shiftBooking.findFirst).toHaveBeenCalledWith({
        where: {
          courierId: 'courier-7',
          status: EnumShiftBookingStatus.BOOKED,
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
      })
    })

    it('runs on the transaction, not the plain client', async () => {
      await repository.overlapping(tx, 'c', now, now)
      expect(tx.shiftBooking.findFirst).toHaveBeenCalledTimes(1)
    })
  })

  describe('counts and checks under the lock', () => {
    it('countBooked counts only BOOKED rows of the occurrence, on the tx', async () => {
      tx.shiftBooking.count.mockResolvedValue(3)
      expect(await repository.countBooked(tx, 'slot-fri', '2026-11-06')).toBe(3)
      expect(tx.shiftBooking.count).toHaveBeenCalledWith({
        where: { shiftSlotId: 'slot-fri', date: '2026-11-06', status: EnumShiftBookingStatus.BOOKED },
      })
    })

    it("alreadyBooked looks for this rider's BOOKED row on the occurrence", async () => {
      expect(await repository.alreadyBooked(tx, 'c', 'slot-fri', '2026-11-06')).toBe(false)
      expect(tx.shiftBooking.findFirst).toHaveBeenCalledWith({
        where: { courierId: 'c', shiftSlotId: 'slot-fri', date: '2026-11-06', status: EnumShiftBookingStatus.BOOKED },
        select: { id: true },
      })
      tx.shiftBooking.findFirst.mockResolvedValue({ id: 'b' })
      expect(await repository.alreadyBooked(tx, 'c', 'slot-fri', '2026-11-06')).toBe(true)
    })
  })

  describe('AC-7: writes and their events', () => {
    it('createBooking creates the row and its BOOKED event on the same tx, with otherCourierId', async () => {
      const data = {
        shiftSlotId: 'slot-fri',
        courierId: 'taker',
        date: '2026-11-06',
        startsAt: new Date('2026-11-06T17:00:00.000Z'),
        endsAt: new Date('2026-11-06T21:00:00.000Z'),
        capAtBooking: 3,
      }
      const created = await repository.createBooking(tx, data, { otherCourierId: 'giver' })
      expect(tx.shiftBooking.create).toHaveBeenCalledWith({ data })
      expect(tx.shiftBookingEvent.create).toHaveBeenCalledWith({
        data: {
          shiftBookingId: 'booking-new',
          type: EnumShiftBookingEventType.BOOKED,
          courierId: 'taker',
          otherCourierId: 'giver',
        },
      })
      expect(created.id).toBe('booking-new')
    })

    it('createBooking records otherCourierId null for a plain booking', async () => {
      await repository.createBooking(
        tx,
        { shiftSlotId: 's', courierId: 'c', date: '2026-11-06', startsAt: now, endsAt: now, capAtBooking: 1 },
        { otherCourierId: null }
      )
      expect(tx.shiftBookingEvent.create.mock.calls[0][0].data.otherCourierId).toBeNull()
    })

    it('event writes the row on the tx; otherCourierId defaults to null', async () => {
      await repository.event(tx, 'b1', EnumShiftBookingEventType.DROPPED, 'c')
      expect(tx.shiftBookingEvent.create).toHaveBeenCalledWith({
        data: { shiftBookingId: 'b1', type: EnumShiftBookingEventType.DROPPED, courierId: 'c', otherCourierId: null },
      })
    })

    it('updateIf is an updateMany on the given where, true only when a row changed', async () => {
      const where = { id: 'b1', courierId: 'c', status: EnumShiftBookingStatus.BOOKED }
      const data = { status: EnumShiftBookingStatus.DROPPED }
      expect(await repository.updateIf(tx, where, data)).toBe(true)
      expect(tx.shiftBooking.updateMany).toHaveBeenCalledWith({ where, data })
      tx.shiftBooking.updateMany.mockResolvedValue({ count: 0 })
      expect(await repository.updateIf(tx, where, data)).toBe(false)
    })
  })

  describe('reads for the schedule (AC-2, value 5)', () => {
    it('placesTaken groups BOOKED rows by slot and date over the listed dates, keyed "slot:date"', async () => {
      prisma.shiftBooking.groupBy.mockResolvedValue([
        { shiftSlotId: 'slot-fri', date: '2026-11-06', _count: { _all: 2 } },
      ])
      const taken = await repository.placesTaken(['2026-11-06', '2026-11-07'])
      expect(prisma.shiftBooking.groupBy).toHaveBeenCalledWith({
        by: ['shiftSlotId', 'date'],
        where: { status: EnumShiftBookingStatus.BOOKED, date: { in: ['2026-11-06', '2026-11-07'] } },
        _count: { _all: true },
      })
      expect(taken.get('slot-fri:2026-11-06')).toBe(2)
    })

    it('placesTaken never groups by rider (no count per rider anywhere)', async () => {
      await repository.placesTaken(['2026-11-06'])
      expect(prisma.shiftBooking.groupBy.mock.calls[0][0].by).not.toContain('courierId')
    })

    it("currentBookingsOf reads this rider's BOOKED bookings that have not ended, with their slot, soonest first", async () => {
      await repository.currentBookingsOf('c', now)
      expect(prisma.shiftBooking.findMany).toHaveBeenCalledWith({
        where: { courierId: 'c', status: EnumShiftBookingStatus.BOOKED, endsAt: { gt: now } },
        include: { shiftSlot: true },
        orderBy: { startsAt: 'asc' },
      })
    })

    it('openSwapsNotBy reads open offers by other riders that have not started, oldest offer first', async () => {
      await repository.openSwapsNotBy('c', now)
      expect(prisma.shiftBooking.findMany).toHaveBeenCalledWith({
        where: {
          status: EnumShiftBookingStatus.BOOKED,
          swapOfferedAt: { not: null },
          startsAt: { gt: now },
          courierId: { not: 'c' },
        },
        orderBy: [{ swapOfferedAt: 'asc' }, { id: 'asc' }],
      })
    })
  })
})
