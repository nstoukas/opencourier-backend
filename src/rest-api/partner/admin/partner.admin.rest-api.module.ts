import { Module } from '@nestjs/common'
import { LocationDomainModule } from 'src/domains/location/location.domain.module'
import { PartnerDomainModule } from 'src/domains/partner/partner.domain.module'
import { SavedCustomerDomainModule } from 'src/domains/saved-customer/saved-customer.domain.module'
import { UserDomainModule } from 'src/domains/user/user.domain.module'
import { PartnerAdminRestApiController } from './partner.admin.rest-api.controller'
import { PartnerAdminRestApiService } from './partner.admin.rest-api.service'
import { SavedCustomerAdminRestApiController } from './saved-customer.admin.rest-api.controller'

@Module({
  imports: [PartnerDomainModule, LocationDomainModule, UserDomainModule, SavedCustomerDomainModule],
  controllers: [PartnerAdminRestApiController, SavedCustomerAdminRestApiController],
  providers: [PartnerAdminRestApiService],
})
export class PartnerAdminRestApiModule {}
