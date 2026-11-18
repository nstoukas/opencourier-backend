import { Module } from '@nestjs/common'
import { PartnerBillingModule } from 'src/services/partner-billing/partner-billing.module'
import { PartnerChargeAdminRestApiController } from './partner-charge.admin.rest-api.controller'

@Module({
  imports: [PartnerBillingModule],
  controllers: [PartnerChargeAdminRestApiController],
})
export class PartnerChargeAdminRestApiModule {}
