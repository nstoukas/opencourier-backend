import { EnumEventActor, EnumDeliveryEventSource, EnumDeliveryStatus, EnumDeliveryEventType } from '@prisma/types'

export interface IDeliveryEventCreateInput {
  actor: EnumEventActor
  eventSource: EnumDeliveryEventSource
  message: string | null
  newStatus: EnumDeliveryStatus | null
  oldStatus: EnumDeliveryStatus | null
  deliveryId: string
  transitionSuccessful: boolean
  type: EnumDeliveryEventType
  // Only for OFFERED and OFFER_EXPIRED (spec 0002); left out, the column stays null.
  courierId?: string | null
  // When the event happened (spec 0009); left out, the column's default (now) applies.
  occurredAt?: Date
}
