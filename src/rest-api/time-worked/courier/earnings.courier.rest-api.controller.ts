import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from 'src/constants'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import * as errors from 'src/errors'
import { TimeWorkedService } from 'src/services/time-worked/time-worked.service'
import {
  EarningsDeliveryDto,
  EarningsMonthArgs,
  EarningsMonthDto,
  toEarningsDeliveryDto,
  toEarningsMonthDto,
} from '../earnings.dto'

// Spec 0042: the rider's Earnings screen. No route here takes a rider id: the session decides whose
// earnings they are (AC-17), and each answer is worked out from the same records as time worked.
@swagger.ApiBearerAuth()
@swagger.ApiTags('earnings')
@common.Controller(`${COURIER_API_V1_PREFIX}/earnings`)
export class EarningsCourierRestApiController {
  constructor(private readonly timeWorkedService: TimeWorkedService) {}

  @common.Get()
  @swagger.ApiOkResponse({ type: EarningsMonthDto })
  @swagger.ApiBadRequestResponse({ description: 'A malformed month, or one wholly outside the last 2 months' })
  @swagger.ApiOperation({ summary: 'My days, weeks, shifts and jobs for one month, within the last 2 months' })
  @Roles(EnumUserRole.COURIER)
  async month(
    @common.Query() args: EarningsMonthArgs,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<EarningsMonthDto> {
    return toEarningsMonthDto(await this.timeWorkedService.riderMonth(courier.id, args.month))
  }

  // A delivery this rider never held, or held only before their reach, is the plain 404: its existence
  // is not revealed (spec 0042, security model).
  @common.Get('deliveries/:deliveryId')
  @swagger.ApiOkResponse({ type: EarningsDeliveryDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'One delivery I held: its pay breakdown and its timeline' })
  @Roles(EnumUserRole.COURIER)
  async delivery(
    @common.Param('deliveryId') deliveryId: string,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<EarningsDeliveryDto> {
    return toEarningsDeliveryDto(await this.timeWorkedService.deliveryDetail(courier.id, deliveryId))
  }
}
