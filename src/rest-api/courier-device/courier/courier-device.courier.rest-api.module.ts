import { Module } from '@nestjs/common'
import { CourierDeviceDomainModule } from 'src/domains/courier-device/courier-device.domain.module'
import { CourierDeviceCourierRestApiController } from './courier-device.courier.rest-api.controller'

@Module({
  imports: [CourierDeviceDomainModule],
  controllers: [CourierDeviceCourierRestApiController],
})
export class CourierDeviceCourierRestApiModule {}
