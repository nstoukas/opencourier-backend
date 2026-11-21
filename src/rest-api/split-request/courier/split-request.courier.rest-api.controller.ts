import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from '../../../constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { splitLeaveFrom } from 'src/domains/split/split'
import { SplitRequestService } from 'src/services/split-request/split-request.service'
import { SplitRequestCourierDto, SplitRequestCourierInput } from '../dtos/split-request.dto'

// Spec 0047 (AC-1, AC-8): a rider at the restaurant flags an order that does not fit one box, and may
// leave once dispatch has not answered in time. Riders act only on a delivery they hold.
@swagger.ApiBearerAuth()
@swagger.ApiTags('split-requests')
@common.Controller(COURIER_API_V1_PREFIX)
export class SplitRequestCourierRestApiController {
  constructor(
    private readonly splitRequestService: SplitRequestService,
    private readonly configDomainService: ConfigDomainService
  ) {}

  @common.Post('deliveries/:deliveryId/split-requests')
  @swagger.ApiCreatedResponse({ type: SplitRequestCourierDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'Not at the restaurant, or a request is already open' })
  @swagger.ApiOperation({ summary: "Tell dispatch this order doesn't fit one box, and propose the boxes" })
  @Roles(EnumUserRole.COURIER)
  async request(
    @common.Param('deliveryId') deliveryId: string,
    @common.Body() input: SplitRequestCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<SplitRequestCourierDto> {
    const created = await this.splitRequestService.request(courier.id, deliveryId, input.legs)
    const minutes = await this.configDomainService.instanceConfig.getSplitAnswerMinutes()
    return new SplitRequestCourierDto(created, splitLeaveFrom(created.createdAt, minutes))
  }

  // @HttpCode = answer 200 instead of Nest's default 201 for a POST: nothing new is created.
  @common.Post('deliveries/:deliveryId/split-requests/leave')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ description: '{ status: "LEFT" }' })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'No open request, or the limit has not passed' })
  @swagger.ApiOperation({ summary: 'Leave an order dispatch did not split in time (it is cancelled as the restaurant\'s)' })
  @Roles(EnumUserRole.COURIER)
  async leave(
    @common.Param('deliveryId') deliveryId: string,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<{ status: 'LEFT' }> {
    await this.splitRequestService.leave(courier.id, deliveryId)
    return { status: 'LEFT' }
  }
}
