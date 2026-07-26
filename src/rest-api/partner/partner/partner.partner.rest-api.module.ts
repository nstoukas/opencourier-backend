import { Module } from '@nestjs/common'
import { LocationDomainModule } from 'src/domains/location/location.domain.module'
import { PartnerDomainModule } from 'src/domains/partner/partner.domain.module'
import { PartnerPartnerRestApiController } from './partner.partner.rest-api.controller'

@Module({
  imports: [PartnerDomainModule, LocationDomainModule],
  controllers: [PartnerPartnerRestApiController],
})
export class PartnerPartnerRestApiModule {}
