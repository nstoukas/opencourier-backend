import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import { WorkRulesService } from 'src/services/work-rules/work-rules.service'
import { ReviewPageArgs } from 'src/rest-api/review-request/queries/review-request.inputs'
import { HowItWorksCourierDto, SettingChangeCourierPageDto } from '../setting-change.dto'

// Spec 0038: what the rider's "How offers and pay work" page reads. Nothing here names a person or
// says anything about another rider.
@swagger.ApiBearerAuth()
@swagger.ApiTags('work-rules')
@common.Controller(COURIER_API_V1_PREFIX)
export class SettingChangeCourierRestApiController {
  constructor(private readonly workRulesService: WorkRulesService) {}

  @common.Get('how-it-works')
  @swagger.ApiOkResponse({ type: HowItWorksCourierDto })
  @swagger.ApiOperation({ summary: 'How offers and pay work, from the settings in effect now' })
  // Row 137: the app sends its own language; anything but "el" reads English, as before.
  @swagger.ApiQuery({ name: 'lang', required: false, enum: ['el', 'en'] })
  @Roles(EnumUserRole.COURIER)
  async howItWorks(@common.Query('lang') lang?: string): Promise<HowItWorksCourierDto> {
    return this.workRulesService.howItWorks(lang === 'el' ? 'el' : 'en')
  }

  @common.Get('setting-changes')
  @swagger.ApiOkResponse({ type: SettingChangeCourierPageDto })
  @swagger.ApiOperation({ summary: 'Changes to the settings that affect my work, newest first' })
  // Row 137: the same language choice as how-it-works.
  @swagger.ApiQuery({ name: 'lang', required: false, enum: ['el', 'en'] })
  @Roles(EnumUserRole.COURIER)
  async changes(
    @common.Query() args: ReviewPageArgs,
    @common.Query('lang') lang?: string
  ): Promise<SettingChangeCourierPageDto> {
    return this.workRulesService.riderChanges({ page: args.page, perPage: args.perPage }, lang === 'el' ? 'el' : 'en')
  }
}
