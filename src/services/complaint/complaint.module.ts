import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { ComplaintService } from './complaint.service'

// Spec 0052. The repositories and the push service come from global modules.
@Module({
  imports: [ConfigDomainModule],
  providers: [ComplaintService],
  exports: [ComplaintService],
})
export class ComplaintModule {}
