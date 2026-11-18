import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import { AvailabilityActor, PartnerAvailabilityDomainService } from 'src/domains/partner/partner-availability.domain.service'
import * as errors from 'src/errors'
import { PartnerAdminDto } from './dtos/partner.admin.dto'
import { PartnerApiKeyAdminDto, PartnerRotatePasswordAdminDto } from './dtos/partner-api-key.admin.dto'
import { PartnerAvailabilityChangeAdminDto } from './dtos/partner-availability.admin.dto'
import { PartnerWaitRecordAdminDto } from './dtos/partner-wait-record.admin.dto'
import { PartnerWaitRecordAdminArgs } from './queries/partner-wait-record.admin.args'
import { DEFAULT_WAIT_RECORD_DAYS } from 'src/domains/partner/wait-record'
import { PartnerWaitRecordDomainService } from 'src/domains/partner/partner-wait-record.domain.service'
import { PartnerDisableAdminInput } from './queries/partner-disable.admin.input'
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
    private readonly partnerAvailabilityDomainService: PartnerAvailabilityDomainService,
    private readonly partnerWaitRecordDomainService: PartnerWaitRecordDomainService,
  ) {}

  @common.Get('')
  @swagger.ApiResponse({ type: PartnerPaginatedAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'List partners (restaurants)' })
  @Roles(EnumUserRole.ADMIN)
  async listPartners(@common.Query() args: PartnerFindManyAdminArgs): Promise<PartnerPaginatedAdminDto> {
    const result = await this.partnerDomainService.getMany(args.page, args.perPage, args.search)
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
  // Spec 0037, AC-1: answers 200 with the restaurant's new API key (shown once) when it had one, else
  // `apiKey: null`. Was 204 with no body before spec 0037.
  @swagger.ApiResponse({ status: 200, type: PartnerRotatePasswordAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Rotate partner password' })
  @common.HttpCode(200)
  @Roles(EnumUserRole.ADMIN)
  async rotatePartnerPassword(
    @common.Param('id') id: string,
    @common.Body() body: PartnerRotatePasswordAdminInput,
    @CurrentUser() admin: UserEntity,
  ): Promise<PartnerRotatePasswordAdminDto> {
    const apiKey = await this.partnerAdminRestApiService.rotatePassword(id, body.password, admin.id)
    return new PartnerRotatePasswordAdminDto(apiKey)
  }

  // Spec 0037, AC-3: a new API key for the restaurant, replacing any earlier one. The key is in this
  // answer only; the server keeps its hash.
  @common.Post(':id/api-key')
  @swagger.ApiResponse({ status: 201, type: PartnerApiKeyAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: "Make a new API key for a restaurant (shown once)" })
  @Roles(EnumUserRole.ADMIN)
  async createPartnerApiKey(
    @common.Param('id') id: string,
    @CurrentUser() admin: UserEntity,
  ): Promise<PartnerApiKeyAdminDto> {
    const { apiKey, apiKeyCreatedAt } = await this.partnerAdminRestApiService.createApiKey(id, admin.id)
    return new PartnerApiKeyAdminDto(apiKey, apiKeyCreatedAt)
  }

  // Spec 0037, AC-4: the restaurant's API key stops working. 204 also when it had none.
  @common.Delete(':id/api-key')
  @common.HttpCode(204)
  @swagger.ApiResponse({ status: 204, description: 'The API key is removed' })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: "Remove a restaurant's API key" })
  @Roles(EnumUserRole.ADMIN)
  async removePartnerApiKey(@common.Param('id') id: string, @CurrentUser() admin: UserEntity): Promise<void> {
    await this.partnerAdminRestApiService.removeApiKey(id, admin.id)
  }

  // Spec 0029, AC-5: an admin disables a restaurant, with a reason.
  @common.Post(':id/disable')
  @common.HttpCode(200)
  @swagger.ApiBody({ type: PartnerDisableAdminInput })
  @swagger.ApiResponse({ type: PartnerAdminDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Disable a restaurant' })
  @Roles(EnumUserRole.ADMIN)
  async disablePartner(
    @common.Param('id') id: string,
    @common.Body() input: PartnerDisableAdminInput,
    @CurrentUser() user: UserEntity
  ): Promise<PartnerAdminDto> {
    const now = new Date()
    const partner = await this.partnerDomainService.getByIdOrThrow(id)
    const updated = await this.partnerAvailabilityDomainService.disable(partner, this.actorOf(user), input.reason, now)
    return new PartnerAdminDto(updated, now)
  }

  @common.Post(':id/enable')
  @common.HttpCode(200)
  @swagger.ApiResponse({ type: PartnerAdminDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Enable a restaurant again' })
  @Roles(EnumUserRole.ADMIN)
  async enablePartner(@common.Param('id') id: string, @CurrentUser() user: UserEntity): Promise<PartnerAdminDto> {
    const partner = await this.partnerDomainService.getByIdOrThrow(id)
    const updated = await this.partnerAvailabilityDomainService.enable(partner, this.actorOf(user))
    return new PartnerAdminDto(updated)
  }

  // Spec 0029, AC-9: the restaurant's last availability changes, newest first.
  @common.Get(':id/availability-changes')
  @swagger.ApiResponse({ type: [PartnerAvailabilityChangeAdminDto] })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: "List a restaurant's availability changes" })
  @Roles(EnumUserRole.ADMIN)
  async getAvailabilityChanges(@common.Param('id') id: string): Promise<PartnerAvailabilityChangeAdminDto[]> {
    await this.partnerDomainService.getByIdOrThrow(id)
    const changes = await this.partnerAvailabilityDomainService.getChanges(id)
    return changes.map((change) => new PartnerAvailabilityChangeAdminDto(change))
  }

  // Spec 0030, AC-1: one restaurant's wait record.
  @common.Get(':id/wait-record')
  @swagger.ApiResponse({ type: PartnerWaitRecordAdminDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: "A restaurant's wait record" })
  @Roles(EnumUserRole.ADMIN)
  async getWaitRecord(
    @common.Param('id') id: string,
    @common.Query() args: PartnerWaitRecordAdminArgs
  ): Promise<PartnerWaitRecordAdminDto> {
    const partner = await this.partnerDomainService.getByIdOrThrow(id)
    const record = await this.partnerWaitRecordDomainService.getWaitRecord(
      partner,
      args.days ?? DEFAULT_WAIT_RECORD_DAYS,
      new Date()
    )
    return new PartnerWaitRecordAdminDto(record)
  }

  private actorOf(user: UserEntity): AvailabilityActor {
    return { role: EnumUserRole.ADMIN, userId: user.id }
  }
}
