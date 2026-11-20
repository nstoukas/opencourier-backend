import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import * as errors from 'src/errors'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import {
  RIDER_RANGE_MAX_DAYS,
  TOTALS_RANGE_MAX_DAYS,
  TimeWorkedService,
  parseDayRange,
} from 'src/services/time-worked/time-worked.service'
import { EarningsViewDto, toEarningsViewDto } from '../earnings.dto'
import { TimeWorkedRangeArgs, TimeWorkedTotalsArgs, TimeWorkedTotalsDto, toTotalsRowDto } from '../time-worked.dto'

// Spec 0040: what admins see. One named rider at a time, the same days and shifts the rider sees plus
// which admin made an admin caused change (AC-15); and the co-op totals, which never carry a rider id
// (AC-14, AC-16). Nothing here lists, sorts or compares riders by a time worked figure.
@swagger.ApiBearerAuth()
@swagger.ApiTags('time-worked')
@common.Controller(ADMIN_API_V1_PREFIX)
export class TimeWorkedAdminRestApiController {
  constructor(
    private readonly timeWorkedService: TimeWorkedService,
    private readonly courierRepository: CourierRepository
  ) {}

  // Spec 0042 (AC-15): the same days, weeks, figures and job rows the rider's Earnings screen shows,
  // with no reach limit, one rider per call.
  @common.Get('courier/:id/time-worked')
  @swagger.ApiOkResponse({ type: EarningsViewDto })
  @swagger.ApiBadRequestResponse({ description: 'A malformed date, from after to, or more than 31 days' })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({
    summary: "One rider's time worked and earnings figures (days, weeks, shifts, jobs), at most 31 days",
  })
  @Roles(EnumUserRole.ADMIN)
  async forRider(@common.Param('id') id: string, @common.Query() args: TimeWorkedRangeArgs): Promise<EarningsViewDto> {
    const range = parseDayRange(args.from, args.to, RIDER_RANGE_MAX_DAYS)
    const courier = await this.courierRepository.findById(id)
    if (!courier) throw new errors.NotFoundException('Courier not found')
    const view = await this.timeWorkedService.earnings(
      courier.id,
      { from: range.from, to: range.to, reachFrom: null },
      { withAdminLabels: true }
    )
    return toEarningsViewDto(view, true)
  }

  @common.Get('time-worked-totals')
  @swagger.ApiOkResponse({ type: TimeWorkedTotalsDto })
  @swagger.ApiBadRequestResponse({ description: 'A malformed date, from after to, or more than 92 days' })
  @swagger.ApiOperation({ summary: 'Co-op totals by day or by week, at most 92 days; never names a rider' })
  @Roles(EnumUserRole.ADMIN)
  async totals(@common.Query() args: TimeWorkedTotalsArgs): Promise<TimeWorkedTotalsDto> {
    const range = parseDayRange(args.from, args.to, TOTALS_RANGE_MAX_DAYS)
    const result = await this.timeWorkedService.totals(range, args.by)
    return { currencyCode: result.currencyCode, rows: result.rows.map(toTotalsRowDto) }
  }
}
