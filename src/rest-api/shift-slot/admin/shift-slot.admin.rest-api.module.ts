import { Module } from '@nestjs/common'
import { ShiftSlotModule } from 'src/services/shift-slot/shift-slot.module'
import { ShiftSlotAdminRestApiController } from './shift-slot.admin.rest-api.controller'

// The admin shift slot routes (spec 0026), registered in the admin API tree.
@Module({
  imports: [ShiftSlotModule],
  controllers: [ShiftSlotAdminRestApiController],
})
export class ShiftSlotAdminRestApiModule {}
