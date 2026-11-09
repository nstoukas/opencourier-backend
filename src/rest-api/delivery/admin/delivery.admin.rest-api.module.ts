import { Module } from '@nestjs/common'
import { DeliveryDomainModule } from '../../../domains/delivery/delivery.domain.module'
import { DeliveryEventDomainModule } from '../../../domains/delivery-event/delivery-event.domain.module'
import { DeliveryAdminRestApiController } from './delivery.admin.rest-api.controller'
import { DeliveryIssueDomainModule } from '../../../domains/delivery-issue/delivery-issue.domain.module'
import { ProductReportDomainModule } from '../../../domains/product-report/product-report.domain.module'

@Module({
  imports: [DeliveryDomainModule, DeliveryEventDomainModule, DeliveryIssueDomainModule, ProductReportDomainModule],
  controllers: [DeliveryAdminRestApiController],
})
export class DeliveryAdminRestApiModule {}
