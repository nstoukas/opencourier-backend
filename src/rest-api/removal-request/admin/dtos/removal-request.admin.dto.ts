import { ApiProperty } from '@nestjs/swagger'
import { EnumRemovalRequestStatus } from '@prisma/types'
import { RemovalRequestForAdmin } from 'src/persistence/repositories/removal-request.repository'

// One removal request on the admin's delivery page (spec 0035, AC-24). Per delivery only: nothing
// counts or ranks a rider's requests (AC-22).
export class RemovalRequestAdminDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ type: String }) courierId: string
  @ApiProperty({ type: String }) courierName: string
  @ApiProperty({ type: String }) label: string
  // Spec 0054 (AC-7): the Greek label, or null; each app shows its reader's language, else the other one.
  @ApiProperty({ type: String, nullable: true }) labelEl: string | null
  @ApiProperty({ type: Boolean }) paidToRider: boolean
  @ApiProperty({ type: Boolean }) chargedToRestaurant: boolean
  @ApiProperty({ type: String, nullable: true }) note: string | null
  @ApiProperty({ enum: EnumRemovalRequestStatus }) status: EnumRemovalRequestStatus
  @ApiProperty({ type: Date }) createdAt: Date
  @ApiProperty({ type: Date, nullable: true }) decidedAt: Date | null
  @ApiProperty({ nullable: true }) decidedBy: { id: string; email: string | null; username: string | null } | null
  @ApiProperty({ type: String, nullable: true }) decisionNote: string | null
  @ApiProperty({ type: Number, nullable: true }) payAmount: number | null
  @ApiProperty({ type: String, nullable: true }) payPolicy: string | null
  @ApiProperty({ type: Boolean }) afterPickup: boolean
  @ApiProperty({ type: Date, nullable: true }) settledAt: Date | null

  constructor(request: RemovalRequestForAdmin) {
    this.id = request.id
    this.courierId = request.courierId
    this.courierName = `${request.courier.firstName} ${request.courier.lastName}`.trim()
    this.label = request.label
    // Read through a widened type so this compiles before and after the column is generated.
    this.labelEl = (request as { labelEl?: string | null }).labelEl ?? null
    this.paidToRider = request.paidToRider
    this.chargedToRestaurant = request.chargedToRestaurant
    this.note = request.note
    this.status = request.status
    this.createdAt = request.createdAt
    this.decidedAt = request.decidedAt
    this.decidedBy = request.decidedBy
    this.decisionNote = request.decisionNote
    this.payAmount = request.payAmount
    this.payPolicy = request.payPolicy
    this.afterPickup = request.afterPickup
    this.settledAt = request.settledAt
  }
}
