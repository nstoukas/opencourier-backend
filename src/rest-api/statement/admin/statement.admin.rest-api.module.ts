import { Module } from '@nestjs/common'
import { StatementModule } from 'src/services/statement/statement.module'
import { StatementAdminRestApiController } from './statement.admin.rest-api.controller'

// Spec 0050 (AC-9): the admin statement routes, registered in the admin API tree.
@Module({
  imports: [StatementModule],
  controllers: [StatementAdminRestApiController],
})
export class StatementAdminRestApiModule {}
