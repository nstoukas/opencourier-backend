import { ApiProperty } from '@nestjs/swagger'

// Spec 0029, AC-7: a restaurant's busy mode, pause and disable, as it sees them.
export class PartnerAvailabilityPartnerDto {
  @ApiProperty({ type: Number, nullable: true })
  busyExtraMinutes: number | null

  // Null when no pause is in force, so an expired pause reads as null.
  @ApiProperty({ type: Date, nullable: true })
  pausedUntil: Date | null

  @ApiProperty({ type: Date, nullable: true })
  disabledAt: Date | null

  @ApiProperty({ type: String, nullable: true })
  disabledReason: string | null

  @ApiProperty({ type: Boolean })
  acceptingOrders: boolean

  // AC-4's sentence, null while the restaurant is accepting orders.
  @ApiProperty({ type: String, nullable: true })
  notAcceptingReason: string | null

  constructor(data: PartnerAvailabilityPartnerDto) {
    this.busyExtraMinutes = data.busyExtraMinutes
    this.pausedUntil = data.pausedUntil
    this.disabledAt = data.disabledAt
    this.disabledReason = data.disabledReason
    this.acceptingOrders = data.acceptingOrders
    this.notAcceptingReason = data.notAcceptingReason
  }
}
