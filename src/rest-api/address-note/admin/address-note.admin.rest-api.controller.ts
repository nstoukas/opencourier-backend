import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { LocationNoteDomainService } from 'src/domains/location-note/location-note.domain.service'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import * as errors from 'src/errors'
import { AddressNoteAdminDto, AddressNoteSearchAdminDto } from './dtos/address-note.admin.dto'
import { AddressNoteSearchAdminArgs } from './queries/address-note-search.admin.args'

const DEFAULT_PER_PAGE = 25

// Spec 0053 (AC-7): the admin Address notes page. Flagged notes first, then a search by street, and
// two actions: Delete (recorded in AddressNoteDeletion, the text not kept) and Dismiss flags.
@swagger.ApiBearerAuth()
@swagger.ApiTags('address-notes')
@common.Controller(`${ADMIN_API_V1_PREFIX}/address-notes`)
export class AddressNoteAdminRestApiController {
  constructor(private readonly locationNoteDomainService: LocationNoteDomainService) {}

  @common.Get('flagged')
  @swagger.ApiOkResponse({ type: [AddressNoteAdminDto] })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @Roles(EnumUserRole.ADMIN)
  async flagged(): Promise<AddressNoteAdminDto[]> {
    const notes = await this.locationNoteDomainService.adminFlagged()
    return notes.map((note) => new AddressNoteAdminDto(note))
  }

  // No search lists every note, newest confirmed first. The HTTP logger redacts `search=` (row 96).
  @common.Get('')
  @swagger.ApiOkResponse({ type: AddressNoteSearchAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @Roles(EnumUserRole.ADMIN)
  async search(@common.Query() args: AddressNoteSearchAdminArgs): Promise<AddressNoteSearchAdminDto> {
    const page = args.page ?? 1
    const perPage = args.perPage ?? DEFAULT_PER_PAGE
    const result = await this.locationNoteDomainService.adminSearch(args.search ?? '', page, perPage)
    return { data: result.data.map((note) => new AddressNoteAdminDto(note)), total: result.total, page, perPage }
  }

  @common.Delete(':id')
  @common.HttpCode(204)
  @swagger.ApiNoContentResponse()
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @Roles(EnumUserRole.ADMIN)
  async delete(@common.Param('id') id: string, @CurrentUser() admin: UserEntity): Promise<void> {
    await this.locationNoteDomainService.adminDelete(id, admin.id)
  }

  @common.Post(':id/dismiss-flags')
  @common.HttpCode(204)
  @swagger.ApiNoContentResponse()
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @Roles(EnumUserRole.ADMIN)
  async dismissFlags(@common.Param('id') id: string): Promise<void> {
    await this.locationNoteDomainService.adminDismissFlags(id)
  }
}
