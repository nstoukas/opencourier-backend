import { Global, Module } from '@nestjs/common'
import { PushNotificationService } from './pushNotification.service'
import { OfferPushService } from './offer-push.service'

// Global, so DeliveryEventService (and later the iPhone path, row 59) can inject these without
// importing this module. Its own dependencies (config, repositories, BullMQ, task bus) are global too.
@Global()
@Module({
  providers: [PushNotificationService, OfferPushService],
  exports: [PushNotificationService, OfferPushService],
})
export class PushNotificationModule {}
