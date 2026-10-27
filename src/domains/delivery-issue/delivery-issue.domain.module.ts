import { Module } from '@nestjs/common'
import { DeliveryIssueDomainService } from './delivery-issue.domain.service'

@Module({
  providers: [DeliveryIssueDomainService],
  exports: [DeliveryIssueDomainService],
})
export class DeliveryIssueDomainModule {}
