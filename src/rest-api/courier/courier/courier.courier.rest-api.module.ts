import { CourierAccountModule } from 'src/services/courier-account/courier-account.module'
import { Module } from '@nestjs/common'
import { CourierCourierRestApiController } from './courier.courier.rest-api.controller'
import { CourierDomainModule } from '../../../domains/courier/courier.domain.module'
import { DeliveryEventDomainModule } from 'src/domains/delivery-event/delivery-event.domain.module'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { UserDomainModule } from 'src/domains/user/user.domain.module'

@Module({
  imports: [CourierDomainModule, DeliveryEventDomainModule, ConfigDomainModule, CourierAccountModule, UserDomainModule],
  controllers: [CourierCourierRestApiController],
})
export class CourierCourierRestApiModule {}
