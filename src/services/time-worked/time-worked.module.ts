import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { TimeWorkedService } from './time-worked.service'

// Spec 0040: time worked, worked out on read. The repositories come from the global persistence module.
@Module({
  imports: [ConfigDomainModule],
  providers: [TimeWorkedService],
  exports: [TimeWorkedService],
})
export class TimeWorkedModule {}
