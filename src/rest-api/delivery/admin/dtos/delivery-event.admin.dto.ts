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

  // The English sentence as stored. Since spec 0054 it is rendered from messageCode; older rows have only this,
  // and the apps show it with a small "recorded in English" note.
  @ApiProperty({ type: String, nullable: true })
  message: string | null

  // Spec 0054 (AC-4): the code (src/shared-types/event-messages.ts) and its values, which the app renders in
  // its reader's language. Null on rows written before spec 0054.
  @ApiProperty({ type: String, nullable: true })
  messageCode: string | null

  @ApiProperty({ type: Object, nullable: true })
  messageParams: unknown

  // The rider an OFFERED or OFFER_EXPIRED event is about, so a delivery's own timeline can name
  // them (spec 0002, AC-11); null on every other event. Shown per delivery only: nothing may group
  // or count events by this field (AC-12, value 5; guarded by value-5-guard.active.spec.ts).
  @ApiProperty({ type: String, nullable: true })
  courierId: string | null

  // When the event happened: for a rider's step that waited on the phone for signal, the tap;
  // otherwise the same moment as createdAt (spec 0009, AC-10).
  @ApiProperty({ type: Date })
  occurredAt: Date

  // When the server received it.
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
    this.messageCode = data.messageCode
    this.messageParams = data.messageParams
    this.courierId = data.courierId
    this.occurredAt = data.occurredAt
    this.createdAt = data.createdAt
  }
}
