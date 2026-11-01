import { Module } from '@nestjs/common'
import { DispatchStopModule } from 'src/services/dispatch-stop/dispatch-stop.module'
import { DispatchStopAdminRestApiController } from './admin/dispatch-stop.admin.rest-api.controller'
import { DispatchStopCourierRestApiController } from './courier/dispatch-stop.courier.rest-api.controller'
import { DispatchStopPartnerRestApiController } from './partner/dispatch-stop.partner.rest-api.controller'

// The three audiences' dispatch stop routes (spec 0014), each controller in its own namespace.
@Module({
  imports: [DispatchStopModule],
  controllers: [
    DispatchStopAdminRestApiController,
    DispatchStopCourierRestApiController,
    DispatchStopPartnerRestApiController,
  ],
})
export class DispatchStopRestApiModule {}
