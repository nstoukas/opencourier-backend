import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from '../../../constants'
import { Roles } from 'src/decorators/roles.decorator'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import { PickupPointCourierDto } from './dtos/pickup-point.courier.dto'

// Spec 0018 (AC-4): the restaurants a rider can see on the map, for the restaurant layer.
@swagger.ApiBearerAuth()
@swagger.ApiTags('partners')
@common.Controller(`${COURIER_API_V1_PREFIX}/partners`)
export class PartnerCourierRestApiController {
  constructor(private readonly partnerDomainService: PartnerDomainService) {}

  @common.Get('pickup-points')
  @swagger.ApiOkResponse({ type: PickupPointCourierDto, isArray: true })
  @swagger.ApiOperation({ summary: "Every restaurant's name and pickup point" })
  @Roles(EnumUserRole.COURIER)
  async getPickupPoints(): Promise<PickupPointCourierDto[]> {
    const points = await this.partnerDomainService.getPickupPoints()
    return points.map((point) => new PickupPointCourierDto(point))
  }
}
