import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { WorkRulesService } from './work-rules.service'

// Spec 0038: the explanation page and the settings record. The repositories come from a global module.
@Module({
  imports: [ConfigDomainModule],
  providers: [WorkRulesService],
  exports: [WorkRulesService],
})
export class WorkRulesModule {}
