import { ApiProperty } from '@nestjs/swagger'
import { RemovalReason } from '@prisma/types'

export class RemovalReasonAdminDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ type: String }) label: string
  @ApiProperty({ type: Boolean }) paidToRider: boolean
  @ApiProperty({ type: Boolean }) chargedToRestaurant: boolean
  @ApiProperty({ type: Boolean }) needsNote: boolean
  @ApiProperty({ type: Number }) position: number
  @ApiProperty({ type: Date, nullable: true }) removedAt: Date | null

  constructor(reason: RemovalReason) {
    this.id = reason.id
    this.label = reason.label
    this.paidToRider = reason.paidToRider
    this.chargedToRestaurant = reason.chargedToRestaurant
    this.needsNote = reason.needsNote
    this.position = reason.position
    this.removedAt = reason.removedAt
  }
}
