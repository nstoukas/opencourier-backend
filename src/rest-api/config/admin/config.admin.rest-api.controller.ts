import * as swagger from '@nestjs/swagger'
import * as common from '@nestjs/common'
import { ConfigDomainService } from '../../../domains/config/config.domain.service'
import { InstanceConfigSettingsDto } from './dtos/instance-config-settings.dto'
import { Roles } from 'src/decorators/roles.decorator'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { InstanceConfigSettingsOptionsDto } from './dtos/instance-config-settings-options.dto'
import { InstanceConfigSettingsAdminInput } from './queries/instance-config-settings.admin.input'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'

@swagger.ApiBearerAuth()
@swagger.ApiTags('config')
@common.Controller(`${ADMIN_API_V1_PREFIX}/config`)
export class ConfigAdminRestApiController {
  constructor(private readonly configDomainService: ConfigDomainService) {}

  @common.Get('instance-config')
  @swagger.ApiOkResponse({ type: InstanceConfigSettingsDto })
  @Roles(EnumUserRole.ADMIN)
  async getInstanceConfig(): Promise<InstanceConfigSettingsDto> {
    const result = await this.configDomainService.instanceConfig.getInstanceConfigSettings()
    return new InstanceConfigSettingsDto(result)
  }

  @common.Post('instance-config')
  @swagger.ApiBody({
    type: InstanceConfigSettingsAdminInput,
  })
  @swagger.ApiOkResponse({ type: InstanceConfigSettingsDto })
  @Roles(EnumUserRole.ADMIN)
  // @CurrentUser() hands the logged in admin to the method, so each SettingChange names who saved
  // it (spec 0038, AC-12).
  async setInstanceConfig(
    @common.Body() data: InstanceConfigSettingsAdminInput,
    @CurrentUser() admin: UserEntity
  ): Promise<InstanceConfigSettingsDto> {
    const result = await this.configDomainService.instanceConfig.setInstanceConfigSettings(data, admin.id)
    return new InstanceConfigSettingsDto(result)
  }

  @common.Get('instance-config-options')
  @swagger.ApiOkResponse({ type: InstanceConfigSettingsOptionsDto })
  @Roles(EnumUserRole.ADMIN)
  async getInstanceConfigOptions(): Promise<InstanceConfigSettingsOptionsDto> {
    const result = await this.configDomainService.instanceConfig.getInstanceConfigSettingsOptions()
    return new InstanceConfigSettingsOptionsDto(result)
  }
}
