import { Module } from '@nestjs/common'
import { ShiftBookingModule } from 'src/services/shift-booking/shift-booking.module'
import { ShiftBookingCourierRestApiController } from './shift-booking.courier.rest-api.controller'

// The rider's shift routes (spec 0027), registered in the courier API tree.
@Module({
  imports: [ShiftBookingModule],
  controllers: [ShiftBookingCourierRestApiController],
})
export class ShiftBookingCourierRestApiModule {}
