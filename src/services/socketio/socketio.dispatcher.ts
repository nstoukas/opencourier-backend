import { Injectable, Logger } from '@nestjs/common'

import { WebsocketDispatcher } from '../../services/websocket/models/WebsocketDispatcher'
import { DeliveryCourierDto } from 'src/rest-api/delivery/courier/dtos/delivery.courier.dto'
import { SocketIOService } from './socketio.service'
import { AdminSocketGateway } from './admin-socket.gateway'
import {
  EnumDeliveryStatus,
  NotificationEventType,
  JobReadyUpdatedMessage, OfferEndedMessage, RemovalRequestDecidedMessage,
  ChatMessageToCourier, ChatMessageToDispatch, ChatReadByDispatchMessage, ChatThreadReadMessage,
  courierNotificationChannel,
} from 'src/shared-types/index'

@Injectable()
export class SocketIODispatcher extends WebsocketDispatcher {
  private readonly logger = new Logger(SocketIODispatcher.name)

  constructor(
    private readonly socketIOService: SocketIOService,
    private readonly adminSocketGateway: AdminSocketGateway
  ) {
    super()
  }

  // Riders' connections and admin pages alike (spec 0013): the chat's admins namespace carries every
  // rider's and restaurant's messages, so a cut off login must lose it at once too.
  disconnectUser(userId: string) {
    this.socketIOService.disconnectUser(userId)
    this.adminSocketGateway.disconnectUser(userId)
  }

  async sendOfferToCourier(userId: string, delivery: DeliveryCourierDto) {
    const data = {
      delivery,
    }

    // Ids only: the delivery carries the customer's name and number (row 33 review).
    this.logger.log(`emitting offer of delivery ${delivery.id} to courier, channel: COURIER:${userId}`)

    await this.publishMessage(courierNotificationChannel(userId), NotificationEventType.NEW_DELIVERY_OFFER, data)
  }

  async dispatchDeliveryStatusUpdated(
    userId: string,
    oldStatus: EnumDeliveryStatus,
    newStatus: EnumDeliveryStatus,
    delivery: DeliveryCourierDto
  ) {
    const data = {
      delivery,
      oldStatus,
      newStatus,
    }

    // Ids and statuses only: the delivery carries the customer's name and number (row 33 review).
    this.logger.log(
      `emitting ${NotificationEventType.DELIVERY_STATUS_UPDATED} for delivery ${delivery.id} (${oldStatus} -> ${newStatus}), channel: COURIER:${userId}`
    )

    await this.publishMessage(courierNotificationChannel(userId), NotificationEventType.DELIVERY_STATUS_UPDATED, data)
  }

  async sendOfferEnded(userId: string, message: OfferEndedMessage) {
    this.logger.log(
      `emitting ${NotificationEventType.OFFER_ENDED} event to courier: ${JSON.stringify(message)}, channel: COURIER:${userId}`
    )

    await this.publishMessage(courierNotificationChannel(userId), NotificationEventType.OFFER_ENDED, message)
  }

  // Spec 0023. Logged by delivery id only (the message carries a business name and times).
  async sendJobReadyUpdated(userId: string, message: JobReadyUpdatedMessage) {
    this.logger.log(`emitting ${NotificationEventType.JOB_READY_UPDATED} for delivery ${message.deliveryId}`)
    await this.publishMessage(courierNotificationChannel(userId), NotificationEventType.JOB_READY_UPDATED, message)
  }

  // Spec 0035. Logged by delivery id only: the message carries dispatch's sentence.
  async sendRemovalRequestDecided(userId: string, message: RemovalRequestDecidedMessage) {
    this.logger.log(`emitting ${NotificationEventType.REMOVAL_REQUEST_DECIDED} for delivery ${message.deliveryId}`)
    await this.publishMessage(courierNotificationChannel(userId), NotificationEventType.REMOVAL_REQUEST_DECIDED, message)
  }

  // Spec 0034 (chat). Logged by message id only: the message carries what someone wrote.
  async sendChatMessageToCourier(userId: string, message: ChatMessageToCourier) {
    this.logger.log(`emitting ${NotificationEventType.CHAT_MESSAGE}, message ${message.message.id}`)
    await this.publishMessage(courierNotificationChannel(userId), NotificationEventType.CHAT_MESSAGE, message)
  }

  async sendChatReadByDispatch(userId: string, message: ChatReadByDispatchMessage) {
    this.logger.log(`emitting ${NotificationEventType.CHAT_READ_BY_DISPATCH}`)
    await this.publishMessage(courierNotificationChannel(userId), NotificationEventType.CHAT_READ_BY_DISPATCH, message)
  }

  sendChatMessageToDispatch(message: ChatMessageToDispatch) {
    this.logger.log(`emitting ${NotificationEventType.CHAT_MESSAGE} to dispatch, thread ${message.threadId}`)
    this.adminSocketGateway.emitToDispatch(NotificationEventType.CHAT_MESSAGE, message)
  }

  sendChatThreadRead(message: ChatThreadReadMessage) {
    this.adminSocketGateway.emitToDispatch(NotificationEventType.CHAT_THREAD_READ, message)
  }

  private async publishMessage(channelName: string, messageName: string, message: any) {
    try {
      await this.socketIOService.publishMessage(channelName, messageName, message)
    } catch (error) {
      this.logger.error(`There was a problem trying to publish a message to socketio channel ${channelName}.`, error)
    }
  }
}
