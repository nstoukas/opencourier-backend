import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumDeliveryStatus, EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from '../../../constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { HandBackCourierService } from './hand-back.courier.service'

// Spec 0020 (AC-5). Its own small controller on the deliveries path, as row 31's dropoff point.
@swagger.ApiBearerAuth()
@swagger.ApiTags('deliveries')
@common.Controller(`${COURIER_API_V1_PREFIX}/deliveries`)
export class HandBackCourierRestApiController {
  constructor(private readonly handBackCourierService: HandBackCourierService) {}

  // The rider gives an order they accepted back to matching, free, inside the co-op's window.
  // @HttpCode = answer 200 instead of Nest's default 201 for a POST: nothing new is created.
  @common.Post(':deliveryId/hand-back')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ description: 'The delivery is back to matching: { status: "ASSIGNING_COURIER" }' })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'At the restaurant, the window is over, or the order changed' })
  @swagger.ApiOperation({ summary: 'Give back an order I accepted, inside the free window' })
  @Roles(EnumUserRole.COURIER)
  async handBack(
    @common.Param('deliveryId') deliveryId: string,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<{ status: EnumDeliveryStatus }> {
    return this.handBackCourierService.handBack(deliveryId, courier.id)
  }
}
