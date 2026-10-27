import { ApiProperty } from '@nestjs/swagger'
import { EnumDeliveryIssueReason } from '@prisma/types'
import { DeliveryIssueWithCourier } from 'src/persistence/repositories/delivery-issue.repository'

// The rider's own report, as stored (decision 66.11).
export class DeliveryIssueCourierDto {
  @ApiProperty({ type: String })
  id: string

  @ApiProperty({ enum: EnumDeliveryIssueReason })
  reason: EnumDeliveryIssueReason

  @ApiProperty({ type: String, nullable: true })
  note: string | null

  @ApiProperty({ type: Date })
  createdAt: Date

  constructor(issue: DeliveryIssueWithCourier) {
    this.id = issue.id
    this.reason = issue.reason
    this.note = issue.note
    this.createdAt = issue.createdAt
  }
}
