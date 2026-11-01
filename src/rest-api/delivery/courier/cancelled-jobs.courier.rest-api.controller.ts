import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from '../../../constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { CancelledJobsCourierService } from './cancelled-jobs.courier.service'
import { CancelledJobCourierDto } from './dtos/cancelled-job.courier.dto'
import { FoodOutcomeCourierInput } from './queries/food-outcome.courier.input'

// Spec 0015. Its own controller on the same path as the delivery routes, registered before them in
// the module, so `cancelled-jobs` is never read as a delivery id by `GET :deliveryId`.
@swagger.ApiBearerAuth()
@swagger.ApiTags('deliveries')
@common.Controller(`${COURIER_API_V1_PREFIX}/deliveries`)
export class CancelledJobsCourierRestApiController {
  constructor(private readonly cancelledJobsCourierService: CancelledJobsCourierService) {}

  @common.Get('cancelled-jobs')
  @swagger.ApiOkResponse({ type: CancelledJobCourierDto, isArray: true })
  @swagger.ApiOperation({ summary: 'My jobs cancelled in the last 24 hours after I accepted them' })
  @Roles(EnumUserRole.COURIER)
  async getMyCancelledJobs(@CurrentUserCourier() courier: CourierEntity): Promise<{ data: CancelledJobCourierDto[] }> {
    return { data: await this.cancelledJobsCourierService.getMyCancelledJobs(courier.id) }
  }

  @common.Post(':deliveryId/food-outcome')
  @swagger.ApiBody({ type: FoodOutcomeCourierInput })
  @swagger.ApiCreatedResponse({ type: CancelledJobCourierDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Record what happened to the food of a job cancelled after pickup' })
  @Roles(EnumUserRole.COURIER)
  async recordFoodOutcome(
    @common.Param('deliveryId') deliveryId: string,
    @common.Body() input: FoodOutcomeCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<CancelledJobCourierDto> {
    return this.cancelledJobsCourierService.recordFoodOutcome(deliveryId, courier.id, input)
  }
}
