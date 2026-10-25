import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { ADMIN_API_V1_PREFIX } from '../../../constants'
import { CourierDomainService } from '../../../domains/courier/courier.domain.service'
import * as errors from '../../../errors'
import { Roles } from 'src/decorators/roles.decorator'
import { EnumCourierStatus, EnumUserRole } from '@prisma/types'
import { CourierPaginatedAdminDto } from './dtos/courier.admin.paginated.dto'
import { CourierFindManyAdminArgs } from './queries/courier-find-many.admin.args'
import { CourierAdminDto } from './dtos/courier.admin.dto'
import { CourierUpdateAdminInput } from './queries/courier-update.admin.input'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'

@swagger.ApiBearerAuth()
@swagger.ApiTags('courier')
@common.Controller(`${ADMIN_API_V1_PREFIX}/courier`)
export class CourierAdminRestApiController {
  constructor(
    private readonly courierDomainService: CourierDomainService,
    private readonly deliveryEventService: DeliveryEventService
  ) {}

  @common.Get('')
  @swagger.ApiResponse({ type: CourierPaginatedAdminDto })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Get many couriers' })
  @Roles(EnumUserRole.ADMIN)
  async getManyCouriers(@common.Query() args: CourierFindManyAdminArgs): Promise<CourierPaginatedAdminDto> {
    const couriers = await this.courierDomainService.getManyCouriers(args.page, args.perPage)

    const dto = new CourierPaginatedAdminDto(couriers)
    return dto
  }

  @common.Get(':id')
  @swagger.ApiResponse({ type: CourierAdminDto })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Get courier by id' })
  @Roles(EnumUserRole.ADMIN)
  async getCourierById(@common.Param('id') id: string): Promise<CourierAdminDto> {
    const courier = await this.courierDomainService.getByIdOrThrow(id)

    const dto = new CourierAdminDto(courier)
    return dto
  }

  @common.Patch(':id')
  @swagger.ApiBody({
    type: CourierUpdateAdminInput,
  })
  @swagger.ApiOkResponse({
    type: CourierAdminDto,
  })
  @swagger.ApiNotFoundResponse({
    type: errors.NotFoundException,
  })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiOperation({ summary: 'Update a courier' })
  @Roles(EnumUserRole.ADMIN)
  async updateCourier(
    @common.Param('id') id: string,
    @common.Body() data: CourierUpdateAdminInput
  ): Promise<CourierAdminDto> {
    const courier = await this.courierDomainService.update(id, data)
    // Spec 0002: an admin setting a rider Offline ends their open offers, like the rider doing it.
    // status is optional in the request (@IsOptional) though the input class types it as always
    // there, so `as` says what can really arrive. Left out, the rider's status did not change.
    const newStatus = data.status as EnumCourierStatus | undefined
    if (newStatus) {
      await this.deliveryEventService.handleCourierStatusChanged(id, newStatus)
    }

    const dto = new CourierAdminDto(courier)
    return dto
  }
}
