import { Module } from '@nestjs/common'
import { DeliveryDomainModule } from '../../../domains/delivery/delivery.domain.module'
import { DeliveryCourierRestApiController } from './delivery.courier.rest-api.controller'
import { LocationNoteDomainModule } from 'src/domains/location-note/location-note.domain.module'
import { DeliveryRestApiCourierService } from './delivery.courier.rest-api.service'
import { DeliveryIssueDomainModule } from 'src/domains/delivery-issue/delivery-issue.domain.module'
import { LocationNoteReactionDomainModule } from 'src/domains/location-note-reaction/location-note-reaction.domain.module'
import { CancelledJobsCourierService } from './cancelled-jobs.courier.service'
import { CancelledJobsCourierRestApiController } from './cancelled-jobs.courier.rest-api.controller'
import { DropoffPointCourierService } from './dropoff-point.courier.service'
import { DropoffPointCourierRestApiController } from './dropoff-point.courier.rest-api.controller'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { OsrmRoutingModule } from 'src/services/osrm/osrm-routing.module'
import { DeliveryRouteCourierService } from './route.courier.service'
import { DeliveryRouteCourierRestApiController } from './route.courier.rest-api.controller'

@Module({
  providers: [DeliveryRestApiCourierService, CancelledJobsCourierService, DropoffPointCourierService, DeliveryRouteCourierService],
  exports: [DeliveryRestApiCourierService],
  imports: [
    DeliveryDomainModule,
    LocationNoteDomainModule,
    LocationNoteReactionDomainModule,
    DeliveryIssueDomainModule,
    ConfigDomainModule,
    OsrmRoutingModule,
  ],
  // CancelledJobsCourierRestApiController first: its `cancelled-jobs` must match before `GET :deliveryId`.
  controllers: [
    CancelledJobsCourierRestApiController,
    DropoffPointCourierRestApiController,
    DeliveryRouteCourierRestApiController,
    DeliveryCourierRestApiController,
  ],
})
export class DeliveryCourierRestApiModule {}
