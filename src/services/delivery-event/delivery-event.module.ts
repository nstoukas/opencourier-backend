import { DeliveryEventService } from './delivery-event.service'
import { Module, Global } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { PartnerWebhookModule } from '../partner-webhooks/partner-webhooks.module'
import { DeliveryCalculationModule } from '../delivery-calculation/delivery-calculation.module'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { CacheModule } from '../cache/cache.module'

@Global()
@Module({
  imports: [HttpModule, PartnerWebhookModule, DeliveryCalculationModule, ConfigDomainModule, CacheModule],
  providers: [DeliveryEventService],
  exports: [DeliveryEventService],
})
export class DeliveryEventModule {}
