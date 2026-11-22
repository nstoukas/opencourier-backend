import { Module } from '@nestjs/common'
import { LocationNoteDomainModule } from 'src/domains/location-note/location-note.domain.module'
import { AddressNoteAdminRestApiController } from './address-note.admin.rest-api.controller'

// The admin routes of spec 0053, registered in the admin API tree.
@Module({
  imports: [LocationNoteDomainModule],
  controllers: [AddressNoteAdminRestApiController],
})
export class AddressNoteAdminRestApiModule {}
