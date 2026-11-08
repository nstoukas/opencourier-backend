import { Module } from '@nestjs/common'
import { ShiftSlotService } from './shift-slot.service'

// Spec 0026: the shift slot service (its repository comes from the global PersistenceModule).
@Module({
  providers: [ShiftSlotService],
  exports: [ShiftSlotService],
})
export class ShiftSlotModule {}
