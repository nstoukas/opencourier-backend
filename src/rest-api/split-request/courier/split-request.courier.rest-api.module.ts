import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { SplitRequestModule } from 'src/services/split-request/split-request.module'
import { SplitRequestCourierRestApiController } from './split-request.courier.rest-api.controller'

@Module({
  imports: [SplitRequestModule, ConfigDomainModule],
  controllers: [SplitRequestCourierRestApiController],
})
export class SplitRequestCourierRestApiModule {}
