import { Module } from '@nestjs/common'
import { CourierCourierRestApiController } from './courier.courier.rest-api.controller'
import { CourierDomainModule } from '../../../domains/courier/courier.domain.module'
import { DeliveryEventDomainModule } from 'src/domains/delivery-event/delivery-event.domain.module'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'

@Module({
  imports: [CourierDomainModule, DeliveryEventDomainModule, ConfigDomainModule],
  controllers: [CourierCourierRestApiController],
})
export class CourierCourierRestApiModule {}
