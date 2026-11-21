import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from 'src/constants'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import * as errors from 'src/errors'
import { TimeWorkedService } from 'src/services/time-worked/time-worked.service'
import type { Response } from 'express'
import { StatementService, formatOf } from 'src/services/statement/statement.service'
import { langOf } from 'src/domains/statement/statement-labels'
import { statementResponse } from 'src/rest-api/statement/statement-response'
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
  constructor(
    private readonly timeWorkedService: TimeWorkedService,
    // Spec 0050. Optional only so tests that build the controller by hand keep compiling; Nest injects it.
    private readonly statementService?: StatementService
  ) {}

  private get statements(): StatementService {
    if (!this.statementService) throw new Error('StatementService was not injected')
    return this.statementService
  }

  // Spec 0050 (AC-1, AC-8): the months this rider can download, newest first (complete months only).
  @common.Get('statements')
  @swagger.ApiOkResponse({ description: '{ months: ["2026-10", ...] }' })
  @Roles(EnumUserRole.COURIER)
  async statementMonths(@CurrentUserCourier() courier: CourierEntity): Promise<{ months: string[] }> {
    return { months: await this.statements.offeredMonths(courier.id) }
  }

  // Spec 0050 (AC-2 to AC-6, cross check 1): the rider's own statement, streamed (no link, no token). A
  // month outside the offered ones answers 400 (AC-10).
  @common.Get('statements/:month')
  @swagger.ApiQuery({ name: 'format', enum: ['pdf', 'csv'] })
  @swagger.ApiQuery({ name: 'lang', enum: ['el', 'en'], required: false })
  @swagger.ApiOkResponse({ description: 'The file' })
  @Roles(EnumUserRole.COURIER)
  async statement(
    @CurrentUserCourier() courier: CourierEntity,
    @common.Param('month') month: string,
    @common.Query('format') format: string,
    @common.Query('lang') lang: string | undefined,
    // `passthrough: true` lets this set headers and still return the file for Nest to send.
    @common.Res({ passthrough: true }) res: Response
  ): Promise<common.StreamableFile> {
    const file = await this.statements.file(courier.id, month, formatOf(format), langOf(lang))
    return statementResponse(res, file)
  }

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
