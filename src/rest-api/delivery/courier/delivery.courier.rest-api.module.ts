import { Module } from '@nestjs/common'
import { ProductReportDomainModule } from 'src/domains/product-report/product-report.domain.module'
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
import { HandBackCourierService } from './hand-back.courier.service'
import { HandBackCourierRestApiController } from './hand-back.courier.rest-api.controller'
import { LeaveWaitCourierService } from './leave-wait.courier.service'
import { LeaveWaitCourierRestApiController } from './leave-wait.courier.rest-api.controller'

@Module({
  providers: [LeaveWaitCourierService, DeliveryRestApiCourierService, CancelledJobsCourierService, DropoffPointCourierService, DeliveryRouteCourierService, HandBackCourierService],
  exports: [DeliveryRestApiCourierService],
  imports: [ProductReportDomainModule, DeliveryDomainModule,
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
    HandBackCourierRestApiController,
    LeaveWaitCourierRestApiController,
    DeliveryCourierRestApiController,
  ],
})
export class DeliveryCourierRestApiModule {}
