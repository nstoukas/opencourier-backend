import { Module } from '@nestjs/common'
import { DispatchBoardModule } from 'src/services/dispatch-board/dispatch-board.module'
import { DispatchBoardAdminRestApiController } from './dispatch-board.admin.rest-api.controller'

// The admin Dispatch board route (spec 0034), registered in the admin API tree.
@Module({
  imports: [DispatchBoardModule],
  controllers: [DispatchBoardAdminRestApiController],
})
export class DispatchBoardAdminRestApiModule {}
