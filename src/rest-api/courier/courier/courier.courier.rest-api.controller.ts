import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import {
  COURIER_API_V1_PREFIX,
  EARNINGS_SUMMARY_DEFAULT_TIMEZONE,
  EARNINGS_SUMMARY_DEFAULT_WINDOW_DAYS,
  EARNINGS_SUMMARY_MAX_WINDOW_DAYS,
} from '../../../constants'
import { CourierDomainService } from '../../../domains/courier/courier.domain.service'
import { DeliveryEventDomainService } from 'src/domains/delivery-event/delivery-event.domain.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { CourierUpdateCurrentLocationCourierInput } from './queries/courier-update-current-location.courier.input'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { CourierUpdateStatusCourierInput } from './queries/courier-update-status.courier.input'
import { CourierUpdateDeliverySettingCourierInput } from './queries/courier-update-delivery-setting.courier.input'
import { EarningsSummaryCourierArgs } from './queries/earnings-summary.courier.args'
import { EarningsSummaryCourierDto } from './dto/earnings-summary.courier.dto'
import { isValidTimezone } from 'src/domains/delivery-event/utils/earnings-summary.util'
import { convertToDate, dayjs } from 'src/core/utils/time'

// Matches a date with no time part, e.g. '2026-07-01'.
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

@swagger.ApiBearerAuth()
@swagger.ApiTags('courier')
@common.Controller(`${COURIER_API_V1_PREFIX}/courier`)
export class CourierCourierRestApiController {
  // NestJS dependency injection: listing a service here is all it takes to get an
  // instance of it — the framework constructs the controller and passes them in.
  constructor(
    private readonly courierDomainService: CourierDomainService,
    private readonly deliveryEventDomainService: DeliveryEventDomainService,
    private readonly configDomainService: ConfigDomainService
  ) {}

  @common.Get('earnings-summary')
  @swagger.ApiOkResponse({ status: 200, type: EarningsSummaryCourierDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Get my per-day earnings summary' })
  @Roles(EnumUserRole.COURIER)
  async getMyEarningsSummary(
    // @Query() hands us the query string already validated against the args class.
    @common.Query() args: EarningsSummaryCourierArgs,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<EarningsSummaryCourierDto> {
    const timezone = args.timezone ?? EARNINGS_SUMMARY_DEFAULT_TIMEZONE
    if (!isValidTimezone(timezone)) {
      throw new common.BadRequestException('Unknown timezone')
    }

    // The window has to be expressed in the courier's own days, not the server's:
    // a partial first or last day would silently under-report their earnings.
    const to = args.to ? this.parseWindowBoundary(args.to, timezone, 'end') : dayjs().tz(timezone).endOf('day').toDate()

    const from = args.from
      ? this.parseWindowBoundary(args.from, timezone, 'start')
      : dayjs(to).tz(timezone).subtract(EARNINGS_SUMMARY_DEFAULT_WINDOW_DAYS, 'day').startOf('day').toDate()

    if (from > to) {
      throw new common.BadRequestException('from must be before to')
    }

    // DeliveryEvent is the fastest-growing table and has no index on createdAt, so an
    // open-ended window would sequentially scan all of it.
    if (dayjs(to).diff(from, 'day') > EARNINGS_SUMMARY_MAX_WINDOW_DAYS) {
      throw new common.BadRequestException(`Window may not exceed ${EARNINGS_SUMMARY_MAX_WINDOW_DAYS} days`)
    }

    const days = await this.deliveryEventDomainService.getEarningsSummaryForCourier(courier.id, from, to, timezone)
    const currency = await this.configDomainService.instanceConfig.getCurrency()

    return new EarningsSummaryCourierDto(days, { from, to, timezone, currency })
  }

  /**
   * Turns one `from`/`to` query value into an instant.
   * A date-only value ('2026-07-01') carries no clock time, so we anchor it to the
   * courier's timezone — start of that day for `from`, end of it for `to` — instead of
   * letting dayjs read it as server-local midnight. Full timestamps are taken as-is.
   */
  private parseWindowBoundary(value: string, timezone: string, edge: 'start' | 'end'): Date {
    if (DATE_ONLY_PATTERN.test(value)) {
      const day = dayjs.tz(value, timezone)
      if (!day.isValid()) {
        throw new common.BadRequestException('Invalid date format')
      }
      return (edge === 'start' ? day.startOf('day') : day.endOf('day')).toDate()
    }

    let parsed: Date | null | undefined
    try {
      parsed = convertToDate(value)
    } catch {
      // convertToDate throws a plain Error, which would leave the client with a 500.
      parsed = null
    }

    if (!parsed) {
      throw new common.BadRequestException('Invalid date format')
    }
    return parsed
  }

  @common.Patch('location')
  @swagger.ApiBody({
    type: CourierUpdateCurrentLocationCourierInput,
  })
  @swagger.ApiOkResponse({ status: 200 })
  @swagger.ApiNotFoundResponse({
    type: errors.NotFoundException,
  })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiOperation({ summary: 'Update current courier location' })
  @Roles(EnumUserRole.COURIER)
  async updateCurrentLocation(
    @common.Body() data: CourierUpdateCurrentLocationCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<void> {
    await this.courierDomainService.updateCurrentLocation(courier.id, {
      latitude: data.latitude,
      longitude: data.longitude,
    })
  }

  @common.Patch('status')
  @swagger.ApiBody({
    type: CourierUpdateStatusCourierInput,
  })
  @swagger.ApiOkResponse({ status: 200 })
  @swagger.ApiNotFoundResponse({
    type: errors.NotFoundException,
  })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiOperation({ summary: 'Update status' })
  @Roles(EnumUserRole.COURIER)
  async updateStatus(
    @common.Body() data: CourierUpdateStatusCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<void> {
    await this.courierDomainService.updateStatus(courier.id, data.status)
  }

  @common.Patch('delivery-setting')
  @swagger.ApiBody({
    type: CourierUpdateDeliverySettingCourierInput,
  })
  @swagger.ApiOkResponse({ status: 200 })
  @swagger.ApiNotFoundResponse({
    type: errors.NotFoundException,
  })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiOperation({ summary: 'Update delivery setting' })
  @Roles(EnumUserRole.COURIER)
  async updateDeliverySetting(
    @common.Body() data: CourierUpdateDeliverySettingCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<void> {
    await this.courierDomainService.updateDeliverySetting(courier.id, data.deliverySetting)
  }
}
