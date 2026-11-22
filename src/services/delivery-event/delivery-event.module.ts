import { OsrmRoutingModule } from 'src/services/osrm/osrm-routing.module'
import { DeliveryEventService } from './delivery-event.service'
import { TwoOrderService } from '../two-order/two-order.service'
import { Module, Global } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { PartnerWebhookModule } from '../partner-webhooks/partner-webhooks.module'
import { DeliveryCalculationModule } from '../delivery-calculation/delivery-calculation.module'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { CacheModule } from '../cache/cache.module'

@Global()
@Module({
  imports: [OsrmRoutingModule, HttpModule, PartnerWebhookModule, DeliveryCalculationModule, ConfigDomainModule, CacheModule],
  // Spec 0048: TwoOrderService pairs stacked offers for DeliveryEventService; it lives here so both share
  // the OSRM, cache and config modules imported above.
  providers: [DeliveryEventService, TwoOrderService],
  exports: [DeliveryEventService, TwoOrderService],
})
export class DeliveryEventModule {}
