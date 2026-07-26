import { Module } from '@nestjs/common'
import { LocationDomainModule } from 'src/domains/location/location.domain.module'
import { PartnerDomainModule } from 'src/domains/partner/partner.domain.module'
import { UserDomainModule } from 'src/domains/user/user.domain.module'
import { PartnerAdminRestApiController } from './partner.admin.rest-api.controller'
import { PartnerAdminRestApiService } from './partner.admin.rest-api.service'

@Module({
  imports: [PartnerDomainModule, LocationDomainModule, UserDomainModule],
  controllers: [PartnerAdminRestApiController],
  providers: [PartnerAdminRestApiService],
})
export class PartnerAdminRestApiModule {}
