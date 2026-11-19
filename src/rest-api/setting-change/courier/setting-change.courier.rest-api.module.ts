import { Module } from '@nestjs/common'
import { WorkRulesModule } from 'src/services/work-rules/work-rules.module'
import { SettingChangeCourierRestApiController } from './setting-change.courier.rest-api.controller'

@Module({
  imports: [WorkRulesModule],
  controllers: [SettingChangeCourierRestApiController],
})
export class SettingChangeCourierRestApiModule {}
