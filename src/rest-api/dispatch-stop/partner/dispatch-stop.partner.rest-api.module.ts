import { Module } from '@nestjs/common'
import { DispatchStopModule } from 'src/services/dispatch-stop/dispatch-stop.module'
import { DispatchStopPartnerRestApiController } from './dispatch-stop.partner.rest-api.controller'

// The partner dispatch stop routes (spec 0014), registered in the partner API tree.
@Module({
  imports: [DispatchStopModule],
  controllers: [DispatchStopPartnerRestApiController],
})
export class DispatchStopPartnerRestApiModule {}
