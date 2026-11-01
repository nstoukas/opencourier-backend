import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import * as errors from 'src/errors'
import { DispatchStopService } from 'src/services/dispatch-stop/dispatch-stop.service'
import { DispatchStopCreateAdminInput } from './queries/dispatch-stop-create.admin.input'

// Stopping dispatch for heat or a storm (spec 0014): admins only.
@swagger.ApiBearerAuth()
@swagger.ApiTags('dispatch-stop')
@common.Controller(`${ADMIN_API_V1_PREFIX}/dispatch-stops`)
export class DispatchStopAdminRestApiController {
  constructor(private readonly dispatchStopService: DispatchStopService) {}

  // The stop on now, the scheduled ones and the last 50: the record (AC-8, AC-9).
  @common.Get('')
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Dispatch stops: current, scheduled and recent' })
  @Roles(EnumUserRole.ADMIN)
  async overview() {
    return this.dispatchStopService.adminOverview(new Date())
  }

  // The two delivery counts shown before Stop now (AC-9).
  @common.Get('preview')
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'How many offers would end and deliveries go back to waiting' })
  @Roles(EnumUserRole.ADMIN)
  async preview() {
    return this.dispatchStopService.preview()
  }

  // Stop now, or schedule a stop (AC-1, AC-2).
  @common.Post('')
  @swagger.ApiBody({ type: DispatchStopCreateAdminInput })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiConflictResponse({ description: 'Another stop covers part of that time' })
  @swagger.ApiOperation({ summary: 'Stop dispatch now, or schedule a stop' })
  @Roles(EnumUserRole.ADMIN)
  async create(@common.Body() body: DispatchStopCreateAdminInput, @CurrentUser() admin: UserEntity) {
    return this.dispatchStopService.create(body, admin.id)
  }

  // Restart (a stop that is on) or cancel (one that has not started) (AC-2, AC-3).
  @common.Post(':id/end')
  @common.HttpCode(200)
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Restart dispatch now, or cancel a scheduled stop' })
  @Roles(EnumUserRole.ADMIN)
  async end(@common.Param('id') id: string, @CurrentUser() admin: UserEntity) {
    return this.dispatchStopService.endOrCancel(id, admin.id)
  }
}
