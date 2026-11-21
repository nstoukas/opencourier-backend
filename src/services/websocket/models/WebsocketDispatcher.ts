import { EnumDeliveryStatus } from '@prisma/types'
import { DeliveryCourierDto } from 'src/rest-api/delivery/courier/dtos/delivery.courier.dto'
import {
  ChatMessageToCourier,
  ChatMessageToDispatch,
  ChatReadByDispatchMessage,
  ChatThreadReadMessage,
  JobReadyUpdatedMessage,
  OfferEndedMessage,
  RemovalRequestDecidedMessage,
  SplitRequestDecidedMessage,
} from 'src/shared-types/notification'

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
  // Tells the rider holding a job that its ready time moved or the food is ready (spec 0023).
  abstract sendJobReadyUpdated(courierUserId: string, message: JobReadyUpdatedMessage): Promise<void> | void
  // Tells a rider dispatch's answer to their removal request (spec 0035).
  abstract sendRemovalRequestDecided(courierUserId: string, message: RemovalRequestDecidedMessage): Promise<void> | void
  // Tells a rider dispatch's answer to their split request (spec 0047).
  abstract sendSplitRequestDecided(courierUserId: string, message: SplitRequestDecidedMessage): Promise<void> | void
  // Chat (spec 0034): a message in this rider's thread, and dispatch reading it (AC-6, AC-8).
  abstract sendChatMessageToCourier(courierUserId: string, message: ChatMessageToCourier): Promise<void> | void
  abstract sendChatReadByDispatch(courierUserId: string, message: ChatReadByDispatchMessage): Promise<void> | void
  // Chat (spec 0034): to every open admin page. With Ably there is no admin live path, and the
  // admin's open conversation polls instead (AC-8), so the Ably dispatcher does nothing here.
  abstract sendChatMessageToDispatch(message: ChatMessageToDispatch): Promise<void> | void
  abstract sendChatThreadRead(message: ChatThreadReadMessage): Promise<void> | void
  // Closes every live connection of one user, after an admin set a new password (spec 0013).
  abstract disconnectUser(userId: string): Promise<void> | void
}
