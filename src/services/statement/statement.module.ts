import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { TimeWorkedModule } from 'src/services/time-worked/time-worked.module'
import { StatementService } from './statement.service'

// Spec 0050 (row 76): monthly statements. Repositories and Prisma come from the global modules.
@Module({
  imports: [ConfigDomainModule, TimeWorkedModule],
  providers: [StatementService],
  exports: [StatementService],
})
export class StatementModule {}
