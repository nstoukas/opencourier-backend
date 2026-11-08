import { ApiProperty } from '@nestjs/swagger'
import { EnumShiftSlotChangeAction, ShiftSlot, ShiftSlotChange } from '@prisma/types'

// A weekly shift slot as admin sees it (spec 0026).
export class ShiftSlotAdminDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ type: Number, description: 'ISO weekday: 1 Monday to 7 Sunday' }) weekday: number
  @ApiProperty({ type: Number }) startMinute: number
  @ApiProperty({ type: Number }) endMinute: number
  @ApiProperty({ type: Number }) riderCap: number
  @ApiProperty({ type: Date }) createdAt: Date
  @ApiProperty({ type: Date }) updatedAt: Date
  @ApiProperty({ type: Date, nullable: true }) removedAt: Date | null

  constructor(slot: ShiftSlot) {
    this.id = slot.id
    this.weekday = slot.weekday
    this.startMinute = slot.startMinute
    this.endMinute = slot.endMinute
    this.riderCap = slot.riderCap
    this.createdAt = slot.createdAt
    this.updatedAt = slot.updatedAt
    this.removedAt = slot.removedAt
  }
}

// One entry of a slot's record (AC-3): before and after hold the four slot fields only.
export class ShiftSlotChangeAdminDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ enum: EnumShiftSlotChangeAction }) action: EnumShiftSlotChangeAction
  @ApiProperty({ type: String }) changedByUserId: string
  @ApiProperty({ type: Object, nullable: true }) before: unknown
  @ApiProperty({ type: Object, nullable: true }) after: unknown
  @ApiProperty({ type: Date }) createdAt: Date

  constructor(change: ShiftSlotChange) {
    this.id = change.id
    this.action = change.action
    this.changedByUserId = change.changedByUserId
    this.before = change.before
    this.after = change.after
    this.createdAt = change.createdAt
  }
}
