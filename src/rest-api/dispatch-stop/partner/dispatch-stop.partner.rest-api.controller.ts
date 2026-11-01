import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { PARTNER_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import * as errors from 'src/errors'
import { DispatchState, DispatchStopService } from 'src/services/dispatch-stop/dispatch-stop.service'

// Whether dispatch is stopped and until when, for the restaurants' banner (spec 0014). Reason, times and
// the sentence to show; never who stopped it (AC-10).
@swagger.ApiBearerAuth()
@swagger.ApiTags('dispatch-state')
@common.Controller(`${PARTNER_API_V1_PREFIX}/dispatch-state`)
export class DispatchStopPartnerRestApiController {
  constructor(private readonly dispatchStopService: DispatchStopService) {}

  @common.Get('')
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'The dispatch stop on now, and the next one starting soon' })
  @Roles(EnumUserRole.PARTNER)
  async state(): Promise<DispatchState> {
    return this.dispatchStopService.state('partner', new Date())
  }
}
