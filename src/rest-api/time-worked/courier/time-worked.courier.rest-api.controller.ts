import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from 'src/constants'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { RIDER_RANGE_MAX_DAYS, TimeWorkedService, parseDayRange } from 'src/services/time-worked/time-worked.service'
import {
  CoopTotalsDto,
  CurrentTimeWorkedDto,
  TimeWorkedDto,
  TimeWorkedRangeArgs,
  toCoopWeekDto,
  toCurrentShiftDto,
  toTimeWorkedDto,
} from '../time-worked.dto'

// Spec 0040: a rider's own time worked and the co-op totals. No route here takes a rider id: the
// session decides whose time worked it is (AC-18).
@swagger.ApiBearerAuth()
@swagger.ApiTags('time-worked')
@common.Controller(`${COURIER_API_V1_PREFIX}/time-worked`)
export class TimeWorkedCourierRestApiController {
  constructor(private readonly timeWorkedService: TimeWorkedService) {}

  @common.Get('current')
  @swagger.ApiOkResponse({ type: CurrentTimeWorkedDto })
  @swagger.ApiOperation({ summary: 'My open shift, for the home counter (null when none)' })
  @Roles(EnumUserRole.COURIER)
  async current(@CurrentUserCourier() courier: CourierEntity): Promise<CurrentTimeWorkedDto> {
    const result = await this.timeWorkedService.current(courier.id)
    return { asOf: result.asOf, shiftBreakMinutes: result.shiftBreakMinutes, shift: toCurrentShiftDto(result.shift) }
  }

  @common.Get('coop-totals')
  @swagger.ApiOkResponse({ type: CoopTotalsDto })
  @swagger.ApiOperation({ summary: 'This week and last week across the co-op, hidden below 3 riders' })
  @Roles(EnumUserRole.COURIER)
  async coopTotals(): Promise<CoopTotalsDto> {
    const { thisWeek, lastWeek } = await this.timeWorkedService.coopWeeks()
    return { thisWeek: toCoopWeekDto(thisWeek), lastWeek: toCoopWeekDto(lastWeek) }
  }

  @common.Get()
  @swagger.ApiOkResponse({ type: TimeWorkedDto })
  @swagger.ApiBadRequestResponse({ description: 'A malformed date, from after to, or more than 31 days' })
  @swagger.ApiOperation({ summary: 'My time worked by day and by shift, at most 31 days' })
  @Roles(EnumUserRole.COURIER)
  async list(
    @common.Query() args: TimeWorkedRangeArgs,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<TimeWorkedDto> {
    const range = parseDayRange(args.from, args.to, RIDER_RANGE_MAX_DAYS)
    const result = await this.timeWorkedService.forRider(courier.id, range, { withAdminLabels: false })
    return toTimeWorkedDto(result, false)
  }
}
