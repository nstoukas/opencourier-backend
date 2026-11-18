import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import {
  BillStatement,
  BillView,
  MonthOverview,
  PartnerBillingService,
  PartnerMonth,
} from 'src/services/partner-billing/partner-billing.service'
import {
  PartnerBillCreateAdminInput,
  PartnerBillUndoAdminInput,
  PartnerChargeMonthAdminArgs,
} from './queries/partner-charge.admin.input'

// Spec 0036: what each restaurant owes, per month, and the bills admins make of it by hand.
// Every route is admin only (AC-13); restaurants and riders have no route to charges or bills.
@swagger.ApiBearerAuth()
@swagger.ApiTags('partner-charges')
@common.Controller(ADMIN_API_V1_PREFIX)
export class PartnerChargeAdminRestApiController {
  constructor(private readonly partnerBillingService: PartnerBillingService) {}

  @common.Get('partner-charges/months/:month')
  @swagger.ApiOkResponse({ description: '{ month, restaurants, charges, earlierUnbilled }' })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: "Every restaurant's charges for an Athens month (YYYY-MM)" })
  @Roles(EnumUserRole.ADMIN)
  async getMonth(
    @common.Param('month') month: string,
    @common.Query() args: PartnerChargeMonthAdminArgs
  ): Promise<MonthOverview> {
    return this.partnerBillingService.getMonthOverview(month, args.partnerId)
  }

  @common.Get('partner-charges/months/:month/partners/:partnerId')
  @swagger.ApiOkResponse({ description: '{ partner, month, charges, bills, totals }' })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: "One restaurant's charges and bills for an Athens month" })
  @Roles(EnumUserRole.ADMIN)
  async getPartnerMonth(
    @common.Param('month') month: string,
    @common.Param('partnerId') partnerId: string
  ): Promise<PartnerMonth> {
    return this.partnerBillingService.getPartnerMonth(month, partnerId)
  }

  // A POST answers 201 by default, which is right here: a bill is created.
  @common.Post('partner-bills')
  @swagger.ApiCreatedResponse({ description: 'The bill' })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: '{ alreadyBilled: string[] }: some charges are already billed' })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: "Mark some of a restaurant's charges for a month as billed" })
  @Roles(EnumUserRole.ADMIN)
  async createBill(@common.Body() input: PartnerBillCreateAdminInput, @CurrentUser() user: UserEntity): Promise<BillView> {
    return this.partnerBillingService.createBill(input, user)
  }

  // Undoing creates nothing, so this answers 200 rather than Nest's default 201.
  @common.Post('partner-bills/:id/undo')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ description: 'The bill, undone' })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'The bill is already undone' })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Undo a bill, with a reason' })
  @Roles(EnumUserRole.ADMIN)
  async undoBill(
    @common.Param('id') id: string,
    @common.Body() input: PartnerBillUndoAdminInput,
    @CurrentUser() user: UserEntity
  ): Promise<BillView> {
    return this.partnerBillingService.undoBill(id, input.reason, user)
  }

  @common.Get('partner-bills/:id/statement')
  @swagger.ApiOkResponse({ description: '{ partner, month, bill, lines, totals }' })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: "A bill's statement: its own lines only" })
  @Roles(EnumUserRole.ADMIN)
  async getStatement(@common.Param('id') id: string): Promise<BillStatement> {
    return this.partnerBillingService.getStatement(id)
  }
}
