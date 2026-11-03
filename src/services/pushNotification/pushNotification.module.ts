import { Global, Module } from '@nestjs/common'
import { PushNotificationService } from './pushNotification.service'
import { OfferPushService } from './offer-push.service'
import { OsrmRoutingModule } from 'src/services/osrm/osrm-routing.module'

// Global, so DeliveryEventService (and later the iPhone path, row 59) can inject these without
// importing this module. Its own dependencies (config, repositories, BullMQ, task bus) are global too.
@Global()
@Module({
  // The co-op's routing, for the trip figures an offer alert shows (row 100).
  imports: [OsrmRoutingModule],
  providers: [PushNotificationService, OfferPushService],
  exports: [PushNotificationService, OfferPushService],
})
export class PushNotificationModule {}
