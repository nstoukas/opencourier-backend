import { ApiProperty } from '@nestjs/swagger'
import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'
import { DeliveryEventEntity } from 'src/domains/delivery-event/entities/delivery-event.entity'

// Read-only audit view of one DeliveryEvent row
export class DeliveryEventAdminDto {
  @ApiProperty({ type: String })
  id: string

  @ApiProperty({ enum: EnumDeliveryEventType })
  type: EnumDeliveryEventType

  @ApiProperty({ enum: EnumEventActor })
  actor: EnumEventActor

  @ApiProperty({ enum: EnumDeliveryEventSource })
  eventSource: EnumDeliveryEventSource

  @ApiProperty({ enum: EnumDeliveryStatus, nullable: true })
  oldStatus: EnumDeliveryStatus | null

  @ApiProperty({ enum: EnumDeliveryStatus, nullable: true })
  newStatus: EnumDeliveryStatus | null

  // Indicates whether the transition was attempted and recorded but did not take effect when false
  @ApiProperty({ type: Boolean })
  transitionSuccessful: boolean

  @ApiProperty({ type: String, nullable: true })
  message: string | null

  @ApiProperty({ type: Date })
  createdAt: Date

  constructor(data: DeliveryEventEntity) {
    this.id = data.id
    this.type = data.type
    this.actor = data.actor
    this.eventSource = data.eventSource
    this.oldStatus = data.oldStatus
    this.newStatus = data.newStatus
    this.transitionSuccessful = data.transitionSuccessful
    this.message = data.message
    this.createdAt = data.createdAt
  }
}
