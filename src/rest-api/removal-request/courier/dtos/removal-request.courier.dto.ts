import { ApiProperty } from '@nestjs/swagger'
import { DeliveryRemovalRequest, EnumRemovalRequestStatus } from '@prisma/types'

// The rider's own view of their request, on the POST and on the job (spec 0035).
export class RemovalRequestCourierDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ enum: EnumRemovalRequestStatus }) status: EnumRemovalRequestStatus
  @ApiProperty({ type: String }) label: string
  @ApiProperty({ type: Boolean }) paid: boolean
  @ApiProperty({ type: String, nullable: true }) decisionNote: string | null
  @ApiProperty({ type: Date }) createdAt: Date

  constructor(request: DeliveryRemovalRequest) {
    this.id = request.id
    this.status = request.status
    this.label = request.label
    this.paid = request.paidToRider
    this.decisionNote = request.decisionNote
    this.createdAt = request.createdAt
  }
}
