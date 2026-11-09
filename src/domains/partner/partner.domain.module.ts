import { Module } from '@nestjs/common'
import { PartnerAvailabilityDomainService } from './partner-availability.domain.service'
import { PartnerDomainService } from './partner.domain.service'

@Module({
  providers: [PartnerDomainService, PartnerAvailabilityDomainService],
  exports: [PartnerDomainService, PartnerAvailabilityDomainService],
})
export class PartnerDomainModule {}
