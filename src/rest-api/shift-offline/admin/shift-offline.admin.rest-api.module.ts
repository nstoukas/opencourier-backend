import { Module } from '@nestjs/common'
import { ShiftOfflineModule } from 'src/services/shift-offline/shift-offline.module'
import { ShiftOfflineAdminRestApiController } from './shift-offline.admin.rest-api.controller'

// The admin routes of spec 0049, registered in the admin API tree.
@Module({
  imports: [ShiftOfflineModule],
  controllers: [ShiftOfflineAdminRestApiController],
})
export class ShiftOfflineAdminRestApiModule {}
