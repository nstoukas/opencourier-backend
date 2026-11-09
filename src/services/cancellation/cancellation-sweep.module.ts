import { Module } from '@nestjs/common'
import { RemovalRequestModule } from 'src/services/removal-request/removal-request.module'
import { CancellationSweepService } from './cancellation-sweep.service'

// One instance for the whole app, so the minute job is registered once (spec 0015).
@Module({
  imports: [RemovalRequestModule],
  providers: [CancellationSweepService],
  exports: [CancellationSweepService],
})
export class CancellationSweepModule {}
