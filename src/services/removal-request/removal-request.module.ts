import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { RemovalRequestService } from './removal-request.service'

// DeliveryEventService and the repositories come from global modules.
@Module({
  imports: [ConfigDomainModule],
  providers: [RemovalRequestService],
  exports: [RemovalRequestService],
})
export class RemovalRequestModule {}
