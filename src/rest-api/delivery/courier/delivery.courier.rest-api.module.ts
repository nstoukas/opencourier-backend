import { Module } from '@nestjs/common'
import { DeliveryDomainModule } from '../../../domains/delivery/delivery.domain.module'
import { DeliveryCourierRestApiController } from './delivery.courier.rest-api.controller'
import { LocationNoteDomainModule } from 'src/domains/location-note/location-note.domain.module'
import { DeliveryRestApiCourierService } from './delivery.courier.rest-api.service'
import { DeliveryIssueDomainModule } from 'src/domains/delivery-issue/delivery-issue.domain.module'
import { LocationNoteReactionDomainModule } from 'src/domains/location-note-reaction/location-note-reaction.domain.module'
import { CancelledJobsCourierService } from './cancelled-jobs.courier.service'
import { CancelledJobsCourierRestApiController } from './cancelled-jobs.courier.rest-api.controller'

@Module({
  providers: [DeliveryRestApiCourierService, CancelledJobsCourierService],
  exports: [DeliveryRestApiCourierService],
  imports: [
    DeliveryDomainModule,
    LocationNoteDomainModule,
    LocationNoteReactionDomainModule,
    DeliveryIssueDomainModule,
  ],
  // CancelledJobsCourierRestApiController first: its `cancelled-jobs` must match before `GET :deliveryId`.
  controllers: [CancelledJobsCourierRestApiController, DeliveryCourierRestApiController],
})
export class DeliveryCourierRestApiModule {}
