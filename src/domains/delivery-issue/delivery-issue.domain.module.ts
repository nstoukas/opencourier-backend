import { Module } from '@nestjs/common'
import { DeliveryIssueDomainService } from './delivery-issue.domain.service'
import { ChatDomainModule } from 'src/domains/chat/chat.domain.module'

@Module({
  // Spec 0034 (chat): a report adds a line to the rider's thread.
  imports: [ChatDomainModule],
  providers: [DeliveryIssueDomainService],
  exports: [DeliveryIssueDomainService],
})
export class DeliveryIssueDomainModule {}
