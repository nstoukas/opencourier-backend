import { Module } from '@nestjs/common'
import { CancellationSweepService } from './cancellation-sweep.service'

// One instance for the whole app, so the minute job is registered once (spec 0015).
@Module({
  providers: [CancellationSweepService],
  exports: [CancellationSweepService],
})
export class CancellationSweepModule {}
