import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import { SavedCustomerDomainService } from 'src/domains/saved-customer/saved-customer.domain.service'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import * as errors from 'src/errors'
import { SavedCustomerListDto, SavedCustomerResultDto } from '../partner/dtos/saved-customer.dto'
import { SavedCustomerListArgs, readSavedCustomerListArgs } from '../partner/queries/saved-customer-list.args'
import { SavedCustomerUpdateInput } from '../partner/queries/saved-customer-update.input'

// Any restaurant's saved customers, for the co-op's admins (spec 0005, AC-6): to correct one, or to
// honour a customer's request to be deleted. No add: customers are saved by their restaurant.
// Every edit and delete is logged with the admin's user id, the restaurant id and the customer id.
@swagger.ApiBearerAuth()
@swagger.ApiTags('partner')
@common.Controller(`${ADMIN_API_V1_PREFIX}/partners/:partnerId/customers`)
export class SavedCustomerAdminRestApiController {
  constructor(
    private readonly savedCustomerDomainService: SavedCustomerDomainService,
    private readonly partnerDomainService: PartnerDomainService
  ) {}

  @common.Get()
  @swagger.ApiOkResponse({ type: SavedCustomerListDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: "List or search a restaurant's saved customers" })
  @Roles(EnumUserRole.ADMIN)
  async list(
    @common.Param('partnerId') partnerId: string,
    @common.Query() args: SavedCustomerListArgs
  ): Promise<SavedCustomerListDto> {
    const { search, page, perPage } = readSavedCustomerListArgs(args)
    // An unknown restaurant is a 404, not an empty list, so a wrong link is noticed.
    const partner = await this.partnerDomainService.getById(partnerId)
    if (!partner) {
      throw new errors.NotFoundException('Partner not found')
    }
    const result = await this.savedCustomerDomainService.list(partnerId, search, page, perPage)
    return new SavedCustomerListDto(result)
  }

  @common.Patch(':id')
  @swagger.ApiBody({ type: SavedCustomerUpdateInput })
  @swagger.ApiOkResponse({ type: SavedCustomerResultDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'Another saved customer of this restaurant has this phone' })
  @swagger.ApiUnprocessableEntityResponse({ type: errors.SavedCustomerRefusedException })
  @swagger.ApiOperation({ summary: "Correct a restaurant's saved customer" })
  @Roles(EnumUserRole.ADMIN)
  async update(
    @common.Param('partnerId') partnerId: string,
    @common.Param('id') id: string,
    @common.Body() data: SavedCustomerUpdateInput,
    @CurrentUser() admin: UserEntity
  ): Promise<SavedCustomerResultDto> {
    // markUsed is ignored: an admin's correction is not an order.
    const { markUsed: _markUsed, ...input } = data
    const customer = await this.savedCustomerDomainService.updateAsAdmin(admin.id, partnerId, id, input)
    return new SavedCustomerResultDto(customer)
  }

  @common.Delete(':id')
  // 204 "No Content": nothing to send back.
  @common.HttpCode(204)
  @swagger.ApiNoContentResponse()
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: "Delete a restaurant's saved customer for good (past orders keep theirs)" })
  @Roles(EnumUserRole.ADMIN)
  async delete(
    @common.Param('partnerId') partnerId: string,
    @common.Param('id') id: string,
    @CurrentUser() admin: UserEntity
  ): Promise<void> {
    await this.savedCustomerDomainService.deleteAsAdmin(admin.id, partnerId, id)
  }
}
