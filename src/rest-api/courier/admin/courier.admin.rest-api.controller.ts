import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { ADMIN_API_V1_PREFIX } from '../../../constants'
import { CourierDomainService } from '../../../domains/courier/courier.domain.service'
import * as errors from '../../../errors'
import { Roles } from 'src/decorators/roles.decorator'
import { EnumCourierDeliverySetting, EnumCourierStatus, EnumUserRole } from '@prisma/types'
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
import { CourierAccountService } from 'src/services/courier-account/courier-account.service'
import {
  CourierAccountAdminDto,
  CourierAccountChangeAdminDto,
  CourierDeactivateAdminInput,
  CourierReactivateAdminInput,
} from 'src/rest-api/courier-account/courier-account.dto'
import { PrismaService } from 'src/services/prisma/prisma.service'

@swagger.ApiBearerAuth()
@swagger.ApiTags('courier')
@common.Controller(`${ADMIN_API_V1_PREFIX}/courier`)
export class CourierAdminRestApiController {
  constructor(
    private readonly courierDomainService: CourierDomainService,
    private readonly deliveryEventService: DeliveryEventService,
    private readonly courierAdminRestApiService: CourierAdminRestApiService,
    // Spec 0051. Optional (`?`) only so tests that build the controller by hand keep compiling; Nest
    // always injects both. `accounts` and `db` fail loudly if one is missing.
    private readonly courierAccountService?: CourierAccountService,
    private readonly prisma?: PrismaService
  ) {}

  private get accounts(): CourierAccountService {
    if (!this.courierAccountService) throw new Error('CourierAccountService was not injected')
    return this.courierAccountService
  }

  private get db(): PrismaService {
    if (!this.prisma) throw new Error('PrismaService was not injected')
    return this.prisma
  }

  // Spec 0051 (AC-1): a member who left. 409 while the rider holds a job, has an open SOS, or is an admin.
  @common.Post(':id/deactivate')
  @swagger.ApiBody({ type: CourierDeactivateAdminInput })
  @swagger.ApiOkResponse({ type: CourierAdminDto })
  @swagger.ApiConflictResponse({ description: 'Holds a job, open SOS, an admin, or already deactivated' })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @Roles(EnumUserRole.ADMIN)
  async deactivate(
    @common.Param('id') id: string,
    @common.Body() body: CourierDeactivateAdminInput,
    @CurrentUser() admin: UserEntity
  ): Promise<CourierAdminDto> {
    return new CourierAdminDto(await this.accounts.deactivate(id, admin.id, body.reason))
  }

  // Spec 0051 (AC-3): back, with the same login and history; 409 when not deactivated.
  @common.Post(':id/reactivate')
  @swagger.ApiBody({ type: CourierReactivateAdminInput })
  @swagger.ApiOkResponse({ type: CourierAdminDto })
  @swagger.ApiConflictResponse({ description: 'Not deactivated' })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @Roles(EnumUserRole.ADMIN)
  async reactivate(
    @common.Param('id') id: string,
    @common.Body() body: CourierReactivateAdminInput,
    @CurrentUser() admin: UserEntity
  ): Promise<CourierAdminDto> {
    return new CourierAdminDto(await this.accounts.reactivate(id, admin.id, body.reason || null))
  }

  // Spec 0051 (AC-6, cross check 12): the login email, the deactivation and the emergency contact, for this
  // rider's page only (never the list).
  @common.Get(':id/account')
  @swagger.ApiOkResponse({ type: CourierAccountAdminDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @Roles(EnumUserRole.ADMIN)
  async account(@common.Param('id') id: string): Promise<CourierAccountAdminDto> {
    const row = await this.db.courier.findUnique({
      where: { id },
      select: {
        deactivatedAt: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        user: { select: { email: true } },
      },
    })
    if (!row) throw new errors.NotFoundException('Courier not found')
    return new CourierAccountAdminDto({ ...row, email: row.user.email })
  }

  // Spec 0051 (AC-5, AC-6): this rider's account changes, newest first.
  @common.Get(':id/account-changes')
  @swagger.ApiOkResponse({ type: [CourierAccountChangeAdminDto] })
  @Roles(EnumUserRole.ADMIN)
  async accountChanges(@common.Param('id') id: string): Promise<CourierAccountChangeAdminDto[]> {
    const changes = await this.accounts.history(id)
    return changes.map((change) => new CourierAccountChangeAdminDto(change))
  }

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
    // Spec 0051 (AC-5, cross check 10): the rider sees that the co-op set their password.
    await this.accounts.recordPasswordChange(id, { adminUserId: admin.id })
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
    @common.Body() data: CourierUpdateAdminInput,
    @CurrentUser() admin: UserEntity
  ): Promise<CourierAdminDto> {
    // Spec 0051 (AC-4, AC-5): only the named fields are read (the pipe passes anything a client sends),
    // each change is recorded, and a deactivated rider cannot be set Online or on Last Call. The status
    // still goes first, through the one writer that records it (spec 0040), and an Offline ends open
    // offers (spec 0002). `as`: the input class types status and the rest as always there; they are optional.
    const courier = await this.accounts.editByAdmin(
      id,
      {
        firstName: data.firstName as string | undefined,
        lastName: data.lastName as string | undefined,
        phoneNumber: data.phoneNumber as string | null | undefined,
        deliverySetting: data.deliverySetting as EnumCourierDeliverySetting | undefined,
        status: data.status as EnumCourierStatus | undefined,
        email: data.email,
        emergencyContactName: data.emergencyContactName,
        emergencyContactPhone: data.emergencyContactPhone,
      },
      admin.id
    )

    const dto = new CourierAdminDto(courier)
    return dto
  }
}
