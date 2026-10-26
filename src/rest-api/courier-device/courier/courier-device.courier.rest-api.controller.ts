import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from '../../../constants'
import * as errors from 'src/errors'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { CourierDeviceDomainService } from 'src/domains/courier-device/courier-device.domain.service'
import { CourierDeviceRegisterCourierInput } from './queries/courier-device-register.courier.input'

// Where the courier app registers and unregisters its push token (spec 0003, AC-1). A rider only
// ever touches their own tokens: the rider comes from the login, never from the request.
@swagger.ApiBearerAuth()
@swagger.ApiTags('courier')
@common.Controller(`${COURIER_API_V1_PREFIX}/devices`)
export class CourierDeviceCourierRestApiController {
  constructor(private readonly courierDeviceDomainService: CourierDeviceDomainService) {}

  @common.Post()
  // @HttpCode(204) answers "No Content" instead of Nest's default 201 for a POST: nothing to return.
  @common.HttpCode(204)
  @swagger.ApiBody({ type: CourierDeviceRegisterCourierInput })
  @swagger.ApiNoContentResponse()
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Register this phone for offer push (moves the token here if another rider had it)' })
  @Roles(EnumUserRole.COURIER)
  async register(
    @common.Body() data: CourierDeviceRegisterCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<void> {
    await this.courierDeviceDomainService.register(courier.id, data.token, data.platform)
  }

  @common.Delete(':token')
  @common.HttpCode(204)
  @swagger.ApiNoContentResponse()
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Unregister this phone (204 also when the token is unknown or not yours)' })
  @Roles(EnumUserRole.COURIER)
  async unregister(
    @common.Param('token') token: string,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<void> {
    await this.courierDeviceDomainService.unregister(courier.id, token)
  }
}
