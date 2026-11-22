import { ApiProperty } from '@nestjs/swagger'
import { RemovalReason } from '@prisma/types'

export class RemovalReasonAdminDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ type: String }) label: string
  // Spec 0054 (AC-7): the Greek label, or null; each app shows its reader's language, else the other one.
  @ApiProperty({ type: String, nullable: true }) labelEl: string | null
  @ApiProperty({ type: Boolean }) paidToRider: boolean
  @ApiProperty({ type: Boolean }) chargedToRestaurant: boolean
  @ApiProperty({ type: Boolean }) needsNote: boolean
  @ApiProperty({ type: Number }) position: number
  @ApiProperty({ type: Date, nullable: true }) removedAt: Date | null

  constructor(reason: RemovalReason) {
    this.id = reason.id
    this.label = reason.label
    // Read through a widened type so this compiles before and after the column is generated.
    this.labelEl = (reason as { labelEl?: string | null }).labelEl ?? null
    this.paidToRider = reason.paidToRider
    this.chargedToRestaurant = reason.chargedToRestaurant
    this.needsNote = reason.needsNote
    this.position = reason.position
    this.removedAt = reason.removedAt
  }
}
