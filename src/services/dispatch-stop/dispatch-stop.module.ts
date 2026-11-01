import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { DispatchStopService } from './dispatch-stop.service'

// One instance for the whole app (Nest modules are singletons), so the minute tick is registered once.
@Module({
  imports: [ConfigDomainModule],
  providers: [DispatchStopService],
  exports: [DispatchStopService],
})
export class DispatchStopModule {}
