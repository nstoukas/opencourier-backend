import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumDeliveryStatus, EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from '../../../constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { CourierJobStepCourierInput } from './queries/courier-job-step.courier.input'
import { LeaveWaitCourierService } from './leave-wait.courier.service'

// Spec 0033 (AC-6). Its own small controller on the deliveries path, as the hand back's.
@swagger.ApiBearerAuth()
@swagger.ApiTags('deliveries')
@common.Controller(`${COURIER_API_V1_PREFIX}/deliveries`)
export class LeaveWaitCourierRestApiController {
  constructor(private readonly leaveWaitCourierService: LeaveWaitCourierService) {}

  // The rider stops waiting for a late order; the order goes back to waiting and the wait is paid.
  // @HttpCode = answer 200 instead of Nest's default 201 for a POST: nothing new is created.
  @common.Post(':deliveryId/leave-wait')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ description: 'The delivery is back to waiting: { status: "ASSIGNING_COURIER" }' })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'Not waiting at the restaurant, too soon, or the order changed' })
  @swagger.ApiOperation({ summary: 'Leave a restaurant that has kept me past the limit' })
  @Roles(EnumUserRole.COURIER)
  async leave(
    @common.Param('deliveryId') deliveryId: string,
    @common.Body() input: CourierJobStepCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<{ status: EnumDeliveryStatus }> {
    return this.leaveWaitCourierService.leave(deliveryId, courier.id, input.tapAgeMs)
  }
}
