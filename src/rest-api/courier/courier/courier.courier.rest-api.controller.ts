import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { COURIER_API_V1_PREFIX } from '../../../constants'
import { CourierDomainService } from '../../../domains/courier/courier.domain.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { CourierUpdateCurrentLocationCourierInput } from './queries/courier-update-current-location.courier.input'
import * as errors from 'src/errors'
import { EnumCourierStatusChangeCause, EnumUserRole } from '@prisma/types'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { CourierUpdateStatusCourierInput } from './queries/courier-update-status.courier.input'
import { CourierUpdateDeliverySettingCourierInput } from './queries/courier-update-delivery-setting.courier.input'

@swagger.ApiBearerAuth()
@swagger.ApiTags('courier')
@common.Controller(`${COURIER_API_V1_PREFIX}/courier`)
export class CourierCourierRestApiController {
  private readonly logger = new common.Logger(CourierCourierRestApiController.name)

  // NestJS dependency injection: listing a service here is all it takes to get an
  // instance of it — the framework constructs the controller and passes them in.
  constructor(
    private readonly courierDomainService: CourierDomainService,
    private readonly deliveryEventService: DeliveryEventService
  ) {}

  @common.Patch('location')
  @swagger.ApiBody({
    type: CourierUpdateCurrentLocationCourierInput,
  })
  @swagger.ApiOkResponse({ status: 200 })
  @swagger.ApiNotFoundResponse({
    type: errors.NotFoundException,
  })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiOperation({ summary: 'Update current courier location' })
  @Roles(EnumUserRole.COURIER)
  async updateCurrentLocation(
    @common.Body() data: CourierUpdateCurrentLocationCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<void> {
    await this.courierDomainService.updateCurrentLocation(courier.id, {
      latitude: data.latitude,
      longitude: data.longitude,
    })
  }

  @common.Patch('status')
  @swagger.ApiBody({
    type: CourierUpdateStatusCourierInput,
  })
  @swagger.ApiOkResponse({ status: 200 })
  @swagger.ApiNotFoundResponse({
    type: errors.NotFoundException,
  })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiOperation({ summary: 'Update status' })
  @Roles(EnumUserRole.COURIER)
  async updateStatus(
    @common.Body() data: CourierUpdateStatusCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<void> {
    // Spec 0040 (AC-1): the rider's own switch, recorded with cause RIDER (logout reaches here too).
    await this.courierDomainService.changeStatus(courier.id, data.status, EnumCourierStatusChangeCause.RIDER)
    // Spec 0002: going Offline ends this rider's open offers; going Online matches waiting deliveries.
    // Not awaited: the rider's status is already saved, so the app gets its answer at once instead
    // of waiting for a round of matching (row 61 review). `void` marks the promise as deliberately
    // left running; the method never throws, and the catch is only a last net for the log.
    void this.deliveryEventService
      .handleCourierStatusChanged(courier.id, data.status)
      .catch((error) => this.logger.error(`After status change of courier ${courier.id}: ${error}`))
  }

  @common.Patch('delivery-setting')
  @swagger.ApiBody({
    type: CourierUpdateDeliverySettingCourierInput,
  })
  @swagger.ApiOkResponse({ status: 200 })
  @swagger.ApiNotFoundResponse({
    type: errors.NotFoundException,
  })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiOperation({ summary: 'Update delivery setting' })
  @Roles(EnumUserRole.COURIER)
  async updateDeliverySetting(
    @common.Body() data: CourierUpdateDeliverySettingCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<void> {
    await this.courierDomainService.updateDeliverySetting(courier.id, data.deliverySetting)
  }
}
