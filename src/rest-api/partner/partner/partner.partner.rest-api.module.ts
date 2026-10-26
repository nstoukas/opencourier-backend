import { Module } from '@nestjs/common'
import { LocationDomainModule } from 'src/domains/location/location.domain.module'
import { PartnerDomainModule } from 'src/domains/partner/partner.domain.module'
import { SavedCustomerDomainModule } from 'src/domains/saved-customer/saved-customer.domain.module'
import { PartnerPartnerRestApiController } from './partner.partner.rest-api.controller'
import { SavedCustomerPartnerRestApiController } from './saved-customer.partner.rest-api.controller'

@Module({
  imports: [PartnerDomainModule, LocationDomainModule, SavedCustomerDomainModule],
  controllers: [PartnerPartnerRestApiController, SavedCustomerPartnerRestApiController],
})
export class PartnerPartnerRestApiModule {}
