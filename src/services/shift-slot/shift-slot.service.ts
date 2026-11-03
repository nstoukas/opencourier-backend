import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ShiftSlot, ShiftSlotChange } from '@prisma/types'
import { ShiftSlotFields, ShiftSlotRepository, slotFields } from 'src/persistence/repositories/shift-slot.repository'

const NOT_FOUND = 'This shift slot does not exist or was removed.'
const CHANGED = 'This slot just changed. Look again.'

// Spec 0026 (row 77): the co-op's weekly shift slots, admin only. Nothing outside admin reads them in
// this row, so with Shifts off (and on, until rows 78 and 79) they change nothing for riders (AC-7).
@Injectable()
export class ShiftSlotService {
  constructor(private readonly shiftSlotRepository: ShiftSlotRepository) {}

  async list(includeRemoved: boolean): Promise<ShiftSlot[]> {
    return this.shiftSlotRepository.list(includeRemoved)
  }

  async create(fields: ShiftSlotFields, adminId: string): Promise<ShiftSlot> {
    const slot = slotFields(fields)
    refuseIfEndNotAfterStart(slot)
    return this.shiftSlotRepository.create(slot, adminId)
  }

  // Merges the fields sent onto the stored slot and checks the whole (AC-4). Nothing changed: the
  // stored slot, no write and no change row (a no op, `PATCH {}` included).
  async update(id: string, fields: Partial<ShiftSlotFields>, adminId: string): Promise<ShiftSlot> {
    const stored = await this.currentOrThrow(id)
    const read = slotFields(stored)
    const next: ShiftSlotFields = {
      weekday: fields.weekday ?? read.weekday,
      startMinute: fields.startMinute ?? read.startMinute,
      endMinute: fields.endMinute ?? read.endMinute,
      riderCap: fields.riderCap ?? read.riderCap,
    }
    refuseIfEndNotAfterStart(next)
    if (sameFields(read, next)) return stored
    const updated = await this.shiftSlotRepository.updateIfUnchanged(id, read, next, adminId)
    if (!updated) throw new ConflictException(CHANGED)
    return updated
  }

  async remove(id: string, adminId: string): Promise<ShiftSlot> {
    const stored = await this.currentOrThrow(id)
    const removed = await this.shiftSlotRepository.removeIfUnchanged(id, slotFields(stored), adminId)
    if (!removed) throw new ConflictException(CHANGED)
    return removed
  }

  // A removed slot's record is still there to read (its REMOVED row is the point); only an unknown id is 404.
  async changes(id: string): Promise<ShiftSlotChange[]> {
    const slot = await this.shiftSlotRepository.findById(id)
    if (!slot) throw new NotFoundException(NOT_FOUND)
    return this.shiftSlotRepository.changes(id)
  }

  private async currentOrThrow(id: string): Promise<ShiftSlot> {
    const slot = await this.shiftSlotRepository.findById(id)
    if (!slot || slot.removedAt) throw new NotFoundException(NOT_FOUND)
    return slot
  }
}

function refuseIfEndNotAfterStart(slot: ShiftSlotFields) {
  if (slot.endMinute <= slot.startMinute) {
    throw new BadRequestException('The end must be after the start, on the same day. Two slots can cover a late night.')
  }
}

function sameFields(a: ShiftSlotFields, b: ShiftSlotFields): boolean {
  return a.weekday === b.weekday && a.startMinute === b.startMinute && a.endMinute === b.endMinute && a.riderCap === b.riderCap
}
