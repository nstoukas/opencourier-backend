import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from 'src/constants'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { ShiftBookingService } from 'src/services/shift-booking/shift-booking.service'
import { MyShiftBookingCourierDto, ShiftScheduleCourierDto } from './dtos/shift-schedule.courier.dto'
import { ShiftBookCourierInput } from './queries/shift-book.courier.input'

// A rider's shifts (spec 0027, row 78). Every route answers 409 "Shifts are off." while the co-op's
// switch is off. A rider acts only on their own bookings, and takes only other riders' open swaps.
@swagger.ApiBearerAuth()
@swagger.ApiTags('shifts')
@common.Controller(`${COURIER_API_V1_PREFIX}/shifts`)
export class ShiftBookingCourierRestApiController {
  constructor(private readonly shiftBookingService: ShiftBookingService) {}

  @common.Get('')
  @swagger.ApiOkResponse({ type: ShiftScheduleCourierDto })
  @Roles(EnumUserRole.COURIER)
  async schedule(@CurrentUserCourier() courier: CourierEntity): Promise<ShiftScheduleCourierDto> {
    return new ShiftScheduleCourierDto(await this.shiftBookingService.schedule(courier.id, new Date()))
  }

  @common.Post('bookings')
  @swagger.ApiBody({ type: ShiftBookCourierInput })
  @swagger.ApiCreatedResponse({ type: MyShiftBookingCourierDto })
  @Roles(EnumUserRole.COURIER)
  async book(@common.Body() body: ShiftBookCourierInput, @CurrentUserCourier() courier: CourierEntity): Promise<MyShiftBookingCourierDto> {
    return new MyShiftBookingCourierDto(await this.shiftBookingService.book(courier.id, body.shiftSlotId, body.date, new Date()))
  }

  @common.Post('bookings/:id/drop')
  @common.HttpCode(200)
  @Roles(EnumUserRole.COURIER)
  async drop(@common.Param('id') id: string, @CurrentUserCourier() courier: CourierEntity): Promise<MyShiftBookingCourierDto> {
    return new MyShiftBookingCourierDto(await this.shiftBookingService.drop(courier.id, id, new Date()))
  }

  @common.Post('bookings/:id/swap')
  @common.HttpCode(200)
  @Roles(EnumUserRole.COURIER)
  async swap(@common.Param('id') id: string, @CurrentUserCourier() courier: CourierEntity): Promise<MyShiftBookingCourierDto> {
    return new MyShiftBookingCourierDto(await this.shiftBookingService.offerSwap(courier.id, id, new Date()))
  }

  @common.Post('bookings/:id/swap/withdraw')
  @common.HttpCode(200)
  @Roles(EnumUserRole.COURIER)
  async withdraw(@common.Param('id') id: string, @CurrentUserCourier() courier: CourierEntity): Promise<MyShiftBookingCourierDto> {
    return new MyShiftBookingCourierDto(await this.shiftBookingService.withdrawSwap(courier.id, id, new Date()))
  }

  @common.Post('bookings/:id/take')
  @common.HttpCode(200)
  @Roles(EnumUserRole.COURIER)
  async take(@common.Param('id') id: string, @CurrentUserCourier() courier: CourierEntity): Promise<MyShiftBookingCourierDto> {
    return new MyShiftBookingCourierDto(await this.shiftBookingService.take(courier.id, id, new Date()))
  }
}
