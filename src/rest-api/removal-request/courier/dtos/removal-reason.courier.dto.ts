import { ApiProperty } from '@nestjs/swagger'
import { RemovalReason } from '@prisma/types'

// What a rider sees of a reason: whether it pays, never whether the restaurant is billed.
export class RemovalReasonCourierDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ type: String }) label: string
  // Spec 0054 (AC-7): the Greek label, or null; each app shows its reader's language, else the other one.
  @ApiProperty({ type: String, nullable: true }) labelEl: string | null
  @ApiProperty({ type: Boolean }) paid: boolean
  @ApiProperty({ type: Boolean }) needsNote: boolean

  constructor(reason: RemovalReason) {
    this.id = reason.id
    this.label = reason.label
    // Read through a widened type so this compiles before and after the column is generated.
    this.labelEl = (reason as { labelEl?: string | null }).labelEl ?? null
    this.paid = reason.paidToRider
    this.needsNote = reason.needsNote
  }
}
