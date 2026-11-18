import { Module } from '@nestjs/common'
import { PartnerBillingService } from './partner-billing.service'

// Spec 0036. The repository comes from the global persistence module.
@Module({
  providers: [PartnerBillingService],
  exports: [PartnerBillingService],
})
export class PartnerBillingModule {}
