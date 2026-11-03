import { EnumShiftSlotChangeAction, Prisma } from '@prisma/types'
import { PrismaService } from 'src/services/prisma/prisma.service'
import { ShiftSlotRepository, slotFields } from './shift-slot.repository'

// Spec 0026 (row 77, AC-2, AC-3): slot writes and their change rows, with Prisma mocked (no test here
// runs SQL against a database). The transaction mock records which client each call went through, so
// a change row written outside the transaction (on the root client) shows up as a failure.
describe('ShiftSlotRepository (spec 0026, AC-2, AC-3)', () => {
  let repository: ShiftSlotRepository
  let mockPrisma: any
  let mockTx: any

  const ADMIN = 'admin-user-1'
  const fields = { weekday: 5, startMinute: 1140, endMinute: 1380, riderCap: 6 }
  const slotRow = {
    id: 'slot-1',
    ...fields,
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
    removedAt: null,
  }

  const modelMock = () => ({
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  })

  beforeEach(() => {
    mockTx = {
      shiftSlot: modelMock(),
      shiftSlotChange: modelMock(),
    }
    mockPrisma = {
      $transaction: jest.fn((callback) => callback(mockTx)),
      shiftSlot: modelMock(),
      shiftSlotChange: modelMock(),
    }
    repository = new ShiftSlotRepository(mockPrisma as unknown as PrismaService)
  })

  const expectNoRootWrites = () => {
    for (const model of [mockPrisma.shiftSlot, mockPrisma.shiftSlotChange]) {
      expect(model.create).not.toHaveBeenCalled()
      expect(model.updateMany).not.toHaveBeenCalled()
      expect(model.update).not.toHaveBeenCalled()
    }
  }

  describe('slotFields', () => {
    it('keeps the four slot fields and nothing else', () => {
      expect(slotFields(slotRow)).toEqual(fields)
    })
  })

  describe('list', () => {
    it('lists only current slots (removedAt null), by weekday, then start, then createdAt', async () => {
      mockPrisma.shiftSlot.findMany.mockResolvedValue([slotRow])
      const result = await repository.list(false)
      expect(result).toEqual([slotRow])
      expect(mockPrisma.shiftSlot.findMany).toHaveBeenCalledWith({
        where: { removedAt: null },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }, { createdAt: 'asc' }],
      })
    })

    it('lists removed slots too when includeRemoved is true, in the same order', async () => {
      mockPrisma.shiftSlot.findMany.mockResolvedValue([])
      await repository.list(true)
      expect(mockPrisma.shiftSlot.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }, { createdAt: 'asc' }],
      })
    })
  })

  describe('findById', () => {
    it('finds by id whatever removedAt is (the service decides)', async () => {
      mockPrisma.shiftSlot.findUnique.mockResolvedValue(slotRow)
      expect(await repository.findById('slot-1')).toBe(slotRow)
      expect(mockPrisma.shiftSlot.findUnique).toHaveBeenCalledWith({ where: { id: 'slot-1' } })
    })
  })

  describe('create', () => {
    it('writes the slot and a CREATED change (before JsonNull, after the four fields) in one $transaction', async () => {
      mockTx.shiftSlot.create.mockResolvedValue(slotRow)

      const result = await repository.create(fields, ADMIN)

      expect(result).toBe(slotRow)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
      expect(mockTx.shiftSlot.create).toHaveBeenCalledWith({ data: fields })
      expect(mockTx.shiftSlotChange.create).toHaveBeenCalledTimes(1)
      expect(mockTx.shiftSlotChange.create).toHaveBeenCalledWith({
        data: {
          shiftSlotId: 'slot-1',
          action: EnumShiftSlotChangeAction.CREATED,
          changedByUserId: ADMIN,
          before: Prisma.JsonNull,
          after: fields,
        },
      })
      expectNoRootWrites()
    })

    it('writes the change row after the slot (it needs the new id)', async () => {
      mockTx.shiftSlot.create.mockResolvedValue(slotRow)
      await repository.create(fields, ADMIN)
      expect(mockTx.shiftSlot.create.mock.invocationCallOrder[0]).toBeLessThan(
        mockTx.shiftSlotChange.create.mock.invocationCallOrder[0]
      )
    })

    it('after holds exactly the four fields, even if more are passed in', async () => {
      mockTx.shiftSlot.create.mockResolvedValue(slotRow)
      await repository.create(fields, ADMIN)
      const after = mockTx.shiftSlotChange.create.mock.calls[0][0].data.after
      expect(Object.keys(after).sort()).toEqual(['endMinute', 'riderCap', 'startMinute', 'weekday'])
    })
  })

  describe('updateIfUnchanged', () => {
    const next = { ...fields, riderCap: 8 }

    it('uses updateMany conditional on { id, removedAt: null, ...read } and writes UPDATED with before and after', async () => {
      mockTx.shiftSlot.updateMany.mockResolvedValue({ count: 1 })
      const updated = { ...slotRow, riderCap: 8 }
      mockTx.shiftSlot.findUnique.mockResolvedValue(updated)

      const result = await repository.updateIfUnchanged('slot-1', fields, next, ADMIN)

      expect(result).toBe(updated)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
      expect(mockTx.shiftSlot.updateMany).toHaveBeenCalledWith({
        where: { id: 'slot-1', removedAt: null, ...fields },
        data: next,
      })
      expect(mockTx.shiftSlotChange.create).toHaveBeenCalledTimes(1)
      expect(mockTx.shiftSlotChange.create).toHaveBeenCalledWith({
        data: {
          shiftSlotId: 'slot-1',
          action: EnumShiftSlotChangeAction.UPDATED,
          changedByUserId: ADMIN,
          before: fields,
          after: next,
        },
      })
      expect(mockTx.shiftSlot.findUnique).toHaveBeenCalledWith({ where: { id: 'slot-1' } })
      expectNoRootWrites()
    })

    it('with a count of 0 (changed, removed or gone) writes no change row and returns null', async () => {
      mockTx.shiftSlot.updateMany.mockResolvedValue({ count: 0 })

      const result = await repository.updateIfUnchanged('slot-1', fields, next, ADMIN)

      expect(result).toBeNull()
      expect(mockTx.shiftSlotChange.create).not.toHaveBeenCalled()
      expect(mockPrisma.shiftSlotChange.create).not.toHaveBeenCalled()
    })
  })

  describe('removeIfUnchanged', () => {
    it('sets removedAt conditional on { id, removedAt: null, ...read } and writes REMOVED (after JsonNull)', async () => {
      mockTx.shiftSlot.updateMany.mockResolvedValue({ count: 1 })
      const removed = { ...slotRow, removedAt: new Date('2026-11-03T08:00:00.000Z') }
      mockTx.shiftSlot.findUnique.mockResolvedValue(removed)

      const result = await repository.removeIfUnchanged('slot-1', fields, ADMIN)

      expect(result).toBe(removed)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
      expect(mockTx.shiftSlot.updateMany).toHaveBeenCalledWith({
        where: { id: 'slot-1', removedAt: null, ...fields },
        data: { removedAt: expect.any(Date) },
      })
      expect(mockTx.shiftSlotChange.create).toHaveBeenCalledTimes(1)
      expect(mockTx.shiftSlotChange.create).toHaveBeenCalledWith({
        data: {
          shiftSlotId: 'slot-1',
          action: EnumShiftSlotChangeAction.REMOVED,
          changedByUserId: ADMIN,
          before: fields,
          after: Prisma.JsonNull,
        },
      })
      expectNoRootWrites()
    })

    it('never deletes the row (soft removal keeps the slot and its record)', async () => {
      mockTx.shiftSlot.updateMany.mockResolvedValue({ count: 1 })
      mockTx.shiftSlot.delete = jest.fn()
      mockTx.shiftSlot.deleteMany = jest.fn()
      await repository.removeIfUnchanged('slot-1', fields, ADMIN)
      expect(mockTx.shiftSlot.delete).not.toHaveBeenCalled()
      expect(mockTx.shiftSlot.deleteMany).not.toHaveBeenCalled()
      const data = mockTx.shiftSlot.updateMany.mock.calls[0][0].data
      expect(Object.keys(data)).toEqual(['removedAt'])
    })

    it('with a count of 0 writes no change row and returns null', async () => {
      mockTx.shiftSlot.updateMany.mockResolvedValue({ count: 0 })

      const result = await repository.removeIfUnchanged('slot-1', fields, ADMIN)

      expect(result).toBeNull()
      expect(mockTx.shiftSlotChange.create).not.toHaveBeenCalled()
      expect(mockPrisma.shiftSlotChange.create).not.toHaveBeenCalled()
    })
  })

  describe('changes', () => {
    it('lists one slot changes newest first', async () => {
      const rows = [{ id: 'c2' }, { id: 'c1' }]
      mockPrisma.shiftSlotChange.findMany.mockResolvedValue(rows)
      expect(await repository.changes('slot-1')).toBe(rows)
      expect(mockPrisma.shiftSlotChange.findMany).toHaveBeenCalledWith({
        where: { shiftSlotId: 'slot-1' },
        orderBy: { createdAt: 'desc' },
      })
    })
  })
})
