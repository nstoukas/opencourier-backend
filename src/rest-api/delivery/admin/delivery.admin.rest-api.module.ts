import { Module } from '@nestjs/common'
import { DeliveryDomainModule } from '../../../domains/delivery/delivery.domain.module'
import { DeliveryEventDomainModule } from '../../../domains/delivery-event/delivery-event.domain.module'
import { DeliveryAdminRestApiController } from './delivery.admin.rest-api.controller'

@Module({
  imports: [DeliveryDomainModule, DeliveryEventDomainModule],
  controllers: [DeliveryAdminRestApiController],
})
export class DeliveryAdminRestApiModule {}
