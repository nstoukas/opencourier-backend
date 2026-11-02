import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import * as errors from 'src/errors'
import { SosService } from 'src/services/sos/sos.service'
import {
  SosIncidentAdminDto,
  SosIncidentDetailAdminDto,
  SosIncidentPageAdminDto,
} from './dtos/sos-incident.admin.dto'
import { SosCloseAdminInput } from './queries/sos-close.admin.input'
import { SosListAdminArgs } from './queries/sos-list.admin.args'

const DEFAULT_CLOSED_PAGE_SIZE = 20

// The co-op's view of riders' SOS incidents (spec 0022): admins only.
@swagger.ApiBearerAuth()
@swagger.ApiTags('sos')
@common.Controller(`${ADMIN_API_V1_PREFIX}/sos`)
export class SosAdminRestApiController {
  constructor(private readonly sosService: SosService) {}

  // `status=current`: active and awaiting close, all of them, for the banner every admin page polls
  // (AC-8). `status=closed`: closed ones, a page at a time, newest first (AC-9).
  @common.Get('')
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'SOS incidents: current (all) or closed (paged)' })
  @Roles(EnumUserRole.ADMIN)
  async list(@common.Query() args: SosListAdminArgs): Promise<SosIncidentAdminDto[] | SosIncidentPageAdminDto> {
    if (args.status === 'current') {
      const incidents = await this.sosService.listCurrent()
      return incidents.map((incident) => new SosIncidentAdminDto(incident))
    }
    const page = args.page ?? 1
    const limit = args.limit ?? DEFAULT_CLOSED_PAGE_SIZE
    const { data, total } = await this.sosService.listClosed(page, limit)
    return {
      data: data.map((incident) => new SosIncidentAdminDto(incident)),
      pagination: { page, limit, totalItems: total, totalPages: Math.ceil(total / limit) },
    }
  }

  // One incident and its trail (AC-9). The trail is empty once the retention job deleted it.
  @common.Get(':id')
  @swagger.ApiOkResponse({ type: SosIncidentDetailAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'One SOS incident with its location points' })
  @Roles(EnumUserRole.ADMIN)
  async findOne(@common.Param('id') id: string): Promise<SosIncidentDetailAdminDto> {
    const { incident, points } = await this.sosService.findForAdmin(id)
    return new SosIncidentDetailAdminDto(incident, points)
  }

  // Close with an outcome (AC-10). Ends the sharing if it was still active; 409 if already closed.
  @common.Post(':id/close')
  @common.HttpCode(200)
  @swagger.ApiBody({ type: SosCloseAdminInput })
  @swagger.ApiOkResponse({ type: SosIncidentAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'Already closed' })
  @swagger.ApiOperation({ summary: 'Close an SOS incident with an outcome' })
  @Roles(EnumUserRole.ADMIN)
  async close(
    @common.Param('id') id: string,
    @common.Body() body: SosCloseAdminInput,
    @CurrentUser() admin: UserEntity
  ): Promise<SosIncidentAdminDto> {
    const incident = await this.sosService.close(id, admin.id, body, new Date())
    return new SosIncidentAdminDto(incident)
  }
}
