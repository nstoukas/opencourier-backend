import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import { WorkRulesService } from 'src/services/work-rules/work-rules.service'
import { ReviewPageArgs } from 'src/rest-api/review-request/queries/review-request.inputs'
import { SettingChangeAdminPageDto } from '../setting-change.dto'

// Spec 0038, AC-13: the Change history on Instance configuration. Every change, with who saved it.
@swagger.ApiBearerAuth()
@swagger.ApiTags('work-rules')
@common.Controller(`${ADMIN_API_V1_PREFIX}/setting-changes`)
export class SettingChangeAdminRestApiController {
  constructor(private readonly workRulesService: WorkRulesService) {}

  @common.Get()
  @swagger.ApiOkResponse({ type: SettingChangeAdminPageDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Every settings change, newest first' })
  @Roles(EnumUserRole.ADMIN)
  async list(@common.Query() args: ReviewPageArgs): Promise<SettingChangeAdminPageDto> {
    return this.workRulesService.adminChanges(args)
  }
}
