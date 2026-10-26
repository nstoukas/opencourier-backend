import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { EnumUserRole } from '@prisma/types'
import { PARTNER_API_V1_PREFIX, SEARCH_THROTTLE } from 'src/constants'
import { ApiKeyAuth } from 'src/decorators/api-key-auth.decorator'
import { CurrentUserPartner } from 'src/decorators/currentUserPartner.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { SavedCustomerDomainService } from 'src/domains/saved-customer/saved-customer.domain.service'
import * as errors from 'src/errors'
import {
  SavedCustomerListDto,
  SavedCustomerResultDto,
  SavedCustomerSaveResultDto,
} from './dtos/saved-customer.dto'
import { SavedCustomerCreatePartnerInput } from './queries/saved-customer-create.partner.input'
import { SavedCustomerListArgs, readSavedCustomerListArgs } from './queries/saved-customer-list.args'
import { SavedCustomerUpdateInput } from './queries/saved-customer-update.input'

// A restaurant's saved customers (spec 0005). The restaurant always comes from the login (the
// session's bearer token or an API key), never from the request, so a restaurant only ever reaches
// its own list; another restaurant's customer id answers 404, like an unknown one (AC-5).
@swagger.ApiBearerAuth()
@swagger.ApiTags('partner')
@common.Controller(`${PARTNER_API_V1_PREFIX}/customers`)
export class SavedCustomerPartnerRestApiController {
  constructor(private readonly savedCustomerDomainService: SavedCustomerDomainService) {}

  @common.Get()
  @swagger.ApiOkResponse({ type: SavedCustomerListDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiOperation({ summary: 'List or search saved customers, most recently used first' })
  // The order form searches as the restaurant types, and every restaurant shares request-web's one
  // address; this raises the limit for this route only, so searching never uses up the order limit.
  @Throttle(SEARCH_THROTTLE)
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async list(
    @common.Query() args: SavedCustomerListArgs,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<SavedCustomerListDto> {
    const { search, page, perPage } = readSavedCustomerListArgs(args)
    const result = await this.savedCustomerDomainService.list(partner.id, search, page, perPage)
    return new SavedCustomerListDto(result)
  }

  @common.Post()
  @swagger.ApiBody({ type: SavedCustomerCreatePartnerInput })
  @swagger.ApiCreatedResponse({ type: SavedCustomerSaveResultDto })
  @swagger.ApiConflictResponse({ description: 'Another saved customer has this phone (with onPhoneClash refuse)' })
  @swagger.ApiUnprocessableEntityResponse({ type: errors.SavedCustomerRefusedException })
  @swagger.ApiOperation({ summary: 'Save a customer, or with onPhoneClash update, the one with this phone' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async create(
    @common.Body() data: SavedCustomerCreatePartnerInput,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<SavedCustomerSaveResultDto> {
    // `input` may carry unknown extra fields (the pipe does not strip them); the domain service copies
    // only the fields it knows, so never pass `input` straight to Prisma.
    const { onPhoneClash, markUsed, ...input } = data
    const result = await this.savedCustomerDomainService.create(
      partner.id,
      input,
      onPhoneClash ?? 'refuse',
      markUsed ?? false
    )
    return new SavedCustomerSaveResultDto(result)
  }

  @common.Patch(':id')
  @swagger.ApiBody({ type: SavedCustomerUpdateInput })
  @swagger.ApiOkResponse({ type: SavedCustomerResultDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'Another saved customer has this phone' })
  @swagger.ApiUnprocessableEntityResponse({ type: errors.SavedCustomerRefusedException })
  @swagger.ApiOperation({ summary: 'Change a saved customer' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async update(
    @common.Param('id') id: string,
    @common.Body() data: SavedCustomerUpdateInput,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<SavedCustomerResultDto> {
    const { markUsed, ...input } = data
    const customer = await this.savedCustomerDomainService.update(partner.id, id, input, markUsed ?? false)
    return new SavedCustomerResultDto(customer)
  }

  @common.Post(':id/used')
  // 204 "No Content" instead of Nest's default 201 for a POST: there is nothing to send back.
  @common.HttpCode(204)
  @swagger.ApiNoContentResponse()
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'An order used this saved customer (its details unchanged)' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async markUsed(@common.Param('id') id: string, @CurrentUserPartner() partner: PartnerEntity): Promise<void> {
    await this.savedCustomerDomainService.markUsed(partner.id, id)
  }

  @common.Delete(':id')
  @common.HttpCode(204)
  @swagger.ApiNoContentResponse()
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Delete a saved customer and its address for good (past orders keep theirs)' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async delete(@common.Param('id') id: string, @CurrentUserPartner() partner: PartnerEntity): Promise<void> {
    await this.savedCustomerDomainService.delete(partner.id, id)
  }
}
