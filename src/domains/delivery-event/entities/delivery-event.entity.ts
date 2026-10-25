import {
  DeliveryEvent,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'

export class DeliveryEventEntity implements DeliveryEvent {
  id: string
  transitionSuccessful: boolean
  type: EnumDeliveryEventType
  actor: EnumEventActor
  eventSource: EnumDeliveryEventSource
  oldStatus: EnumDeliveryStatus | null
  newStatus: EnumDeliveryStatus | null
  message: string | null
  deliveryId: string
  // The rider an OFFERED or OFFER_EXPIRED event is about; null on every other event (spec 0002).
  courierId: string | null

  createdAt: Date
  updatedAt: Date

  constructor(data: DeliveryEvent) {
    this.id = data.id
    this.transitionSuccessful = data.transitionSuccessful
    this.type = data.type
    this.actor = data.actor
    this.eventSource = data.eventSource
    this.oldStatus = data.oldStatus
    this.newStatus = data.newStatus
    this.message = data.message
    this.deliveryId = data.deliveryId
    this.courierId = data.courierId
    this.createdAt = data.createdAt
    this.updatedAt = data.updatedAt
  }
}
