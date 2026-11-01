import { Module } from '@nestjs/common'
import { DispatchStopModule } from 'src/services/dispatch-stop/dispatch-stop.module'
import { DispatchStopCourierRestApiController } from './dispatch-stop.courier.rest-api.controller'

// The courier dispatch stop routes (spec 0014), registered in the courier API tree.
@Module({
  imports: [DispatchStopModule],
  controllers: [DispatchStopCourierRestApiController],
})
export class DispatchStopCourierRestApiModule {}
