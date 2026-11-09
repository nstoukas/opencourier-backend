import { ApiProperty } from '@nestjs/swagger'
import { EnumPartnerAvailabilityAction, EnumUserRole } from '@prisma/types'

// Spec 0029, AC-7: a restaurant's busy mode, pause and disable, as an admin sees them.
export class PartnerAvailabilityAdminDto {
  @ApiProperty({ type: Number, nullable: true })
  busyExtraMinutes: number | null

  @ApiProperty({ type: Date, nullable: true })
  pausedUntil: Date | null

  @ApiProperty({ type: Date, nullable: true })
  disabledAt: Date | null

  @ApiProperty({ type: String, nullable: true })
  disabledReason: string | null

  @ApiProperty({ type: Boolean })
  acceptingOrders: boolean

  @ApiProperty({ type: String, nullable: true })
  notAcceptingReason: string | null

  constructor(data: PartnerAvailabilityAdminDto) {
    this.busyExtraMinutes = data.busyExtraMinutes
    this.pausedUntil = data.pausedUntil
    this.disabledAt = data.disabledAt
    this.disabledReason = data.disabledReason
    this.acceptingOrders = data.acceptingOrders
    this.notAcceptingReason = data.notAcceptingReason
  }
}

// Spec 0029, AC-9: one line of the restaurant's availability history.
export class PartnerAvailabilityChangeAdminDto {
  @ApiProperty({ type: String })
  id: string

  @ApiProperty({ enum: EnumPartnerAvailabilityAction })
  action: EnumPartnerAvailabilityAction

  @ApiProperty({ enum: EnumUserRole })
  actorRole: EnumUserRole

  @ApiProperty({ type: String, nullable: true })
  actorEmail: string | null

  @ApiProperty({ type: Number, nullable: true })
  extraMinutes: number | null

  @ApiProperty({ type: Date, nullable: true })
  pausedUntil: Date | null

  @ApiProperty({ type: String, nullable: true })
  reason: string | null

  @ApiProperty({ type: Date })
  createdAt: Date

  constructor(data: PartnerAvailabilityChangeAdminDto) {
    this.id = data.id
    this.action = data.action
    this.actorRole = data.actorRole
    this.actorEmail = data.actorEmail
    this.extraMinutes = data.extraMinutes
    this.pausedUntil = data.pausedUntil
    this.reason = data.reason
    this.createdAt = data.createdAt
  }
}
