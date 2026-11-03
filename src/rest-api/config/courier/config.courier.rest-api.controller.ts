import * as swagger from '@nestjs/swagger'
import * as common from '@nestjs/common'
import { COURIER_API_V1_PREFIX } from '../../../constants'
import { ConfigDomainService } from '../../../domains/config/config.domain.service'
import { AppVersionCustomerInput } from './queries/app-version.courier.input'
import { AppVersionCustomerDto } from './dtos/app-version.courier.dto'
import { ContactCourierDto } from './dtos/contact.courier.dto'
import { Public } from '../../../decorators/public.decorator'

@swagger.ApiBearerAuth()
@swagger.ApiTags('config')
@common.Controller(`${COURIER_API_V1_PREFIX}/config`)
export class ConfigCourierRestApiController {
  constructor(private readonly configDomainService: ConfigDomainService) {}

  @Public()
  @common.Post('app-version')
  @swagger.ApiBody({
    type: AppVersionCustomerInput,
  })
  @swagger.ApiOkResponse({ type: AppVersionCustomerDto })
  async checkAppVersion(@common.Body() data: AppVersionCustomerInput): Promise<AppVersionCustomerDto> {
    const result = await this.configDomainService.checkCourierAppVersion(data)
    return new AppVersionCustomerDto(result)
  }

  // Signed in riders only (no @Public): the number a rider calls from the job screen (row 72) and the
  // arrival radius the app detects arrivals with (spec 0021). The app already fetches this every ten
  // minutes, so the radius rides along instead of needing a route of its own.
  @common.Get('contact')
  @swagger.ApiOkResponse({ type: ContactCourierDto })
  async getContact(): Promise<ContactCourierDto> {
    const dispatchPhoneNumber = await this.configDomainService.instanceConfig.getDispatchPhoneNumber()
    const arrivalRadiusMetres = await this.configDomainService.instanceConfig.getArrivalRadiusMetres()
    // Spec 0027: the app shows shifts only while the co-op runs them.
    const shiftsEnabled = await this.configDomainService.instanceConfig.getShiftsEnabled()
    const shiftDropNoticeHours = await this.configDomainService.instanceConfig.getShiftDropNoticeHours()
    return new ContactCourierDto({ dispatchPhoneNumber, arrivalRadiusMetres, shiftsEnabled, shiftDropNoticeHours })
  }
}
