import { Module } from '@nestjs/common'
import { WorkRulesModule } from 'src/services/work-rules/work-rules.module'
import { SettingChangeAdminRestApiController } from './setting-change.admin.rest-api.controller'

@Module({
  imports: [WorkRulesModule],
  controllers: [SettingChangeAdminRestApiController],
})
export class SettingChangeAdminRestApiModule {}
