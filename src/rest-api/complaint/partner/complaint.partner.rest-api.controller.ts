import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { PARTNER_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUserPartner } from 'src/decorators/currentUserPartner.decorator'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { ComplaintService } from 'src/services/complaint/complaint.service'
import { ComplaintPartnerDto, ComplaintPartnerPageDto } from '../dtos/complaint.dto'
import { ComplaintCreatePartnerInput, ComplaintListPartnerArgs } from '../dtos/complaint.inputs'

// Spec 0052 (AC-3, AC-7): a restaurant complains about the rider of one of its delivered or cancelled
// orders and reads the outcome. Only a signed in restaurant (no @ApiKeyAuth(), like chat): complaints
// are made by a person in request-web, never by an ordering integration's key.
@swagger.ApiBearerAuth()
@swagger.ApiTags('complaints')
@common.Controller(`${PARTNER_API_V1_PREFIX}/complaints`)
export class ComplaintPartnerRestApiController {
  constructor(private readonly complaintService: ComplaintService) {}

  @common.Post()
  @swagger.ApiCreatedResponse({ type: ComplaintPartnerDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ description: 'Not my order, or older than my order history' })
  @swagger.ApiConflictResponse({
    description: 'The order is not delivered or cancelled, it had no rider, or I already have an open complaint on it',
  })
  @swagger.ApiOperation({ summary: 'Complain about the rider of one of my orders' })
  @Roles(EnumUserRole.PARTNER)
  async file(
    @common.Body() input: ComplaintCreatePartnerInput,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<ComplaintPartnerDto> {
    return new ComplaintPartnerDto(await this.complaintService.fileByRestaurant(partner.id, input))
  }

  @common.Get()
  @swagger.ApiOkResponse({ type: ComplaintPartnerPageDto })
  @swagger.ApiOperation({ summary: 'The complaints I filed, newest first, optionally for one order' })
  @Roles(EnumUserRole.PARTNER)
  async list(
    @common.Query() args: ComplaintListPartnerArgs,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<ComplaintPartnerPageDto> {
    const page = await this.complaintService.listForPartner(partner.id, args)
    return { data: page.data.map((complaint) => new ComplaintPartnerDto(complaint)), pagination: page.pagination }
  }
}
