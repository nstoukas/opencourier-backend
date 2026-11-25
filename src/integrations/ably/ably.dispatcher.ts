import { Injectable, Logger } from '@nestjs/common'

import { WebsocketDispatcher } from '../../services/websocket/models/WebsocketDispatcher'
import { AblyService } from './ably.service'
import { DeliveryCourierDto } from 'src/rest-api/delivery/courier/dtos/delivery.courier.dto'
import {
  EnumDeliveryStatus,
  NotificationEventType,
  JobEditedMessage, JobReadyUpdatedMessage, OfferEndedMessage, RemovalRequestDecidedMessage, SplitRequestDecidedMessage,
  ChatMessageToCourier, ChatReadByDispatchMessage,
  courierNotificationChannel,
} from 'src/shared-types/index'
import { describeErrorForLog, errorForConsole, errorSummaryForLog } from 'src/utils/errorForLog'

@Injectable()
export class AblyDispatcher extends WebsocketDispatcher {
  private readonly logger = new Logger(AblyDispatcher.name)

  constructor(private readonly ablyService: AblyService) {
    super()
  }

  // Ably connections cannot be closed from here. The rider's Ably token lasts until it expires;
  // a new one needs the app's session, which a password change refuses (spec 0013, decision 16.7).
  disconnectUser(userId: string) {
    this.logger.warn(`Cannot close the Ably connection of user ${userId}; it ends when its Ably token expires`)
  }

  async sendOfferToCourier(userId: string, delivery: DeliveryCourierDto) {
    // Ids only: the delivery carries the customer's name and number (row 33 review).
    this.logger.log(`emitting offer of delivery ${delivery.id} to courier, channel: COURIER:${userId}`)
    await this.publishMessage(courierNotificationChannel(userId), NotificationEventType.NEW_DELIVERY_OFFER, delivery)
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

  // Row 164. Logged by delivery id only (the message carries a business name).
  async sendJobEdited(userId: string, message: JobEditedMessage) {
    this.logger.log(`emitting ${NotificationEventType.JOB_EDITED} for delivery ${message.deliveryId}`)
    await this.publishMessage(courierNotificationChannel(userId), NotificationEventType.JOB_EDITED, message)
  }

  // Spec 0047: logged by delivery id only; the admin's sentence is never logged.
  async sendSplitRequestDecided(userId: string, message: SplitRequestDecidedMessage) {
    this.logger.log(`emitting ${NotificationEventType.SPLIT_REQUEST_DECIDED} for delivery ${message.deliveryId}`)
    await this.publishMessage(courierNotificationChannel(userId), NotificationEventType.SPLIT_REQUEST_DECIDED, message)
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

  // No admin live path with Ably: the admin's open conversation and sidebar count poll (AC-8).
  sendChatMessageToDispatch() {}

  sendChatThreadRead() {}

  private async publishMessage(channelName: string, messageName: string, message: any) {
    try {
      await this.ablyService
        .getChannel(channelName)
        .publish(messageName, message)
        .catch((error) => {
          console.log(`error sending message: ${errorForConsole(error)}`)
        })
    } catch (error) {
      this.logger.error(
        `There was a problem trying to publish a message to ably channel ${channelName}: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
    }
  }
}
