import { Module } from '@nestjs/common'
import { RemovalRequestModule } from 'src/services/removal-request/removal-request.module'
import { RemovalRequestAdminRestApiController } from './removal-request.admin.rest-api.controller'

@Module({
  imports: [RemovalRequestModule],
  controllers: [RemovalRequestAdminRestApiController],
})
export class RemovalRequestAdminRestApiModule {}
