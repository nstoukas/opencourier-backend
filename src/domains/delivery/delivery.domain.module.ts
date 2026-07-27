import { Module } from '@nestjs/common'
import { DeliveryDomainService } from './delivery.domain.service'
import { CacheModule } from 'src/services/cache/cache.module'
import { DeliveryEventModule } from 'src/services/delivery-event/delivery-event.module'
import { ConfigDomainModule } from '../config/config.domain.module'

@Module({
  imports: [CacheModule, DeliveryEventModule, ConfigDomainModule],
  providers: [DeliveryDomainService],
  exports: [DeliveryDomainService],
})
export class DeliveryDomainModule {}
