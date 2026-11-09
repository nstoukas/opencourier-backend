import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { ProductReportDomainService } from 'src/domains/product-report/product-report.domain.service'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import * as errors from 'src/errors'
import { ProductReportAdminDto } from './product-report.admin.dto'
import { ProductReportFindManyAdminArgs, ProductReportResolveAdminInput } from './product-report-find-many.admin.args'

// Spec 0032, AC-6 and AC-7: the admin's list of reports and resolving one.
@swagger.ApiBearerAuth()
@swagger.ApiTags('product-reports')
@common.Controller(`${ADMIN_API_V1_PREFIX}/product-reports`)
export class ProductReportAdminRestApiController {
  constructor(private readonly productReportDomainService: ProductReportDomainService) {}

  @common.Get('')
  @swagger.ApiOperation({ summary: 'List product reports' })
  @Roles(EnumUserRole.ADMIN)
  async list(@common.Query() args: ProductReportFindManyAdminArgs) {
    const result = await this.productReportDomainService.listPage(args.state ?? 'open', args.page, args.perPage)
    return { data: result.data.map((report) => new ProductReportAdminDto(report)), pagination: result.pagination }
  }

  @common.Post(':id/resolve')
  @common.HttpCode(200)
  @swagger.ApiResponse({ type: ProductReportAdminDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Resolve a product report' })
  @Roles(EnumUserRole.ADMIN)
  async resolve(
    @common.Param('id') id: string,
    @common.Body() input: ProductReportResolveAdminInput,
    @CurrentUser() user: UserEntity
  ) {
    const report = await this.productReportDomainService.resolve(id, user.id, input.resolution)
    return report ? new ProductReportAdminDto(report) : null
  }
}
