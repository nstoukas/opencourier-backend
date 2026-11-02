import { Module } from '@nestjs/common'
import { PartnerDomainModule } from 'src/domains/partner/partner.domain.module'
import { PartnerCourierRestApiController } from './partner.courier.rest-api.controller'

@Module({
  imports: [PartnerDomainModule],
  controllers: [PartnerCourierRestApiController],
})
export class PartnerCourierRestApiModule {}
