import { Module } from '@nestjs/common'
import { LocationNoteDomainModule } from 'src/domains/location-note/location-note.domain.module'
import { LocationNoteCourierRestApiController } from './location-note.courier.rest-api.controller'
import { LocationNoteRestApiCourierService } from './location-note.courier.rest-api.service'

@Module({
  providers: [LocationNoteRestApiCourierService],
  exports: [LocationNoteRestApiCourierService],
  imports: [LocationNoteDomainModule],
  controllers: [LocationNoteCourierRestApiController],
})
export class LocationNoteCourierRestApiModule {}
