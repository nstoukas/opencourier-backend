import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { ReviewRequestService } from './review-request.service'

// Spec 0038. The repositories and the push service come from global modules.
@Module({
  imports: [ConfigDomainModule],
  providers: [ReviewRequestService],
  exports: [ReviewRequestService],
})
export class ReviewRequestModule {}
