import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { DeliveryDomainModule } from 'src/domains/delivery/delivery.domain.module'
import { DispatchStopModule } from 'src/services/dispatch-stop/dispatch-stop.module'
import { SosModule } from 'src/services/sos/sos.module'
import { DispatchBoardService } from './dispatch-board.service'

// The repositories come from the global PersistenceModule.
@Module({
  imports: [ConfigDomainModule, DeliveryDomainModule, DispatchStopModule, SosModule],
  providers: [DispatchBoardService],
  exports: [DispatchBoardService],
})
export class DispatchBoardModule {}
