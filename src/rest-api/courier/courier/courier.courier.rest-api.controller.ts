import * as common from '@nestjs/common'
import { LanguageDto, LanguageInput } from 'src/rest-api/common/dtos/language.dto'
import { UserDomainService } from 'src/domains/user/user.domain.service'
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
import { CourierAccountService } from 'src/services/courier-account/courier-account.service'
import {
  CourierAccountChangeCourierDto,
  EmergencyContactCourierDto,
  EmergencyContactCourierInput,
} from 'src/rest-api/courier-account/courier-account.dto'
import { errorSummaryForLog } from 'src/utils/errorForLog'

@swagger.ApiBearerAuth()
@swagger.ApiTags('courier')
@common.Controller(`${COURIER_API_V1_PREFIX}/courier`)
export class CourierCourierRestApiController {
  private readonly logger = new common.Logger(CourierCourierRestApiController.name)

  // NestJS dependency injection: listing a service here is all it takes to get an
  // instance of it — the framework constructs the controller and passes them in.
  constructor(
    private readonly courierDomainService: CourierDomainService,
    private readonly deliveryEventService: DeliveryEventService,
    // Spec 0051. Optional only so tests that build the controller by hand keep compiling; Nest injects it.
    private readonly courierAccountService?: CourierAccountService,
    // Spec 0054. Optional for the same reason; Nest injects it.
    private readonly userDomainService?: UserDomainService
  ) {}

  private get accounts(): CourierAccountService {
    if (!this.courierAccountService) throw new Error('CourierAccountService was not injected')
    return this.courierAccountService
  }

  // Spec 0054 (AC-1): the language chosen in the app's Settings, saved on the server so pushes, mails and
  // the next sign in follow it. The phone keeps its own copy for the first screen.
  @common.Put('language')
  @swagger.ApiBody({ type: LanguageInput })
  @swagger.ApiOkResponse({ type: LanguageDto })
  @Roles(EnumUserRole.COURIER)
  async setLanguage(
    @CurrentUserCourier() courier: CourierEntity,
    @common.Body() body: LanguageInput
  ): Promise<LanguageDto> {
    if (!this.userDomainService) throw new Error('UserDomainService was not injected')
    await this.userDomainService.setLanguage(courier.userId, body.language)
    return new LanguageDto(body.language)
  }

  // Spec 0051 (AC-7): "Changes by the co-op", this rider's own account record, newest first. The actor is
  // "the co-op" or "you", never an admin's name.
  @common.Get('account-changes')
  @swagger.ApiOkResponse({ type: [CourierAccountChangeCourierDto] })
  @Roles(EnumUserRole.COURIER)
  async accountChanges(@CurrentUserCourier() courier: CourierEntity): Promise<CourierAccountChangeCourierDto[]> {
    const changes = await this.accounts.history(courier.id)
    return changes.map((change) => new CourierAccountChangeCourierDto(change))
  }

  // Spec 0051 (cross check 12): the rider's emergency contact, kept on the server.
  @common.Get('emergency-contact')
  @swagger.ApiOkResponse({ type: EmergencyContactCourierDto })
  @Roles(EnumUserRole.COURIER)
  async emergencyContact(@CurrentUserCourier() courier: CourierEntity): Promise<EmergencyContactCourierDto> {
    return new EmergencyContactCourierDto(await this.accounts.emergencyContactOf(courier.id))
  }

  @common.Put('emergency-contact')
  @swagger.ApiBody({ type: EmergencyContactCourierInput })
  @swagger.ApiOkResponse({ type: EmergencyContactCourierDto })
  @Roles(EnumUserRole.COURIER)
  async setEmergencyContact(
    @CurrentUserCourier() courier: CourierEntity,
    @common.Body() body: EmergencyContactCourierInput
  ): Promise<EmergencyContactCourierDto> {
    await this.accounts.setOwnEmergencyContact(courier.id, body.name ?? null, body.phone ?? null)
    return new EmergencyContactCourierDto(await this.accounts.emergencyContactOf(courier.id))
  }

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
      .catch((error) => this.logger.error(`After status change of courier ${courier.id}: ${errorSummaryForLog(error)}`))
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
