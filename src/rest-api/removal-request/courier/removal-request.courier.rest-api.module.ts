import { Module } from '@nestjs/common'
import { RemovalRequestModule } from 'src/services/removal-request/removal-request.module'
import { RemovalRequestCourierRestApiController } from './removal-request.courier.rest-api.controller'

@Module({
  imports: [RemovalRequestModule],
  controllers: [RemovalRequestCourierRestApiController],
})
export class RemovalRequestCourierRestApiModule {}
