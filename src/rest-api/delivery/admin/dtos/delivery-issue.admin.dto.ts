import { ApiProperty } from '@nestjs/swagger'
import { EnumDeliveryIssueReason } from '@prisma/types'
import { DeliveryIssueForAdmin } from 'src/persistence/repositories/delivery-issue.repository'

// One rider's report about a delivery, for the admin's delivery details (decision 66.11). Shown
// per delivery only: nothing counts or ranks riders by their reports (value 5).
export class DeliveryIssueAdminDto {
  @ApiProperty({ type: String })
  id: string

  @ApiProperty({ enum: EnumDeliveryIssueReason })
  reason: EnumDeliveryIssueReason

  @ApiProperty({ type: String, nullable: true })
  note: string | null

  @ApiProperty({ type: Date })
  createdAt: Date

  @ApiProperty({ type: String })
  courierId: string

  @ApiProperty({ type: String })
  courierName: string

  // Spec 0034, AC-7: null while the report is open.
  @ApiProperty({ type: Date, nullable: true })
  handledAt: Date | null

  @ApiProperty({ nullable: true })
  handledBy: { id: string; email: string | null; username: string | null } | null

  constructor(issue: DeliveryIssueForAdmin) {
    this.id = issue.id
    this.reason = issue.reason
    this.note = issue.note
    this.createdAt = issue.createdAt
    this.courierId = issue.courierId
    this.courierName = `${issue.courier.firstName} ${issue.courier.lastName}`.trim()
    this.handledAt = issue.handledAt
    this.handledBy = issue.handledBy
  }
}
