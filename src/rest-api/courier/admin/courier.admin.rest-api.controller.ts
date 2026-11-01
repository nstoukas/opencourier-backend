import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { ADMIN_API_V1_PREFIX } from '../../../constants'
import { CourierDomainService } from '../../../domains/courier/courier.domain.service'
import * as errors from '../../../errors'
import { Roles } from 'src/decorators/roles.decorator'
import { EnumCourierStatus, EnumUserRole } from '@prisma/types'
import { CourierPaginatedAdminDto } from './dtos/courier.admin.paginated.dto'
import { CourierFindManyAdminArgs } from './queries/courier-find-many.admin.args'
import { adminCourierListWhere } from './queries/courier-list-filter'
import { CourierAdminDto } from './dtos/courier.admin.dto'
import { CourierUpdateAdminInput } from './queries/courier-update.admin.input'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { CourierAdminRestApiService } from './courier.admin.rest-api.service'
import { CourierCreateAdminInput } from './queries/courier-create.admin.input'
import { CourierRotatePasswordAdminInput } from './queries/courier-rotate-password.admin.input'

@swagger.ApiBearerAuth()
@swagger.ApiTags('courier')
@common.Controller(`${ADMIN_API_V1_PREFIX}/courier`)
export class CourierAdminRestApiController {
  constructor(
    private readonly courierDomainService: CourierDomainService,
    private readonly deliveryEventService: DeliveryEventService,
    private readonly courierAdminRestApiService: CourierAdminRestApiService
  ) {}

  // The co-op issues every rider's login (spec 0013): there is no public sign up any more.
  @common.Post('')
  @swagger.ApiBody({ type: CourierCreateAdminInput })
  @swagger.ApiCreatedResponse({ type: CourierAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiConflictResponse({ description: 'The email or the phone is already used' })
  @swagger.ApiOperation({ summary: 'Create a courier and their login' })
  @Roles(EnumUserRole.ADMIN)
  async createCourier(
    @common.Body() body: CourierCreateAdminInput,
    @CurrentUser() admin: UserEntity
  ): Promise<CourierAdminDto> {
    const courier = await this.courierAdminRestApiService.createCourier(body, admin.id)
    return new CourierAdminDto(courier)
  }

  // Sets a new password and cuts the old phone off: its sessions, connection, pushes and Online
  // status (spec 0013, AC-4 and AC-5). 204 with no body, as the restaurant password change.
  @common.Post(':id/rotate-password')
  @swagger.ApiBody({ type: CourierRotatePasswordAdminInput })
  @swagger.ApiResponse({ status: 204, description: 'Password set; the old phone is signed out' })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Set a new password for a courier' })
  @common.HttpCode(204)
  @Roles(EnumUserRole.ADMIN)
  async rotateCourierPassword(
    @common.Param('id') id: string,
    @common.Body() body: CourierRotatePasswordAdminInput,
    @CurrentUser() admin: UserEntity
  ): Promise<void> {
    await this.courierAdminRestApiService.rotatePassword(id, body.password, admin.id)
  }

  @common.Get('')
  @swagger.ApiResponse({ type: CourierPaginatedAdminDto })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Get many couriers' })
  @Roles(EnumUserRole.ADMIN)
  async getManyCouriers(@common.Query() args: CourierFindManyAdminArgs): Promise<CourierPaginatedAdminDto> {
    // The tab and the search, as one Prisma where (row 97).
    const couriers = await this.courierDomainService.getManyCouriers(
      adminCourierListWhere({ status: args.status, search: args.search }),
      args.page,
      args.perPage
    )

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
