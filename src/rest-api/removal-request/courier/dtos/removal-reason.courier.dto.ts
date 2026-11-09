import { ApiProperty } from '@nestjs/swagger'
import { RemovalReason } from '@prisma/types'

// What a rider sees of a reason: whether it pays, never whether the restaurant is billed.
export class RemovalReasonCourierDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ type: String }) label: string
  @ApiProperty({ type: Boolean }) paid: boolean
  @ApiProperty({ type: Boolean }) needsNote: boolean

  constructor(reason: RemovalReason) {
    this.id = reason.id
    this.label = reason.label
    this.paid = reason.paidToRider
    this.needsNote = reason.needsNote
  }
}
