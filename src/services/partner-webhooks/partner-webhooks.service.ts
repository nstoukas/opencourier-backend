import { Injectable, Logger } from '@nestjs/common'
import { DeliveryStatusUpdateEvent } from 'src/shared-types/index'
import { PartnerWebhookEventType } from './enums/partner-webhook-event-type.enum'
import { DeliveryStatusChangedEventPayload } from './events/delivery-status-changed-event-payload'
import { HttpService } from '@nestjs/axios'
import { AxiosResponse } from 'axios'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { PartnerRepository } from 'src/persistence/repositories/partner.repository'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'

@Injectable()
export class PartnerWebhookService {
  private readonly logger = new Logger(PartnerWebhookService.name)
  constructor(
    private readonly partnerRepository: PartnerRepository,
    private readonly deliveryRepository: DeliveryRepository,
    private readonly courierRepository: CourierRepository,
    private readonly httpService: HttpService
  ) {}

  async sendDeliveryUpdatePartnerWebhook(event: DeliveryStatusUpdateEvent) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(event.deliveryId)
    if (!delivery.partnerId) {
      this.logger.error(`Delivery ${delivery.id} has no partner`)
      return
    }

    const courier = delivery.courierId ? await this.courierRepository.findByIdOrThrow(delivery.courierId) : null

    const partner = await this.partnerRepository.findById(delivery.partnerId)

    if (!partner) {
      this.logger.error(`Partner ${delivery.partnerId} not found for delivery ${delivery.id}`)
      return
    }

    if (!partner.webhookUrl) {
      this.logger.error(`Partner ${partner.id} has no webhook URL`)
      return
    }

    const webhookPayload: DeliveryStatusChangedEventPayload = {
      eventType: PartnerWebhookEventType.DELIVERY_STATUS_CHANGED,
      event: event.event.type,
      deliveryId: delivery.id,
      partnerId: partner.id,
      oldStatus: event.oldStatus,
      newStatus: event.status,
      delivery,
      courier,
    }

    // Send webhook request to partner. Logged by ids and statuses only: the payload carries the customer's
    // name, phone, floor and doorbell (spec 0016, AC-12; the rest of the logs are row 95).
    console.log(
      `Sending webhook to partner ${partner.id}: delivery ${delivery.id} ${event.oldStatus} -> ${event.status}`
    )

    const response: AxiosResponse = await this.httpService.axiosRef.post(partner.webhookUrl, webhookPayload)

    console.log(`Webhook to partner ${partner.id} answered ${response.status}`)
  }
}
