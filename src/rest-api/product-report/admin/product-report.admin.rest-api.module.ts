import { Module } from '@nestjs/common'
import { ProductReportDomainModule } from 'src/domains/product-report/product-report.domain.module'
import { ProductReportAdminRestApiController } from './product-report.admin.rest-api.controller'

@Module({
  imports: [ProductReportDomainModule],
  controllers: [ProductReportAdminRestApiController],
})
export class ProductReportAdminRestApiModule {}
