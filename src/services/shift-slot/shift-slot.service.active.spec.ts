import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { ShiftSlot } from '@prisma/types'
import { ShiftSlotRepository } from 'src/persistence/repositories/shift-slot.repository'
import { ShiftSlotService } from './shift-slot.service'

// Spec 0026 (row 77): the shift slot service's rules, with the repository mocked.
describe('ShiftSlotService (spec 0026, AC-2 to AC-4)', () => {
  let service: ShiftSlotService
  let repository: jest.Mocked<
    Pick<ShiftSlotRepository, 'list' | 'findById' | 'create' | 'updateIfUnchanged' | 'removeIfUnchanged' | 'changes'>
  >

  const ADMIN = 'admin-user-1'
  const END_SENTENCE = 'The end must be after the start, on the same day. Two slots can cover a late night.'
  const CHANGED = 'This slot just changed. Look again.'

  // Friday 19:00 to 23:00, 6 riders.
  const stored: ShiftSlot = {
    id: 'slot-1',
    weekday: 5,
    startMinute: 1140,
    endMinute: 1380,
    riderCap: 6,
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
    removedAt: null,
  }
  const storedFields = { weekday: 5, startMinute: 1140, endMinute: 1380, riderCap: 6 }

  beforeEach(() => {
    repository = {
      list: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      updateIfUnchanged: jest.fn(),
      removeIfUnchanged: jest.fn(),
      changes: jest.fn(),
    }
    service = new ShiftSlotService(repository as unknown as ShiftSlotRepository)
  })

  describe('list', () => {
    it('passes includeRemoved through to the repository', async () => {
      repository.list.mockResolvedValue([stored])
      expect(await service.list(false)).toEqual([stored])
      expect(repository.list).toHaveBeenLastCalledWith(false)
      await service.list(true)
      expect(repository.list).toHaveBeenLastCalledWith(true)
    })
  })

  describe('create', () => {
    it('creates a valid slot with the admin id, passing only the four fields', async () => {
      repository.create.mockResolvedValue(stored)
      const result = await service.create({ ...storedFields, extra: 'ignored' } as any, ADMIN)
      expect(result).toBe(stored)
      expect(repository.create).toHaveBeenCalledWith(storedFields, ADMIN)
    })

    it('accepts an end of 1440 (24:00) after a late start', async () => {
      repository.create.mockResolvedValue(stored)
      await service.create({ weekday: 5, startMinute: 1320, endMinute: 1440, riderCap: 2 }, ADMIN)
      expect(repository.create).toHaveBeenCalledWith({ weekday: 5, startMinute: 1320, endMinute: 1440, riderCap: 2 }, ADMIN)
    })

    it('refuses an end equal to the start with 400 and writes nothing', async () => {
      const promise = service.create({ weekday: 5, startMinute: 600, endMinute: 600, riderCap: 3 }, ADMIN)
      await expect(promise).rejects.toBeInstanceOf(BadRequestException)
      await expect(promise).rejects.toThrow(END_SENTENCE)
      expect(repository.create).not.toHaveBeenCalled()
    })

    it('refuses an end before the start (a slot crossing midnight) with 400 and writes nothing', async () => {
      const promise = service.create({ weekday: 5, startMinute: 1320, endMinute: 120, riderCap: 3 }, ADMIN)
      await expect(promise).rejects.toBeInstanceOf(BadRequestException)
      await expect(promise).rejects.toThrow(END_SENTENCE)
      expect(repository.create).not.toHaveBeenCalled()
    })
  })

  describe('update', () => {
    it('merges the sent fields onto the stored slot and writes conditional on what it read', async () => {
      repository.findById.mockResolvedValue(stored)
      const updated = { ...stored, riderCap: 8 }
      repository.updateIfUnchanged.mockResolvedValue(updated)

      const result = await service.update('slot-1', { riderCap: 8 }, ADMIN)

      expect(result).toBe(updated)
      expect(repository.updateIfUnchanged).toHaveBeenCalledWith(
        'slot-1',
        storedFields,
        { ...storedFields, riderCap: 8 },
        ADMIN
      )
    })

    it('checks the merged whole: only an end sent, before the stored start, is refused with 400', async () => {
      repository.findById.mockResolvedValue(stored)
      // 18:00 is before the stored 19:00 start; the end alone is a fine minute.
      const promise = service.update('slot-1', { endMinute: 1080 }, ADMIN)
      await expect(promise).rejects.toBeInstanceOf(BadRequestException)
      await expect(promise).rejects.toThrow(END_SENTENCE)
      expect(repository.updateIfUnchanged).not.toHaveBeenCalled()
    })

    it('checks the merged whole: only a start sent, at or after the stored end, is refused with 400', async () => {
      repository.findById.mockResolvedValue(stored)
      const promise = service.update('slot-1', { startMinute: 1380 }, ADMIN)
      await expect(promise).rejects.toThrow(END_SENTENCE)
      expect(repository.updateIfUnchanged).not.toHaveBeenCalled()
    })

    it('accepts a start and end that are only valid together (both moved past the stored end)', async () => {
      repository.findById.mockResolvedValue(stored)
      repository.updateIfUnchanged.mockResolvedValue(stored)
      await service.update('slot-1', { startMinute: 1390, endMinute: 1440 }, ADMIN)
      expect(repository.updateIfUnchanged).toHaveBeenCalledWith(
        'slot-1',
        storedFields,
        { ...storedFields, startMinute: 1390, endMinute: 1440 },
        ADMIN
      )
    })

    it('a no op edit ({}) returns the stored slot and calls no write', async () => {
      repository.findById.mockResolvedValue(stored)
      const result = await service.update('slot-1', {}, ADMIN)
      expect(result).toBe(stored)
      expect(repository.updateIfUnchanged).not.toHaveBeenCalled()
      expect(repository.removeIfUnchanged).not.toHaveBeenCalled()
      expect(repository.create).not.toHaveBeenCalled()
    })

    it('an edit sending the same four values returns the stored slot and calls no write', async () => {
      repository.findById.mockResolvedValue(stored)
      const result = await service.update('slot-1', { ...storedFields }, ADMIN)
      expect(result).toBe(stored)
      expect(repository.updateIfUnchanged).not.toHaveBeenCalled()
    })

    it('an edit sending one unchanged value returns the stored slot and calls no write', async () => {
      repository.findById.mockResolvedValue(stored)
      expect(await service.update('slot-1', { riderCap: 6 }, ADMIN)).toBe(stored)
      expect(repository.updateIfUnchanged).not.toHaveBeenCalled()
    })

    it('answers 404 for an unknown slot and writes nothing', async () => {
      repository.findById.mockResolvedValue(null)
      const promise = service.update('nope', { riderCap: 2 }, ADMIN)
      await expect(promise).rejects.toBeInstanceOf(NotFoundException)
      expect(repository.updateIfUnchanged).not.toHaveBeenCalled()
    })

    it('answers 404 for a removed slot and writes nothing', async () => {
      repository.findById.mockResolvedValue({ ...stored, removedAt: new Date('2026-11-02T10:00:00.000Z') })
      const promise = service.update('slot-1', { riderCap: 2 }, ADMIN)
      await expect(promise).rejects.toBeInstanceOf(NotFoundException)
      expect(repository.updateIfUnchanged).not.toHaveBeenCalled()
    })

    it('answers 404 for a removed slot even on a no op edit', async () => {
      repository.findById.mockResolvedValue({ ...stored, removedAt: new Date('2026-11-02T10:00:00.000Z') })
      await expect(service.update('slot-1', {}, ADMIN)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('answers 409 "This slot just changed. Look again." when the conditional write is lost', async () => {
      repository.findById.mockResolvedValue(stored)
      repository.updateIfUnchanged.mockResolvedValue(null)
      const promise = service.update('slot-1', { riderCap: 9 }, ADMIN)
      await expect(promise).rejects.toBeInstanceOf(ConflictException)
      await expect(promise).rejects.toThrow(CHANGED)
    })
  })

  describe('remove', () => {
    it('removes conditional on the stored four fields, with the admin id, and returns the removed slot', async () => {
      repository.findById.mockResolvedValue(stored)
      const removed = { ...stored, removedAt: new Date('2026-11-03T08:00:00.000Z') }
      repository.removeIfUnchanged.mockResolvedValue(removed)

      expect(await service.remove('slot-1', ADMIN)).toBe(removed)
      expect(repository.removeIfUnchanged).toHaveBeenCalledWith('slot-1', storedFields, ADMIN)
    })

    it('answers 404 for an unknown slot', async () => {
      repository.findById.mockResolvedValue(null)
      await expect(service.remove('nope', ADMIN)).rejects.toBeInstanceOf(NotFoundException)
      expect(repository.removeIfUnchanged).not.toHaveBeenCalled()
    })

    it('answers 404 for a slot already removed (never removed twice)', async () => {
      repository.findById.mockResolvedValue({ ...stored, removedAt: new Date('2026-11-02T10:00:00.000Z') })
      await expect(service.remove('slot-1', ADMIN)).rejects.toBeInstanceOf(NotFoundException)
      expect(repository.removeIfUnchanged).not.toHaveBeenCalled()
    })

    it('answers 409 "This slot just changed. Look again." when the conditional removal is lost', async () => {
      repository.findById.mockResolvedValue(stored)
      repository.removeIfUnchanged.mockResolvedValue(null)
      const promise = service.remove('slot-1', ADMIN)
      await expect(promise).rejects.toBeInstanceOf(ConflictException)
      await expect(promise).rejects.toThrow(CHANGED)
    })
  })

  describe('changes', () => {
    const changeRows = [{ id: 'c2' }, { id: 'c1' }] as any

    it('returns the record of a current slot', async () => {
      repository.findById.mockResolvedValue(stored)
      repository.changes.mockResolvedValue(changeRows)
      expect(await service.changes('slot-1')).toBe(changeRows)
      expect(repository.changes).toHaveBeenCalledWith('slot-1')
    })

    it('returns the record of a removed slot (its REMOVED row is the point), not 404', async () => {
      repository.findById.mockResolvedValue({ ...stored, removedAt: new Date('2026-11-02T10:00:00.000Z') })
      repository.changes.mockResolvedValue(changeRows)
      await expect(service.changes('slot-1')).resolves.toBe(changeRows)
    })

    it('answers 404 for an unknown id', async () => {
      repository.findById.mockResolvedValue(null)
      await expect(service.changes('nope')).rejects.toBeInstanceOf(NotFoundException)
      await expect(service.changes('nope')).rejects.toThrow(/^This shift slot does not exist\.$/)
      expect(repository.changes).not.toHaveBeenCalled()
    })
  })
})
