import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { ShiftBookingService } from './shift-booking.service'

// Spec 0027: riders' shift bookings (repositories come from the global PersistenceModule).
@Module({
  imports: [ConfigDomainModule],
  providers: [ShiftBookingService],
  exports: [ShiftBookingService],
})
export class ShiftBookingModule {}
