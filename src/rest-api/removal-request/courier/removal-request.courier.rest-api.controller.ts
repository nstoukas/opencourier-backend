import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumRemovalRequestStatus, EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from '../../../constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { RemovalRequestService } from 'src/services/removal-request/removal-request.service'
import { RemovalReasonCourierDto } from './dtos/removal-reason.courier.dto'
import { RemovalRequestCourierDto } from './dtos/removal-request.courier.dto'
import { RemovalRequestCourierInput } from './queries/removal-request.courier.input'

// Spec 0035: a rider asks dispatch to take them off an order. Riders act only on a delivery they hold.
@swagger.ApiBearerAuth()
@swagger.ApiTags('removal-requests')
@common.Controller(COURIER_API_V1_PREFIX)
export class RemovalRequestCourierRestApiController {
  constructor(private readonly removalRequestService: RemovalRequestService) {}

  @common.Get('removal-reasons')
  @swagger.ApiOkResponse({ type: [RemovalReasonCourierDto] })
  @swagger.ApiOperation({ summary: 'The reasons a rider can give, by position' })
  @Roles(EnumUserRole.COURIER)
  async getReasons(): Promise<RemovalReasonCourierDto[]> {
    const reasons = await this.removalRequestService.listActiveReasons()
    return reasons.map((reason) => new RemovalReasonCourierDto(reason))
  }

  @common.Post('deliveries/:deliveryId/removal-request')
  @swagger.ApiCreatedResponse({ type: RemovalRequestCourierDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'An open request exists, or the reason is removed or unknown' })
  @swagger.ApiOperation({ summary: 'Ask dispatch to take me off this order' })
  @Roles(EnumUserRole.COURIER)
  async request(
    @common.Param('deliveryId') deliveryId: string,
    @common.Body() input: RemovalRequestCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<RemovalRequestCourierDto> {
    return new RemovalRequestCourierDto(await this.removalRequestService.send(deliveryId, courier.id, input))
  }

  // @HttpCode = answer 200 instead of Nest's default 201 for a POST: nothing new is created.
  @common.Post('deliveries/:deliveryId/removal-request/withdraw')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ description: '{ status: "WITHDRAWN" }' })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'No open request to withdraw' })
  @swagger.ApiOperation({ summary: 'Withdraw my open removal request' })
  @Roles(EnumUserRole.COURIER)
  async withdraw(
    @common.Param('deliveryId') deliveryId: string,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<{ status: EnumRemovalRequestStatus }> {
    return this.removalRequestService.withdraw(deliveryId, courier.id)
  }
}
