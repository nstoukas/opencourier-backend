import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { LocationNoteDomainService } from './location-note.domain.service'
import { AddressNoteRetentionService } from './address-note-retention.service'

// The repositories, BullMQ and the task bus are global modules, so only config is imported here.
@Module({
  imports: [ConfigDomainModule],
  providers: [LocationNoteDomainService, AddressNoteRetentionService],
  exports: [LocationNoteDomainService],
})
export class LocationNoteDomainModule {}
