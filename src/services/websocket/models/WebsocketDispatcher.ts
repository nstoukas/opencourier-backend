import { EnumDeliveryStatus } from '@prisma/types'
import { DeliveryCourierDto } from 'src/rest-api/delivery/courier/dtos/delivery.courier.dto'
import { OfferEndedMessage } from 'src/shared-types/notification'

export abstract class WebsocketDispatcher {
  abstract sendOfferToCourier(courierUserId: string, delivery: DeliveryCourierDto): Promise<void> | void
  abstract dispatchDeliveryStatusUpdated(
    courierUserId: string,
    oldStatus: EnumDeliveryStatus,
    newStatus: EnumDeliveryStatus,
    delivery: DeliveryCourierDto
  ): Promise<void> | void
  // Tells one rider an offer they held has ended (expired, or they went offline). Spec 0002.
  abstract sendOfferEnded(courierUserId: string, message: OfferEndedMessage): Promise<void> | void
}
