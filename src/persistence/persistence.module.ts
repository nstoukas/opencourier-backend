import { Global, Module } from '@nestjs/common'
import { ConfigRepository } from './repositories/config.repository'
import { UserRepository } from './repositories/user.repository'
import { CourierRepository } from './repositories/courier.repository'
import { CourierSettingRepository } from './repositories/courier-setting.repository'
import { DeliveryRepository } from './repositories/delivery.repository'
import { LocationNoteRepository } from './repositories/location-note.repository'
import { LocationRepository } from './repositories/location.repository'
import { DeliveryQuoteRepository } from './repositories/delivery-quote.repository'
import { PartnerRepository } from './repositories/partner.repository'
import { DeliveryEventRepository } from './repositories/delivery-event.repository'
import { LocationNoteReactionRepository } from './repositories/location-note-reaction.repository'
import { CourierCompensationRepository } from './repositories/courier-compensation.repository'

@Global()
@Module({
  providers: [
    ConfigRepository,
    UserRepository,
    CourierRepository,
    CourierSettingRepository,
    DeliveryRepository,
    LocationNoteRepository,
    LocationRepository,
    DeliveryQuoteRepository,
    PartnerRepository,
    DeliveryEventRepository,
    LocationNoteReactionRepository,
    CourierCompensationRepository,
  ],
  exports: [
    ConfigRepository,
    UserRepository,
    CourierRepository,
    CourierSettingRepository,
    DeliveryRepository,
    LocationNoteRepository,
    LocationRepository,
    DeliveryQuoteRepository,
    PartnerRepository,
    DeliveryEventRepository,
    LocationNoteReactionRepository,
    CourierCompensationRepository,
  ],
})
export class PersistenceModule {}
