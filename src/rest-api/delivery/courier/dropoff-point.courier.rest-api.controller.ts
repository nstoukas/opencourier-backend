import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from '../../../constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { DropoffPointCourierService } from './dropoff-point.courier.service'
import { DropoffPointCourierInput } from './queries/dropoff-point.courier.input'
import { DropoffPointCourierDto } from './dtos/dropoff-point.courier.dto'

// Spec 0016 (AC-9). Its own small controller on the same path as the other delivery routes (as
// spec 0015's cancelled jobs), so the big delivery controller keeps its constructor.
@swagger.ApiBearerAuth()
@swagger.ApiTags('deliveries')
@common.Controller(`${COURIER_API_V1_PREFIX}/deliveries`)
export class DropoffPointCourierRestApiController {
  constructor(private readonly dropoffPointCourierService: DropoffPointCourierService) {}

  // The rider, standing at the customer's door, moves the drop off pin there.
  // @HttpCode = answer 200 instead of Nest's default 201 for a POST: nothing new is created here.
  @common.Post(':deliveryId/dropoff-point')
  @common.HttpCode(200)
  @swagger.ApiBody({ type: DropoffPointCourierInput })
  @swagger.ApiOkResponse({ type: DropoffPointCourierDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Move the drop off pin of my delivery to where I stand' })
  @Roles(EnumUserRole.COURIER)
  async correctDropoffPoint(
    @common.Param('deliveryId') deliveryId: string,
    @common.Body() input: DropoffPointCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<DropoffPointCourierDto> {
    return new DropoffPointCourierDto(await this.dropoffPointCourierService.correct(deliveryId, courier.id, input))
  }
}
