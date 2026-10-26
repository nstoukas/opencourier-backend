import { Module } from '@nestjs/common'
import { CourierDeviceDomainService } from './courier-device.domain.service'

@Module({
  providers: [CourierDeviceDomainService],
  exports: [CourierDeviceDomainService],
})
export class CourierDeviceDomainModule {}
