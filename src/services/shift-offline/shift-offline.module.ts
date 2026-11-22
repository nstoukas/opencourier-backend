import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { CacheModule } from 'src/services/cache/cache.module'
import { ShiftOfflineService } from './shift-offline.service'

// Spec 0049. One instance for the whole app (Nest modules are singletons), so the minute sweep is
// registered once. Repositories come from the global PersistenceModule.
@Module({
  imports: [ConfigDomainModule, CacheModule],
  providers: [ShiftOfflineService],
  exports: [ShiftOfflineService],
})
export class ShiftOfflineModule {}
