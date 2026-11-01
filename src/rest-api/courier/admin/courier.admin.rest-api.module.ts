import { Module } from '@nestjs/common'
import { CourierAdminRestApiController } from './courier.admin.rest-api.controller'
import { CourierDomainModule } from '../../../domains/courier/courier.domain.module'
import { UserDomainModule } from '../../../domains/user/user.domain.module'
import { CourierAdminRestApiService } from './courier.admin.rest-api.service'

@Module({
  imports: [CourierDomainModule, UserDomainModule],
  controllers: [CourierAdminRestApiController],
  providers: [CourierAdminRestApiService],
})
export class CourierAdminRestApiModule {}
