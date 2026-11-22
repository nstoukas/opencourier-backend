import {
  DeliveryEvent,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  Prisma,
} from '@prisma/types'

// Spec 0054: the two columns its migration adds. Spelt out here so this file compiles both before and after
// `prisma generate` picks them up; once generated, DeliveryEvent has them and this adds nothing new.
type StoredEventText = { messageCode?: string | null; messageParams?: Prisma.JsonValue | null }

export class DeliveryEventEntity implements DeliveryEvent {
  id: string
  transitionSuccessful: boolean
  type: EnumDeliveryEventType
  actor: EnumEventActor
  eventSource: EnumDeliveryEventSource
  oldStatus: EnumDeliveryStatus | null
  newStatus: EnumDeliveryStatus | null
  message: string | null
  // Spec 0054 (AC-4): the code and values the message was rendered from; null on rows from before it.
  messageCode: string | null
  messageParams: Prisma.JsonValue | null
  deliveryId: string
  // The rider an OFFERED or OFFER_EXPIRED event is about; null on every other event (spec 0002).
  courierId: string | null

  // When the event happened; createdAt is when the server received it (spec 0009).
  occurredAt: Date
  createdAt: Date
  updatedAt: Date

  constructor(data: DeliveryEvent & StoredEventText) {
    this.id = data.id
    this.transitionSuccessful = data.transitionSuccessful
    this.type = data.type
    this.actor = data.actor
    this.eventSource = data.eventSource
    this.oldStatus = data.oldStatus
    this.newStatus = data.newStatus
    this.message = data.message
    this.messageCode = data.messageCode ?? null
    this.messageParams = data.messageParams ?? null
    this.deliveryId = data.deliveryId
    this.courierId = data.courierId
    this.occurredAt = data.occurredAt
    this.createdAt = data.createdAt
    this.updatedAt = data.updatedAt
  }
}
