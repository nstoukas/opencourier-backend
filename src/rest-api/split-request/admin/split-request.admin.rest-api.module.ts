import { Module } from '@nestjs/common'
import { SplitRequestModule } from 'src/services/split-request/split-request.module'
import { SplitRequestAdminRestApiController } from './split-request.admin.rest-api.controller'

@Module({
  imports: [SplitRequestModule],
  controllers: [SplitRequestAdminRestApiController],
})
export class SplitRequestAdminRestApiModule {}
