import { EnumDispatchStopReason } from '@prisma/types'
import { DispatchStopRepository, ON_AT } from './dispatch-stop.repository'
import { PrismaService } from 'src/services/prisma/prisma.service'

describe('DispatchStopRepository (Spec 0014, AC-2, AC-3, AC-8, AC-11)', () => {
  let repository: DispatchStopRepository
  let mockPrisma: any
  let mockTx: any

  const now = new Date('2026-07-15T10:00:00.000Z')

  beforeEach(() => {
    mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
      dispatchStop: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    }

    mockPrisma = {
      $transaction: jest.fn((callback) => callback(mockTx)),
      dispatchStop: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
    }

    repository = new DispatchStopRepository(mockPrisma as unknown as PrismaService)
  })

  describe('ON_AT rule', () => {
    test('defines an active stop: started, not cancelled, not ended, end null or strictly in future', () => {
      const clause = ON_AT(now)
      expect(clause.startsAt).toEqual({ lte: now })
      expect(clause.cancelledAt).toBeNull()
      expect(clause.endedAt).toBeNull()
      expect(clause.OR).toEqual([{ endsAt: null }, { endsAt: { gt: now } }])
    })

    test('findOn queries using ON_AT and orders newest first', async () => {
      const sampleStop = { id: 'stop-1', reason: EnumDispatchStopReason.HEAT }
      mockPrisma.dispatchStop.findFirst.mockResolvedValue(sampleStop)

      const result = await repository.findOn(now)
      expect(mockPrisma.dispatchStop.findFirst).toHaveBeenCalledWith({
        where: ON_AT(now),
        orderBy: { startsAt: 'desc' },
      })
      expect(result).toBe(sampleStop)
    })
  })

  describe('createIfNoOverlap', () => {
    const input = {
      reason: EnumDispatchStopReason.HEAT,
      startsAt: new Date('2026-07-15T12:00:00.000Z'),
      endsAt: new Date('2026-07-15T17:00:00.000Z'),
      createdByUserId: 'admin-1',
    }

    test('takes advisory lock with $executeRaw (not $queryRaw) inside transaction and creates stop when no overlap (stopNow absent)', async () => {
      mockTx.dispatchStop.findFirst.mockResolvedValue(null)
      const createdStop = { id: 'stop-new', ...input }
      mockTx.dispatchStop.create.mockResolvedValue(createdStop)

      const result = await repository.createIfNoOverlap(input)

      expect(mockPrisma.$transaction).toHaveBeenCalled()
      expect(mockTx.$executeRaw).toHaveBeenCalled()
      expect(mockTx.$queryRaw).not.toHaveBeenCalled()
      expect(mockTx.dispatchStop.findFirst).toHaveBeenCalledWith({
        where: {
          cancelledAt: null,
          endedAt: null,
          startsAt: { lt: input.endsAt },
          OR: [{ endsAt: null }, { endsAt: { gt: input.startsAt } }],
        },
      })
      expect(mockTx.dispatchStop.create).toHaveBeenCalledWith({ data: input })
      expect(result).toBe(createdStop)
    })

    test('with stopNow: true, checks ONLY for a stop ON at data.startsAt (ON_AT rule), taking advisory lock first (Decision 29.6)', async () => {
      mockTx.dispatchStop.findFirst.mockResolvedValue(null)
      const createdStop = { id: 'stop-now-created', ...input }
      mockTx.dispatchStop.create.mockResolvedValue(createdStop)

      const result = await repository.createIfNoOverlap(input, { stopNow: true })

      // Takes advisory lock first inside transaction
      expect(mockPrisma.$transaction).toHaveBeenCalled()
      expect(mockTx.$executeRaw).toHaveBeenCalled()
      expect(mockTx.$queryRaw).not.toHaveBeenCalled()
      // Checks ONLY the ON_AT rule at data.startsAt, NOT the full overlap rule
      expect(mockTx.dispatchStop.findFirst).toHaveBeenCalledWith({
        where: ON_AT(input.startsAt),
      })
      expect(mockTx.dispatchStop.create).toHaveBeenCalledWith({ data: input })
      expect(result).toBe(createdStop)
    })

    test('with stopNow: true, returns null when a stop is already ON at data.startsAt, without creating (Decision 29.6)', async () => {
      mockTx.dispatchStop.findFirst.mockResolvedValue({ id: 'active-stop-now' })

      const result = await repository.createIfNoOverlap(input, { stopNow: true })

      expect(mockTx.$executeRaw).toHaveBeenCalled()
      expect(mockTx.dispatchStop.findFirst).toHaveBeenCalledWith({
        where: ON_AT(input.startsAt),
      })
      expect(mockTx.dispatchStop.create).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    test('with stopNow: false, enforces full overlap rule and takes advisory lock first (Decision 29.6)', async () => {
      // Overlapping stop found in the future scheduled window
      mockTx.dispatchStop.findFirst.mockResolvedValue({ id: 'scheduled-future-stop' })

      const result = await repository.createIfNoOverlap(input, { stopNow: false })

      expect(mockTx.$executeRaw).toHaveBeenCalled()
      expect(mockTx.dispatchStop.findFirst).toHaveBeenCalledWith({
        where: {
          cancelledAt: null,
          endedAt: null,
          startsAt: { lt: input.endsAt },
          OR: [{ endsAt: null }, { endsAt: { gt: input.startsAt } }],
        },
      })
      expect(mockTx.dispatchStop.create).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    test('returns null when an overlapping live stop is found, without creating', async () => {
      mockTx.dispatchStop.findFirst.mockResolvedValue({ id: 'existing-stop' })

      const result = await repository.createIfNoOverlap(input)

      expect(mockTx.$executeRaw).toHaveBeenCalled()
      expect(mockTx.dispatchStop.create).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    test('ignores ended and cancelled stops during overlap check (ensured by where clause)', async () => {
      mockTx.dispatchStop.findFirst.mockResolvedValue(null)
      mockTx.dispatchStop.create.mockResolvedValue({ id: 'stop-new' })

      await repository.createIfNoOverlap({ ...input, endsAt: null })

      expect(mockTx.dispatchStop.findFirst).toHaveBeenCalledWith({
        where: {
          cancelledAt: null,
          endedAt: null,
          OR: [{ endsAt: null }, { endsAt: { gt: input.startsAt } }],
        },
      })
    })
  })

  describe('endOrCancel', () => {
    test('cancels a stop that has not started yet (startsAt > now)', async () => {
      const scheduledStop = {
        id: 'stop-sched',
        startsAt: new Date('2026-07-15T15:00:00.000Z'),
        endsAt: new Date('2026-07-15T18:00:00.000Z'),
        endedAt: null,
        cancelledAt: null,
      }
      mockPrisma.dispatchStop.findUnique
        .mockResolvedValueOnce(scheduledStop)
        .mockResolvedValueOnce({ ...scheduledStop, cancelledAt: now, cancelledByUserId: 'admin-1' })
      mockPrisma.dispatchStop.updateMany.mockResolvedValue({ count: 1 })

      const result = await repository.endOrCancel('stop-sched', now, 'admin-1')

      expect(mockPrisma.dispatchStop.updateMany).toHaveBeenCalledWith({
        where: { id: 'stop-sched', endedAt: null, cancelledAt: null },
        data: { cancelledAt: now, cancelledByUserId: 'admin-1' },
      })
      expect(result?.cancelledAt).toEqual(now)
      expect(result?.cancelledByUserId).toBe('admin-1')
    })

    test('ends a stop that has already started (startsAt <= now)', async () => {
      const activeStop = {
        id: 'stop-active',
        startsAt: new Date('2026-07-15T08:00:00.000Z'),
        endsAt: new Date('2026-07-15T18:00:00.000Z'),
        endedAt: null,
        cancelledAt: null,
      }
      mockPrisma.dispatchStop.findUnique
        .mockResolvedValueOnce(activeStop)
        .mockResolvedValueOnce({ ...activeStop, endedAt: now, endedByUserId: 'admin-1' })
      mockPrisma.dispatchStop.updateMany.mockResolvedValue({ count: 1 })

      const result = await repository.endOrCancel('stop-active', now, 'admin-1')

      expect(mockPrisma.dispatchStop.updateMany).toHaveBeenCalledWith({
        where: { id: 'stop-active', endedAt: null, cancelledAt: null },
        data: { endedAt: now, endedByUserId: 'admin-1' },
      })
      expect(result?.endedAt).toEqual(now)
      expect(result?.endedByUserId).toBe('admin-1')
    })

    test('returns null the second time if already ended or cancelled', async () => {
      // First check: stop already has endedAt
      mockPrisma.dispatchStop.findUnique.mockResolvedValueOnce({
        id: 'stop-ended',
        startsAt: new Date('2026-07-15T08:00:00.000Z'),
        endedAt: new Date('2026-07-15T09:00:00.000Z'),
        cancelledAt: null,
      })

      const result1 = await repository.endOrCancel('stop-ended', now, 'admin-1')
      expect(result1).toBeNull()
      expect(mockPrisma.dispatchStop.updateMany).not.toHaveBeenCalled()

      // Race condition: findUnique showed not ended, but updateMany returned 0
      mockPrisma.dispatchStop.findUnique.mockResolvedValueOnce({
        id: 'stop-race',
        startsAt: new Date('2026-07-15T08:00:00.000Z'),
        endedAt: null,
        cancelledAt: null,
      })
      mockPrisma.dispatchStop.updateMany.mockResolvedValueOnce({ count: 0 })

      const result2 = await repository.endOrCancel('stop-race', now, 'admin-1')
      expect(result2).toBeNull()
    })

    test('returns null for a stop whose endsAt has passed (it already ended by itself) (row 29 review)', async () => {
      // Natural end has already passed (endsAt 09:30 <= now 10:00)
      const naturallyEndedStop = {
        id: 'stop-passed',
        startsAt: new Date('2026-07-15T08:00:00.000Z'),
        endsAt: new Date('2026-07-15T09:30:00.000Z'),
        endedAt: null,
        cancelledAt: null,
      }
      mockPrisma.dispatchStop.findUnique.mockResolvedValueOnce(naturallyEndedStop)

      const result = await repository.endOrCancel('stop-passed', now, 'admin-1')

      expect(result).toBeNull()
      expect(mockPrisma.dispatchStop.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('markStarted and markEndWorkDone', () => {
    test('markStarted succeeds once and returns false if already marked', async () => {
      mockPrisma.dispatchStop.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })

      const first = await repository.markStarted('stop-1', now)
      const second = await repository.markStarted('stop-1', now)

      expect(first).toBe(true)
      expect(second).toBe(false)
      expect(mockPrisma.dispatchStop.updateMany).toHaveBeenCalledWith({
        where: { id: 'stop-1', startedAt: null },
        data: { startedAt: now },
      })
    })

    test('markEndWorkDone succeeds once and returns false if already marked', async () => {
      mockPrisma.dispatchStop.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })

      const first = await repository.markEndWorkDone('stop-1', now)
      const second = await repository.markEndWorkDone('stop-1', now)

      expect(first).toBe(true)
      expect(second).toBe(false)
      expect(mockPrisma.dispatchStop.updateMany).toHaveBeenCalledWith({
        where: { id: 'stop-1', endWorkDoneAt: null },
        data: { endWorkDoneAt: now },
      })
    })
  })

  describe('findDueToStart and findDueToEnd', () => {
    test('findDueToStart finds stops matching ON_AT with startedAt null', async () => {
      mockPrisma.dispatchStop.findMany.mockResolvedValue([])
      await repository.findDueToStart(now)

      expect(mockPrisma.dispatchStop.findMany).toHaveBeenCalledWith({
        where: {
          ...ON_AT(now),
          startedAt: null,
        },
      })
    })

    test('findDueToEnd finds stops whose end work is due', async () => {
      mockPrisma.dispatchStop.findMany.mockResolvedValue([])
      await repository.findDueToEnd(now)

      expect(mockPrisma.dispatchStop.findMany).toHaveBeenCalledWith({
        where: {
          endWorkDoneAt: null,
          cancelledAt: null,
          startsAt: { lte: now },
          OR: [{ endedAt: { not: null } }, { endsAt: { lte: now } }],
        },
      })
    })
  })
})
