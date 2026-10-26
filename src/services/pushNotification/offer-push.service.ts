import { Injectable, Logger } from '@nestjs/common'
import { EnumDeliveryStatus } from '@prisma/types'
import { OFFER_INSIST_AFTER_SECONDS, PUSH_DEFAULT_TTL_SECONDS } from '../../constants'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { CourierDeviceRepository } from 'src/persistence/repositories/courier-device.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { NotificationEventType, OfferEndedMessage } from 'src/shared-types/notification'
import { OFFER_CARD_PAYLOAD_KEYS, buildOfferCardPayload } from 'src/domains/delivery/offer-card-payload'
import { TaskBusService } from '../taskBus/taskBus.service'
import { PushNotificationService, PushSendResult } from './pushNotification.service'

// The payload of an offer-insist job names the exact offer it was set for, like an offer-expiry job,
// so a job left over from an offer that was answered, moved or ended finds nothing to re-send.
interface OfferInsistJobPayload {
  deliveryId: string
  courierId: string
  offeredAt: string // ISO time; jobs are stored as JSON, which has no Date
}

// Job ids use '-', never ':' (BullMQ refuses ':' in custom ids).
const offerInsistJobId = (deliveryId: string, offeredAt: Date) => `offer-insist-${deliveryId}-${offeredAt.getTime()}`

// The push half of telling a rider about an offer (spec 0003). DeliveryEventService sends the socket
// message first and then calls newOffer() or offerEnded() here, at every place an offer goes out or
// ends, so a locked phone hears the same news the open app does.
//
// Push never decides anything. Offers are made, ended and recorded (OFFERED, OFFER_EXPIRED) exactly
// as without it; losing a push loses only the alert. So:
// - newOffer() and offerEnded() start the work and return at once; nothing waits for Google (AC-2).
// - Failures are logged by delivery id and FCM error code, never by rider.
// - Nothing is stored about a push being sent, delivered, opened or answered (AC-13, value 5). The
//   only writes are deleting tokens FCM reports dead, and the one insist timer below.
// - With push off (no service account, AC-11) both return before reading anything.
@Injectable()
export class OfferPushService {
  private readonly logger = new Logger(OfferPushService.name)

  constructor(
    private readonly pushNotificationService: PushNotificationService,
    private readonly courierDeviceRepository: CourierDeviceRepository,
    private readonly deliveryRepository: DeliveryRepository,
    private readonly bullMQService: BullMQService,
    private readonly taskBusService: TaskBusService
  ) {
    // When the insist job comes due, BullMQProcessor hands it to the task bus by name, which calls
    // this handler. The arrow function keeps `this` pointing at this service.
    this.taskBusService.registerTaskHandler<OfferInsistJobPayload>('offer-insist', (payload) =>
      this.handleOfferInsistJob(payload)
    )
  }

  // A new offer went out to this rider (automatic, admin or reassignment). Fire and forget.
  newOffer(courierId: string, deliveryId: string): void {
    if (!this.pushNotificationService.isEnabled()) return
    // `void` marks the promise as deliberately not awaited; sendNewOffer never throws, and the
    // catch is only a last net so a surprise can never become an unhandled rejection.
    void this.sendNewOffer(courierId, deliveryId, false).catch((error) =>
      this.logger.error(`Offer push for delivery ${deliveryId} failed: ${error}`)
    )
  }

  // An offer this rider held ended on the server (expired, rider offline, moved). Cancels the alert
  // and stops the ring on every phone of theirs (AC-6). Fire and forget.
  offerEnded(courierId: string, message: OfferEndedMessage): void {
    if (!this.pushNotificationService.isEnabled()) return
    void this.sendOfferEnded(courierId, message).catch((error) =>
      this.logger.error(`Offer ended push for delivery ${message.deliveryId} failed: ${error}`)
    )
  }

  // The awaited form of newOffer(). Never throws.
  async sendNewOffer(courierId: string, deliveryId: string, insistent: boolean): Promise<void> {
    if (!this.pushNotificationService.isEnabled()) return

    try {
      const tokens = await this.courierDeviceRepository.findTokensForCourier(courierId)
      if (tokens.length === 0) return

      const source = await this.deliveryRepository.findOfferCardSourceOrThrow(deliveryId)
      const now = new Date()
      const card = buildOfferCardPayload(source, { serverNow: now, insistent })

      // Seconds left to the deadline, or the default with no deadline, so a stale offer never rings.
      const { offeredAt, offerExpiresAt } = source.delivery
      let ttlSeconds = PUSH_DEFAULT_TTL_SECONDS
      if (offerExpiresAt) {
        ttlSeconds = Math.floor((offerExpiresAt.getTime() - now.getTime()) / 1000)
        if (ttlSeconds <= 0) return // already past its deadline; the expiry job ends it
      }

      // The FCM data: the message type plus the allow listed card fields, copied key by key from
      // the allow list, so no other field can reach Google or a lock screen (AC-10).
      const data: Record<string, string> = { type: NotificationEventType.NEW_DELIVERY_OFFER }
      for (const key of OFFER_CARD_PAYLOAD_KEYS) {
        data[key] = card[key]
      }

      const result = await this.pushNotificationService.sendData(tokens, data, ttlSeconds)
      await this.handleSendResult(deliveryId, NotificationEventType.NEW_DELIVERY_OFFER, result)

      // An offer with no deadline rings until answered; after 2 minutes it is pushed again on the
      // louder channel (AC-7). Set once per offer, from the first push only.
      if (!insistent && !offerExpiresAt && offeredAt) {
        await this.scheduleInsist(deliveryId, courierId, offeredAt)
      }
    } catch (error) {
      this.logger.error(`Offer push for delivery ${deliveryId} failed: ${error}`)
    }
  }

  // The awaited form of offerEnded(). Never throws.
  async sendOfferEnded(courierId: string, message: OfferEndedMessage): Promise<void> {
    if (!this.pushNotificationService.isEnabled()) return

    try {
      const tokens = await this.courierDeviceRepository.findTokensForCourier(courierId)
      if (tokens.length === 0) return

      const data: Record<string, string> = {
        type: NotificationEventType.OFFER_ENDED,
        deliveryId: message.deliveryId,
        reason: message.reason,
      }
      const result = await this.pushNotificationService.sendData(tokens, data, PUSH_DEFAULT_TTL_SECONDS)
      await this.handleSendResult(message.deliveryId, NotificationEventType.OFFER_ENDED, result)
    } catch (error) {
      this.logger.error(`Offer ended push for delivery ${message.deliveryId} failed: ${error}`)
    }
  }

  // The 2 minute re-send (AC-7). Runs only if the offer is still the very one the job was set for:
  // still waiting, still offered to this rider from the same moment, nobody took it, and still with
  // no deadline. Anything else means it was answered, moved or ended, and nothing is sent.
  async handleOfferInsistJob(payload: OfferInsistJobPayload): Promise<void> {
    const offeredAtMs = new Date(payload.offeredAt).getTime()
    if (Number.isNaN(offeredAtMs)) {
      this.logger.warn(`offer-insist job with a bad offeredAt ignored for delivery ${payload.deliveryId}`)
      return
    }

    const delivery = await this.deliveryRepository.findById(payload.deliveryId)
    const stillThisOffer =
      delivery?.status === EnumDeliveryStatus.ASSIGNING_COURIER &&
      delivery.matchedCourierId === payload.courierId &&
      delivery.courierId === null &&
      delivery.offeredAt?.getTime() === offeredAtMs &&
      delivery.offerExpiresAt === null
    if (!stillThisOffer) return

    await this.sendNewOffer(payload.courierId, payload.deliveryId, true)
  }

  // Deletes dead tokens and logs other failures by delivery id and error code only.
  private async handleSendResult(deliveryId: string, type: NotificationEventType, result: PushSendResult) {
    if (result.failureCodes.length > 0) {
      this.logger.warn(`${type} push for delivery ${deliveryId} failed on some devices: ${result.failureCodes.join(', ')}`)
    }
    if (result.deadTokens.length > 0) {
      const removed = await this.courierDeviceRepository.deleteByTokens(result.deadTokens)
      this.logger.log(`Removed ${removed} push token(s) FCM reported as no longer registered`)
    }
  }

  private async scheduleInsist(deliveryId: string, courierId: string, offeredAt: Date): Promise<void> {
    try {
      await this.bullMQService.addJob<OfferInsistJobPayload>(
        'offer-insist',
        { deliveryId, courierId, offeredAt: offeredAt.toISOString() },
        { delay: OFFER_INSIST_AFTER_SECONDS * 1000, jobId: offerInsistJobId(deliveryId, offeredAt) }
      )
    } catch (error) {
      // Without the timer the alert just keeps ringing on its first channel.
      this.logger.error(`Could not set the insist timer of delivery ${deliveryId}: ${error}`)
    }
  }
}
