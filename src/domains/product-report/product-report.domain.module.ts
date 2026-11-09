import { Module } from '@nestjs/common'
import { ProductReportDomainService } from './product-report.domain.service'

@Module({
  providers: [ProductReportDomainService],
  exports: [ProductReportDomainService],
})
export class ProductReportDomainModule {}
