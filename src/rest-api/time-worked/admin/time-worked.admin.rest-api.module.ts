import { Module } from '@nestjs/common'
import { TimeWorkedModule } from 'src/services/time-worked/time-worked.module'
import { TimeWorkedAdminRestApiController } from './time-worked.admin.rest-api.controller'

@Module({
  imports: [TimeWorkedModule],
  controllers: [TimeWorkedAdminRestApiController],
})
export class TimeWorkedAdminRestApiModule {}
