import { Module } from '@nestjs/common'
import { CourierDomainModule } from 'src/domains/courier/courier.domain.module'
import { CourierCutOffService } from './courier-cut-off.service'

// Row 17 (spec 0039): imported by the admin courier routes and the courier auth routes. Its other
// dependencies (sockets, devices, delivery events) come from global modules.
@Module({
  imports: [CourierDomainModule],
  providers: [CourierCutOffService],
  exports: [CourierCutOffService],
})
export class CourierCutOffModule {}
