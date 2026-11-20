import { Module } from '@nestjs/common'
import { TimeWorkedModule } from 'src/services/time-worked/time-worked.module'
import { EarningsCourierRestApiController } from './earnings.courier.rest-api.controller'
import { TimeWorkedCourierRestApiController } from './time-worked.courier.rest-api.controller'

@Module({
  imports: [TimeWorkedModule],
  // Spec 0042: Earnings reads the same records, so it lives beside time worked.
  controllers: [TimeWorkedCourierRestApiController, EarningsCourierRestApiController],
})
export class TimeWorkedCourierRestApiModule {}
