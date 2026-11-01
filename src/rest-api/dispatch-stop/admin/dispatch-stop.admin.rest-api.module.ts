import { Module } from '@nestjs/common'
import { DispatchStopModule } from 'src/services/dispatch-stop/dispatch-stop.module'
import { DispatchStopAdminRestApiController } from './dispatch-stop.admin.rest-api.controller'

// The admin dispatch stop routes (spec 0014), registered in the admin API tree.
@Module({
  imports: [DispatchStopModule],
  controllers: [DispatchStopAdminRestApiController],
})
export class DispatchStopAdminRestApiModule {}
