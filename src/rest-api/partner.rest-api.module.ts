import { DispatchStopPartnerRestApiModule } from './dispatch-stop/partner/dispatch-stop.partner.rest-api.module'
import { ChatPartnerRestApiModule } from './chat/partner/chat.partner.rest-api.module'
import { Module } from '@nestjs/common'
import { ConfigPartnerRestApiModule } from './config/partner/config.partner.rest-api.module'
import { DeliveryQuotePartnerRestApiModule } from './delivery-quote/partner/delivery-quote.partner.rest-api.module'
import { DeliveryPartnerRestApiModule } from './delivery/partner/delivery.partner.rest-api.module'
import { AuthPartnerRestApiModule } from './auth/partner/auth.partner.rest-api.module'
import { PartnerPartnerRestApiModule } from './partner/partner/partner.partner.rest-api.module'

@Module({
  imports: [
    AuthPartnerRestApiModule,
    ConfigPartnerRestApiModule,
    DeliveryQuotePartnerRestApiModule,
    DeliveryPartnerRestApiModule,
    PartnerPartnerRestApiModule,
    // Whether dispatch is stopped, for the order page's banner (spec 0014).
    DispatchStopPartnerRestApiModule,
    // A restaurant's chat with dispatch (spec 0034, AC-14).
    ChatPartnerRestApiModule,
  ],
})
export class PartnerRestApiModule {}
