import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import type { Response } from 'express'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { langOf } from 'src/domains/statement/statement-labels'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { StatementDownloadRow, StatementService, formatOf } from 'src/services/statement/statement.service'
import { statementResponse } from '../statement-response'

// Spec 0050 (AC-9, cross check 14): a rider's statements for an admin. The same months and file the rider
// gets; every download is recorded and shown to the rider in "Changes by the co-op".
@swagger.ApiBearerAuth()
@swagger.ApiTags('statement')
@common.Controller(`${ADMIN_API_V1_PREFIX}/courier/:id/statements`)
export class StatementAdminRestApiController {
  constructor(private readonly statementService: StatementService) {}

  // The months offered and the past admin downloads of this rider's statements, newest first.
  @common.Get('')
  @swagger.ApiOkResponse({ description: '{ months, downloads }' })
  @Roles(EnumUserRole.ADMIN)
  async list(@common.Param('id') id: string): Promise<{ months: string[]; downloads: StatementDownloadRow[] }> {
    const [months, downloads] = await Promise.all([
      this.statementService.offeredMonths(id),
      this.statementService.downloads(id),
    ])
    return { months, downloads }
  }

  @common.Get(':month')
  @swagger.ApiQuery({ name: 'format', enum: ['pdf', 'csv'] })
  @swagger.ApiQuery({ name: 'lang', enum: ['el', 'en'], required: false })
  @swagger.ApiOkResponse({ description: 'The file' })
  @Roles(EnumUserRole.ADMIN)
  async file(
    @common.Param('id') id: string,
    @common.Param('month') month: string,
    @common.Query('format') format: string,
    @common.Query('lang') lang: string | undefined,
    @CurrentUser() admin: UserEntity,
    // `passthrough: true` lets this set headers and still return the file for Nest to send.
    @common.Res({ passthrough: true }) res: Response
  ): Promise<common.StreamableFile> {
    const file = await this.statementService.fileForAdmin(id, month, formatOf(format), langOf(lang), admin.id)
    return statementResponse(res, file)
  }
}
