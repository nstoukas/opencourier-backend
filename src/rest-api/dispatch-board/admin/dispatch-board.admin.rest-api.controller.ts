import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import * as errors from 'src/errors'
import { DispatchBoardService } from 'src/services/dispatch-board/dispatch-board.service'
import { DispatchBoardAdminDto } from './dtos/dispatch-board.admin.dto'

// What a dispatcher sees at a glance (spec 0034): admins only.
@swagger.ApiBearerAuth()
@swagger.ApiTags('dispatch')
@common.Controller(`${ADMIN_API_V1_PREFIX}/dispatch`)
export class DispatchBoardAdminRestApiController {
  constructor(private readonly dispatchBoardService: DispatchBoardService) {}

  @common.Get('board')
  // @SkipThrottle leaves this route out of the global limit of 30 requests a minute per IP (AC-17):
  // admins sharing an office connection, each polling every 10 s, would trip it.
  @SkipThrottle()
  @swagger.ApiOkResponse({ type: DispatchBoardAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'The live Dispatch board' })
  @Roles(EnumUserRole.ADMIN)
  async getBoard(): Promise<DispatchBoardAdminDto> {
    return new DispatchBoardAdminDto(await this.dispatchBoardService.getBoard())
  }
}
