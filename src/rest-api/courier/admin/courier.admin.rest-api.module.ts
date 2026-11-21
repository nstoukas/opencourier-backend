import { Module } from '@nestjs/common'
import { CourierAdminRestApiController } from './courier.admin.rest-api.controller'
import { CourierDomainModule } from '../../../domains/courier/courier.domain.module'
import { UserDomainModule } from '../../../domains/user/user.domain.module'
import { CourierAdminRestApiService } from './courier.admin.rest-api.service'
import { CourierCutOffModule } from '../../../services/courier-cut-off/courier-cut-off.module'
import { CourierAccountModule } from '../../../services/courier-account/courier-account.module'

@Module({
  imports: [CourierDomainModule, UserDomainModule, CourierCutOffModule, CourierAccountModule],
  controllers: [CourierAdminRestApiController],
  providers: [CourierAdminRestApiService],
})
export class CourierAdminRestApiModule {}
