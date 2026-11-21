import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { SplitRequestService } from './split-request.service'

// Spec 0047. DeliveryEventService, PrismaService and the repositories come from global modules.
@Module({
  imports: [ConfigDomainModule],
  providers: [SplitRequestService],
  exports: [SplitRequestService],
})
export class SplitRequestModule {}
