import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumDeliveryStatus, EnumRemovalRequestStatus, EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { RemovalRequestService } from 'src/services/removal-request/removal-request.service'
import { RemovalReasonAdminDto } from './dtos/removal-reason.admin.dto'
import { RemovalRequestAdminDto } from './dtos/removal-request.admin.dto'
import {
  RemovalApproveAdminInput,
  RemovalDeclineAdminInput,
  RemovalReasonCreateAdminInput,
  RemovalReasonUpdateAdminInput,
} from './queries/removal-request.admin.input'

// Spec 0035: dispatch's answer to a rider's request, and the co-op's list of reasons. Admins only.
@swagger.ApiBearerAuth()
@swagger.ApiTags('removal-requests')
@common.Controller(ADMIN_API_V1_PREFIX)
export class RemovalRequestAdminRestApiController {
  constructor(private readonly removalRequestService: RemovalRequestService) {}

  // Nest answers 201 to a POST unless told otherwise; approving and declining create nothing.
  @common.Post('removal-requests/:id/approve')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ description: '{ status, deliveryStatus }' })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'Not open, a stale board, or the delivery changed' })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Approve a removal request' })
  @Roles(EnumUserRole.ADMIN)
  async approve(
    @common.Param('id') id: string,
    @common.Body() input: RemovalApproveAdminInput,
    @CurrentUser() user: UserEntity
  ): Promise<{ status: EnumRemovalRequestStatus; deliveryStatus: EnumDeliveryStatus }> {
    return this.removalRequestService.approve(id, user.id, input.pickedUp)
  }

  @common.Post('removal-requests/:id/decline')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ description: '{ status }' })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'The request is no longer open' })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Decline a removal request' })
  @Roles(EnumUserRole.ADMIN)
  async decline(
    @common.Param('id') id: string,
    @common.Body() input: RemovalDeclineAdminInput,
    @CurrentUser() user: UserEntity
  ): Promise<{ status: EnumRemovalRequestStatus }> {
    return this.removalRequestService.decline(id, user.id, input.note)
  }

  @common.Get('deliveries/:deliveryId/removal-requests')
  @swagger.ApiOkResponse({ type: [RemovalRequestAdminDto] })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: "A delivery's removal requests, newest first" })
  @Roles(EnumUserRole.ADMIN)
  async listForDelivery(@common.Param('deliveryId') deliveryId: string): Promise<RemovalRequestAdminDto[]> {
    const requests = await this.removalRequestService.listForDelivery(deliveryId)
    return requests.map((request) => new RemovalRequestAdminDto(request))
  }

  @common.Get('removal-reasons')
  @swagger.ApiOkResponse({ type: [RemovalReasonAdminDto] })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'The removal reasons (active only)' })
  @Roles(EnumUserRole.ADMIN)
  async listReasons(): Promise<RemovalReasonAdminDto[]> {
    const reasons = await this.removalRequestService.listReasons()
    return reasons.map((reason) => new RemovalReasonAdminDto(reason))
  }

  @common.Post('removal-reasons')
  @swagger.ApiCreatedResponse({ type: RemovalReasonAdminDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Add a removal reason' })
  @Roles(EnumUserRole.ADMIN)
  async createReason(@common.Body() input: RemovalReasonCreateAdminInput): Promise<RemovalReasonAdminDto> {
    return new RemovalReasonAdminDto(await this.removalRequestService.createReason(input))
  }

  @common.Patch('removal-reasons/:id')
  @swagger.ApiOkResponse({ type: RemovalReasonAdminDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Edit a removal reason' })
  @Roles(EnumUserRole.ADMIN)
  async updateReason(
    @common.Param('id') id: string,
    @common.Body() input: RemovalReasonUpdateAdminInput
  ): Promise<RemovalReasonAdminDto> {
    return new RemovalReasonAdminDto(await this.removalRequestService.updateReason(id, input))
  }

  @common.Delete('removal-reasons/:id')
  @swagger.ApiOkResponse({ type: RemovalReasonAdminDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'The last active reason cannot be removed' })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Remove a removal reason' })
  @Roles(EnumUserRole.ADMIN)
  async removeReason(@common.Param('id') id: string): Promise<RemovalReasonAdminDto> {
    return new RemovalReasonAdminDto(await this.removalRequestService.removeReason(id))
  }
}
