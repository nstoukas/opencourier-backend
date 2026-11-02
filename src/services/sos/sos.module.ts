import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { SosService } from './sos.service'

// Spec 0022. One instance for the whole app (Nest modules are singletons), so the daily retention
// job is registered once. The repositories come from the global PersistenceModule.
@Module({
  imports: [ConfigDomainModule],
  providers: [SosService],
  exports: [SosService],
})
export class SosModule {}
