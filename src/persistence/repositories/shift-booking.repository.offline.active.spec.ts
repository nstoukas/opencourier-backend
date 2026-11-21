import { PrismaService } from 'src/services/prisma/prisma.service'
import { ShiftBookingRepository } from './shift-booking.repository'

// Spec 0049 (row 79; AC-2, AC-4 to AC-6, cross check 1 to 4): the bookings repository's reads and writes
// for shift priority and the Offline record. No SQL runs here (decision 61.20): each Prisma call is
// checked as the `where`, `select` and `orderBy` it sends.
describe('ShiftBookingRepository (spec 0049)', () => {
  let repository: ShiftBookingRepository
  let prisma: {
    shiftBooking: { findMany: jest.Mock; findFirst: jest.Mock }
    shiftBookingEvent: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock; updateMany: jest.Mock }
    courierStatusChange: { findMany: jest.Mock; findFirst: jest.Mock }
  }
  const now = new Date('2026-11-20T20:00:00.000Z')

  beforeEach(() => {
    prisma = {
      shiftBooking: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      shiftBookingEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      courierStatusChange: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    }
    repository = new ShiftBookingRepository(prisma as unknown as PrismaService)
  })

  describe('onShiftNow (AC-2): a BOOKED booking with startsAt <= now < endsAt', () => {
    it('asks for BOOKED bookings of these riders covering now, half open, and only their rider id', async () => {
      await repository.onShiftNow(['a', 'b'], now)
      expect(prisma.shiftBooking.findMany).toHaveBeenCalledWith({
        where: { courierId: { in: ['a', 'b'] }, status: 'BOOKED', startsAt: { lte: now }, endsAt: { gt: now } },
        select: { courierId: true },
      })
    })

    it('returns the set of riders who have one', async () => {
      prisma.shiftBooking.findMany.mockResolvedValue([{ courierId: 'b' }, { courierId: 'b' }])
      const result = await repository.onShiftNow(['a', 'b'], now)
      expect(result).toBeInstanceOf(Set)
      expect([...result]).toEqual(['b'])
      expect(result.has('a')).toBe(false)
    })

    it('with no riders to ask about, reads nothing', async () => {
      expect((await repository.onShiftNow([], now)).size).toBe(0)
      expect(prisma.shiftBooking.findMany).not.toHaveBeenCalled()
    })

    it('never reads the events or the status record', async () => {
      await repository.onShiftNow(['a'], now)
      expect(prisma.shiftBookingEvent.findMany).not.toHaveBeenCalled()
      expect(prisma.courierStatusChange.findMany).not.toHaveBeenCalled()
    })
  })

  describe('the sweep reads (cross check 1)', () => {
    const from = new Date('2026-11-20T13:30:00.000Z')
    const upTo = new Date('2026-11-20T19:30:00.000Z')

    it('offlineChangesWithoutEvent reads changes to OFFLINE in the window, oldest first', async () => {
      await repository.offlineChangesWithoutEvent(from, upTo)
      expect(prisma.courierStatusChange.findMany).toHaveBeenCalledWith({
        where: { toStatus: 'OFFLINE', createdAt: { gte: from, lte: upTo } },
        select: { id: true, courierId: true, cause: true, adminUserId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
    })

    it('offlineChangesWithoutEvent leaves out a change that already has its record', async () => {
      const done = { id: 'change-done', courierId: 'r1', cause: 'RIDER', adminUserId: null, createdAt: from }
      const open = { id: 'change-open', courierId: 'r2', cause: 'RIDER', adminUserId: null, createdAt: upTo }
      prisma.courierStatusChange.findMany.mockResolvedValue([done, open])
      prisma.shiftBookingEvent.findMany.mockResolvedValue([{ courierStatusChangeId: 'change-done' }])
      expect(await repository.offlineChangesWithoutEvent(from, upTo)).toEqual([open])
      expect(prisma.shiftBookingEvent.findMany).toHaveBeenCalledWith({
        where: { courierStatusChangeId: { in: ['change-done', 'change-open'] } },
        select: { courierStatusChangeId: true },
      })
    })

    it('offlineChangesWithoutEvent with no change in the window does not read the events', async () => {
      expect(await repository.offlineChangesWithoutEvent(from, upTo)).toEqual([])
      expect(prisma.shiftBookingEvent.findMany).not.toHaveBeenCalled()
    })

    it('leftOfflineBetween: a change of this rider away from OFFLINE after the moment, up to the break end', async () => {
      const after = new Date('2026-11-20T19:10:00.000Z')
      const end = new Date('2026-11-20T19:40:00.000Z')
      expect(await repository.leftOfflineBetween('r1', after, end)).toBe(false)
      expect(prisma.courierStatusChange.findFirst).toHaveBeenCalledWith({
        where: { courierId: 'r1', fromStatus: 'OFFLINE', createdAt: { gt: after, lte: end } },
        select: { id: true },
      })
      prisma.courierStatusChange.findFirst.mockResolvedValue({ id: 'back' })
      expect(await repository.leftOfflineBetween('r1', after, end)).toBe(true)
    })

    it("bookedCovering: the rider's BOOKED booking with startsAt <= at < endsAt", async () => {
      const at = new Date('2026-11-20T19:10:00.000Z')
      const found = { id: 'booking-1' }
      prisma.shiftBooking.findFirst.mockResolvedValue(found)
      expect(await repository.bookedCovering('r1', at)).toBe(found)
      expect(prisma.shiftBooking.findFirst).toHaveBeenCalledWith({
        where: { courierId: 'r1', status: 'BOOKED', startsAt: { lte: at }, endsAt: { gt: at } },
      })
    })
  })

  describe('createOfflineEvent (AC-4): one per Offline change', () => {
    const data = {
      shiftBookingId: 'booking-1',
      courierId: 'r1',
      courierStatusChangeId: 'change-1',
      cause: 'RIDER' as const,
      offlineAt: new Date('2026-11-20T19:10:00.000Z'),
      followedUpAt: null,
      followedUpByUserId: null,
    }

    it('writes a WENT_OFFLINE_MID_SHIFT event with the cause, the time and the status change id', async () => {
      expect(await repository.createOfflineEvent(data)).toBe(true)
      expect(prisma.shiftBookingEvent.create).toHaveBeenCalledTimes(1)
      expect(prisma.shiftBookingEvent.create).toHaveBeenCalledWith({
        data: { ...data, type: 'WENT_OFFLINE_MID_SHIFT' },
      })
    })

    it('a unique conflict on the status change id (P2002) is "already written": false, not an error', async () => {
      const conflict = Object.assign(new Error('Unique constraint failed'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
      })
      prisma.shiftBookingEvent.create.mockRejectedValue(conflict)
      await expect(repository.createOfflineEvent(data)).resolves.toBe(false)
    })

    it('any other database error is still thrown', async () => {
      const other = Object.assign(new Error('Foreign key failed'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2003',
      })
      prisma.shiftBookingEvent.create.mockRejectedValue(other)
      await expect(repository.createOfflineEvent(data)).rejects.toBe(other)
      prisma.shiftBookingEvent.create.mockRejectedValue(new Error('connection lost'))
      await expect(repository.createOfflineEvent(data)).rejects.toThrow('connection lost')
    })
  })

  describe('offlineEventsForAdmin (AC-6, cross check 3)', () => {
    const keepSince = new Date('2026-11-13T20:00:00.000Z')

    function query() {
      return prisma.shiftBookingEvent.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>
        orderBy: unknown
        select: Record<string, unknown>
        take?: unknown
        skip?: unknown
        distinct?: unknown
      }
    }

    it('lists this event type only: the open items, plus those followed up since the given day', async () => {
      await repository.offlineEventsForAdmin(keepSince)
      expect(query().where).toEqual({
        type: 'WENT_OFFLINE_MID_SHIFT',
        OR: [{ followedUpAt: null }, { followedUpAt: { gte: keepSince } }],
      })
    })

    it('is sorted newest first, by the Offline time, and by nothing about the rider', async () => {
      await repository.offlineEventsForAdmin(keepSince)
      expect(query().orderBy).toEqual([{ offlineAt: 'desc' }, { id: 'desc' }])
      expect(JSON.stringify(query().orderBy)).not.toMatch(/courier|rider|name|shiftBooking/i)
    })

    it('never groups, counts or picks distinct riders: one plain findMany, no groupBy, count or _count', async () => {
      const calls: string[] = []
      const table = new Proxy(prisma.shiftBookingEvent, {
        get: (target, method: string) => {
          calls.push(method)
          return (target as Record<string, unknown>)[method]
        },
      })
      const watched = new ShiftBookingRepository({ ...prisma, shiftBookingEvent: table } as unknown as PrismaService)
      await watched.offlineEventsForAdmin(keepSince)
      expect(calls).toEqual(['findMany'])
      expect(query().distinct).toBeUndefined()
      expect(JSON.stringify(query())).not.toMatch(/_count|groupBy|_sum/)
    })

    it('takes only the day to keep from: no rider, search, filter or sort argument', () => {
      expect(repository.offlineEventsForAdmin.length).toBe(1)
    })

    it('gives each item its rider, shift, time, cause and who followed up, and no total', async () => {
      prisma.shiftBookingEvent.findMany.mockResolvedValue([
        {
          id: 'event-2',
          offlineAt: new Date('2026-11-20T19:10:00.000Z'),
          cause: 'ADMIN',
          followedUpAt: new Date('2026-11-20T19:41:00.000Z'),
          followedUpBy: { email: 'admin@example.org' },
          shiftBooking: {
            courierId: 'r1',
            startsAt: new Date('2026-11-20T18:00:00.000Z'),
            endsAt: new Date('2026-11-20T22:00:00.000Z'),
            date: '2026-11-20',
            courier: { firstName: 'Maria', lastName: 'Papadopoulou' },
          },
        },
        {
          id: 'event-1',
          offlineAt: new Date('2026-11-19T19:10:00.000Z'),
          cause: 'RIDER',
          followedUpAt: null,
          followedUpBy: null,
          shiftBooking: {
            courierId: 'r1',
            startsAt: new Date('2026-11-19T18:00:00.000Z'),
            endsAt: new Date('2026-11-19T22:00:00.000Z'),
            date: '2026-11-19',
            courier: { firstName: 'Maria', lastName: 'Papadopoulou' },
          },
        },
      ])
      const items = await repository.offlineEventsForAdmin(keepSince)
      // Two records of the same rider stay two rows, in the order read.
      expect(items).toEqual([
        {
          id: 'event-2',
          offlineAt: new Date('2026-11-20T19:10:00.000Z'),
          cause: 'ADMIN',
          followedUpAt: new Date('2026-11-20T19:41:00.000Z'),
          followedUpByEmail: 'admin@example.org',
          courierId: 'r1',
          courierName: 'Maria Papadopoulou',
          shiftStartsAt: new Date('2026-11-20T18:00:00.000Z'),
          shiftEndsAt: new Date('2026-11-20T22:00:00.000Z'),
          shiftDate: '2026-11-20',
        },
        {
          id: 'event-1',
          offlineAt: new Date('2026-11-19T19:10:00.000Z'),
          cause: 'RIDER',
          followedUpAt: null,
          followedUpByEmail: null,
          courierId: 'r1',
          courierName: 'Maria Papadopoulou',
          shiftStartsAt: new Date('2026-11-19T18:00:00.000Z'),
          shiftEndsAt: new Date('2026-11-19T22:00:00.000Z'),
          shiftDate: '2026-11-19',
        },
      ])
      for (const item of items) {
        expect(Object.keys(item).join(' ')).not.toMatch(/count|total|times|rank/i)
      }
    })
  })

  describe('markFollowedUp (AC-6): once only', () => {
    const at = new Date('2026-11-21T08:00:00.000Z')

    it('marks an open item of this type with the admin and the time, conditional on it still being open', async () => {
      expect(await repository.markFollowedUp('event-1', 'admin-9', at)).toBe('done')
      expect(prisma.shiftBookingEvent.updateMany).toHaveBeenCalledWith({
        where: { id: 'event-1', type: 'WENT_OFFLINE_MID_SHIFT', followedUpAt: null },
        data: { followedUpAt: at, followedUpByUserId: 'admin-9' },
      })
    })

    it("answers 'already' when the item exists but was followed up, and keeps the first admin's mark", async () => {
      prisma.shiftBookingEvent.updateMany.mockResolvedValue({ count: 0 })
      prisma.shiftBookingEvent.findFirst.mockResolvedValue({ id: 'event-1' })
      expect(await repository.markFollowedUp('event-1', 'admin-late', at)).toBe('already')
      expect(prisma.shiftBookingEvent.updateMany).toHaveBeenCalledTimes(1)
    })

    it("answers 'missing' for an unknown id, or an event of another type (a swap, a drop)", async () => {
      prisma.shiftBookingEvent.updateMany.mockResolvedValue({ count: 0 })
      prisma.shiftBookingEvent.findFirst.mockResolvedValue(null)
      expect(await repository.markFollowedUp('nope', 'admin-9', at)).toBe('missing')
      expect(prisma.shiftBookingEvent.findFirst).toHaveBeenCalledWith({
        where: { id: 'nope', type: 'WENT_OFFLINE_MID_SHIFT' },
        select: { id: true },
      })
    })
  })

  describe("ownOfflineRecords (AC-5, cross check 4): only the rider's own, only time, cause and shift", () => {
    const since = new Date('2026-11-13T20:00:00.000Z')

    it("asks for this event type on the asking rider's own bookings, since the given day, newest first", async () => {
      await repository.ownOfflineRecords('rider-me', since)
      const query = prisma.shiftBookingEvent.findMany.mock.calls[0]![0]
      expect(query.where).toEqual({
        type: 'WENT_OFFLINE_MID_SHIFT',
        offlineAt: { gte: since },
        shiftBooking: { courierId: 'rider-me' },
      })
      expect(query.orderBy).toEqual([{ offlineAt: 'desc' }, { id: 'desc' }])
    })

    it('selects only the id, the time, the cause and the shift: no other rider, swap, admin or follow up', async () => {
      await repository.ownOfflineRecords('rider-me', since)
      const query = prisma.shiftBookingEvent.findMany.mock.calls[0]![0]
      expect(query.select).toEqual({
        id: true,
        offlineAt: true,
        cause: true,
        shiftBooking: { select: { startsAt: true, endsAt: true, date: true } },
      })
      expect(query.include).toBeUndefined()
      expect(JSON.stringify(query.select)).not.toMatch(
        /otherCourierId|courierId|followedUp|adminUserId|swap|email|courier"/
      )
    })

    it('returns exactly id, offlineAt, cause and the shift, even if a row carried more', async () => {
      prisma.shiftBookingEvent.findMany.mockResolvedValue([
        {
          id: 'event-1',
          offlineAt: new Date('2026-11-20T19:10:00.000Z'),
          cause: 'RIDER',
          otherCourierId: 'x-other',
          followedUpByUserId: 'x-admin',
          followedUpAt: new Date('2026-11-21T08:00:00.000Z'),
          shiftBooking: {
            startsAt: new Date('2026-11-20T18:00:00.000Z'),
            endsAt: new Date('2026-11-20T22:00:00.000Z'),
            date: '2026-11-20',
            courierId: 'x-courier',
            swapOfferedAt: new Date('2026-11-19T08:00:00.000Z'),
          },
        },
      ])
      const records = await repository.ownOfflineRecords('rider-me', since)
      expect(records).toEqual([
        {
          id: 'event-1',
          offlineAt: new Date('2026-11-20T19:10:00.000Z'),
          cause: 'RIDER',
          shiftStartsAt: new Date('2026-11-20T18:00:00.000Z'),
          shiftEndsAt: new Date('2026-11-20T22:00:00.000Z'),
          shiftDate: '2026-11-20',
        },
      ])
      expect(JSON.stringify(records)).not.toMatch(/x-|followedUp|otherCourierId|swap/)
    })

    it('leaves out a row with no Offline time', async () => {
      prisma.shiftBookingEvent.findMany.mockResolvedValue([
        {
          id: 'no-time',
          offlineAt: null,
          cause: null,
          shiftBooking: { startsAt: now, endsAt: now, date: '2026-11-20' },
        },
      ])
      expect(await repository.ownOfflineRecords('rider-me', since)).toEqual([])
    })
  })
})
