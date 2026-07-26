import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { PARTNER_API_V1_PREFIX } from 'src/constants'
import { ApiKeyAuth } from 'src/decorators/api-key-auth.decorator'
import { CurrentUserPartner } from 'src/decorators/currentUserPartner.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { LocationDomainService } from 'src/domains/location/location.domain.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import * as errors from 'src/errors'
import { PartnerProfileDto } from './dtos/partner-profile.partner.dto'

// Only system admins can alter partner profile fields; no mutation endpoints exist in the partner namespace.
@swagger.ApiBearerAuth()
@swagger.ApiTags('partner')
@common.Controller(`${PARTNER_API_V1_PREFIX}/partner`)
export class PartnerPartnerRestApiController {
  constructor(private readonly locationDomainService: LocationDomainService) {}

  @common.Get('profile')
  @swagger.ApiResponse({ type: PartnerProfileDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Get partner profile' })
  // ApiKeyAuth allows request authentication via either an API key header or a Bearer token.
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async getProfile(@CurrentUserPartner() partner: PartnerEntity): Promise<PartnerProfileDto> {
    const pickupLocation = partner.pickupLocationId
      ? await this.locationDomainService.getById(partner.pickupLocationId)
      : null
    return new PartnerProfileDto({ partner, pickupLocation })
  }
}
