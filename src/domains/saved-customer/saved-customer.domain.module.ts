import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { SavedCustomerDomainService } from './saved-customer.domain.service'
import { SavedCustomerRetentionService } from './saved-customer-retention.service'

@Module({
  imports: [ConfigDomainModule],
  providers: [SavedCustomerDomainService, SavedCustomerRetentionService],
  exports: [SavedCustomerDomainService],
})
export class SavedCustomerDomainModule {}
