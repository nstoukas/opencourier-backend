import { EnumCancelledBy, EnumDeliveryEventType } from '@prisma/types'

export interface ISubmitDeliveryEvent {
  deliveryId: string
  eventType: EnumDeliveryEventType
  courierId?: string
  // Only with CANCELED (spec 0015); defaults to COOP.
  cancelledBy?: EnumCancelledBy
}
