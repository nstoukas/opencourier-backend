import { Module } from '@nestjs/common'
import { PartnerAvailabilityDomainService } from './partner-availability.domain.service'
import { PartnerDomainService } from './partner.domain.service'
import { PartnerWaitRecordDomainService } from './partner-wait-record.domain.service'

@Module({
  providers: [PartnerDomainService, PartnerAvailabilityDomainService, PartnerWaitRecordDomainService],
  exports: [PartnerDomainService, PartnerAvailabilityDomainService, PartnerWaitRecordDomainService],
})
export class PartnerDomainModule {}
