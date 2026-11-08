import { Injectable } from '@nestjs/common'
import { EnumShiftSlotChangeAction, Prisma, ShiftSlot, ShiftSlotChange } from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

// The four fields an admin sets on a slot (spec 0026), and all a change row's before and after hold.
export interface ShiftSlotFields {
  weekday: number
  startMinute: number
  endMinute: number
  riderCap: number
}

export function slotFields(slot: ShiftSlotFields): ShiftSlotFields {
  return { weekday: slot.weekday, startMinute: slot.startMinute, endMinute: slot.endMinute, riderCap: slot.riderCap }
}

// Spec 0026 (row 77): weekly shift slots and their record. Every write and its ShiftSlotChange row
// commit in one transaction (AC-3); an edit or a removal is conditional on the fields it read, so two
// admins at once cannot leave a wrong "before" (the updateIfMatches pattern).
@Injectable()
export class ShiftSlotRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  // By weekday, then start. Removed slots only when asked for (the page's "Show removed slots").
  async list(includeRemoved: boolean): Promise<ShiftSlot[]> {
    return this.prisma.shiftSlot.findMany({
      where: includeRemoved ? {} : { removedAt: null },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }, { createdAt: 'asc' }],
    })
  }

  async findById(id: string): Promise<ShiftSlot | null> {
    return this.prisma.shiftSlot.findUnique({ where: { id } })
  }

  async create(fields: ShiftSlotFields, changedByUserId: string): Promise<ShiftSlot> {
    return this.prisma.$transaction(async (tx) => {
      const slot = await tx.shiftSlot.create({ data: fields })
      await tx.shiftSlotChange.create({
        data: {
          shiftSlotId: slot.id,
          action: EnumShiftSlotChangeAction.CREATED,
          changedByUserId,
          // DbNull is SQL NULL, so `WHERE "before" IS NULL` finds a creation (row 77 review).
          before: Prisma.DbNull,
          after: { ...fields },
        },
      })
      return slot
    })
  }

  // Null when the slot is gone, removed, or no longer has the fields `read` (another admin changed it).
  async updateIfUnchanged(
    id: string,
    read: ShiftSlotFields,
    next: ShiftSlotFields,
    changedByUserId: string
  ): Promise<ShiftSlot | null> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.shiftSlot.updateMany({ where: { id, removedAt: null, ...read }, data: next })
      if (count === 0) return null
      await tx.shiftSlotChange.create({
        data: {
          shiftSlotId: id,
          action: EnumShiftSlotChangeAction.UPDATED,
          changedByUserId,
          before: { ...read },
          after: { ...next },
        },
      })
      return tx.shiftSlot.findUnique({ where: { id } })
    })
  }

  // The same, for a removal: the slot stays, with removedAt set.
  async removeIfUnchanged(id: string, read: ShiftSlotFields, changedByUserId: string): Promise<ShiftSlot | null> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.shiftSlot.updateMany({
        where: { id, removedAt: null, ...read },
        data: { removedAt: new Date() },
      })
      if (count === 0) return null
      await tx.shiftSlotChange.create({
        data: {
          shiftSlotId: id,
          action: EnumShiftSlotChangeAction.REMOVED,
          changedByUserId,
          before: { ...read },
          after: Prisma.DbNull,
        },
      })
      return tx.shiftSlot.findUnique({ where: { id } })
    })
  }

  // Newest first (AC-3).
  async changes(shiftSlotId: string): Promise<ShiftSlotChange[]> {
    // `id` breaks a tie between two changes in the same millisecond, so the order is always the same.
    return this.prisma.shiftSlotChange.findMany({
      where: { shiftSlotId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
  }
}
