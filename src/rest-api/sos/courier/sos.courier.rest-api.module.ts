import { Module } from '@nestjs/common'
import { SosModule } from 'src/services/sos/sos.module'
import { SosCourierRestApiController } from './sos.courier.rest-api.controller'

// The rider's SOS routes (spec 0022), registered in the courier API tree.
@Module({
  imports: [SosModule],
  controllers: [SosCourierRestApiController],
})
export class SosCourierRestApiModule {}
