import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from '../../../constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { DeliveryRouteCourierService, ROUTE_UNAVAILABLE_MESSAGE } from './route.courier.service'
import { DeliveryRouteCourierDto } from './dtos/delivery-route.courier.dto'

// Spec 0018 (AC-1). Its own small controller on the deliveries path, as row 31's dropoff point,
// so the big delivery controller keeps its constructor and tests.
@swagger.ApiBearerAuth()
@swagger.ApiTags('deliveries')
@common.Controller(`${COURIER_API_V1_PREFIX}/deliveries`)
export class DeliveryRouteCourierRestApiController {
  constructor(private readonly deliveryRouteCourierService: DeliveryRouteCourierService) {}

  @common.Get(':deliveryId/route')
  @swagger.ApiOkResponse({ type: DeliveryRouteCourierDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiServiceUnavailableResponse({ description: ROUTE_UNAVAILABLE_MESSAGE })
  @swagger.ApiOperation({ summary: 'The road route of an offer made to me or a job I hold, by leg' })
  @Roles(EnumUserRole.COURIER)
  async getRoute(
    @common.Param('deliveryId') deliveryId: string,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<DeliveryRouteCourierDto> {
    return new DeliveryRouteCourierDto(await this.deliveryRouteCourierService.getRoute(deliveryId, courier))
  }
}
