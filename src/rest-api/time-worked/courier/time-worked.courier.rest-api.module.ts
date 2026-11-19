import { Module } from '@nestjs/common'
import { TimeWorkedModule } from 'src/services/time-worked/time-worked.module'
import { TimeWorkedCourierRestApiController } from './time-worked.courier.rest-api.controller'

@Module({
  imports: [TimeWorkedModule],
  controllers: [TimeWorkedCourierRestApiController],
})
export class TimeWorkedCourierRestApiModule {}
