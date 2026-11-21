import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import * as errors from 'src/errors'
import { ShiftOfflineService } from 'src/services/shift-offline/shift-offline.service'
import { ShiftOfflineEventAdminDto } from './dtos/shift-offline-event.admin.dto'

// Spec 0049 (AC-6): Offline during a booked shift, for admins to follow up in person. No search, filter or
// sort by rider, and no count anywhere (cross check 3, value 5).
@swagger.ApiBearerAuth()
@swagger.ApiTags('shift-offline')
@common.Controller(`${ADMIN_API_V1_PREFIX}/shifts/offline-events`)
export class ShiftOfflineAdminRestApiController {
  constructor(private readonly shiftOfflineService: ShiftOfflineService) {}

  // Open items, and the followed up ones for 7 days, newest first.
  @common.Get('')
  @swagger.ApiOkResponse({ type: [ShiftOfflineEventAdminDto] })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @Roles(EnumUserRole.ADMIN)
  async list(): Promise<ShiftOfflineEventAdminDto[]> {
    const events = await this.shiftOfflineService.adminList(new Date())
    return events.map((event) => new ShiftOfflineEventAdminDto(event))
  }

  // Records which admin followed it up, and when. 409 if it already was.
  @common.Post(':id/followed-up')
  @common.HttpCode(204)
  @swagger.ApiNoContentResponse()
  @swagger.ApiNotFoundResponse({ description: 'No such item' })
  @swagger.ApiConflictResponse({ description: 'Already followed up' })
  @Roles(EnumUserRole.ADMIN)
  async followUp(@common.Param('id') id: string, @CurrentUser() admin: UserEntity): Promise<void> {
    await this.shiftOfflineService.followUp(id, admin.id, new Date())
  }
}
