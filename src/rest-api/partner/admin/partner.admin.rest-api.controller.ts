import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import * as errors from 'src/errors'
import { PartnerAdminDto } from './dtos/partner.admin.dto'
import { PartnerPaginatedAdminDto } from './dtos/partner.admin.paginated.dto'
import { PartnerAdminRestApiService } from './partner.admin.rest-api.service'
import { PartnerCreateAdminInput } from './queries/partner-create.admin.input'
import { PartnerFindManyAdminArgs } from './queries/partner-find-many.admin.args'
import { PartnerRotatePasswordAdminInput } from './queries/partner-rotate-password.admin.input'
import { PartnerUpdateAdminInput } from './queries/partner-update.admin.input'

@swagger.ApiBearerAuth()
@swagger.ApiTags('partner')
@common.Controller(`${ADMIN_API_V1_PREFIX}/partner`)
export class PartnerAdminRestApiController {
  constructor(
    private readonly partnerDomainService: PartnerDomainService,
    private readonly partnerAdminRestApiService: PartnerAdminRestApiService,
  ) {}

  @common.Get('')
  @swagger.ApiResponse({ type: PartnerPaginatedAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'List partners (restaurants)' })
  @Roles(EnumUserRole.ADMIN)
  async listPartners(@common.Query() args: PartnerFindManyAdminArgs): Promise<PartnerPaginatedAdminDto> {
    const result = await this.partnerDomainService.getMany(args.page, args.perPage)
    return new PartnerPaginatedAdminDto(result)
  }

  @common.Get(':id')
  @swagger.ApiResponse({ type: PartnerAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Get partner by id' })
  @Roles(EnumUserRole.ADMIN)
  async getPartnerById(@common.Param('id') id: string): Promise<PartnerAdminDto> {
    const partner = await this.partnerDomainService.getByIdOrThrow(id)
    return new PartnerAdminDto(partner)
  }

  @common.Post('')
  @swagger.ApiBody({ type: PartnerCreateAdminInput })
  @swagger.ApiResponse({ type: PartnerAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Create partner (restaurant)' })
  @Roles(EnumUserRole.ADMIN)
  async createPartner(@common.Body() body: PartnerCreateAdminInput): Promise<PartnerAdminDto> {
    const partner = await this.partnerAdminRestApiService.createRestaurant(body)
    return new PartnerAdminDto(partner)
  }

  @common.Patch(':id')
  @swagger.ApiBody({ type: PartnerUpdateAdminInput })
  @swagger.ApiResponse({ type: PartnerAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Update partner (restaurant)' })
  @Roles(EnumUserRole.ADMIN)
  async updatePartner(
    @common.Param('id') id: string,
    @common.Body() body: PartnerUpdateAdminInput,
  ): Promise<PartnerAdminDto> {
    const partner = await this.partnerAdminRestApiService.updateRestaurant(id, body)
    return new PartnerAdminDto(partner)
  }

  @common.Post(':id/rotate-password')
  @swagger.ApiBody({ type: PartnerRotatePasswordAdminInput })
  @swagger.ApiResponse({ status: 204, description: 'Password rotated successfully' })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Rotate partner password' })
  @common.HttpCode(204)
  @Roles(EnumUserRole.ADMIN)
  async rotatePartnerPassword(
    @common.Param('id') id: string,
    @common.Body() body: PartnerRotatePasswordAdminInput,
  ): Promise<void> {
    await this.partnerAdminRestApiService.rotatePassword(id, body.password)
  }
}
