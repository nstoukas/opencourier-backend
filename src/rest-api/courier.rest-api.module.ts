import { Module } from '@nestjs/common'
import { ConfigCourierRestApiModule } from './config/courier/config.courier.rest-api.module'
import { AuthCourierRestApiModule } from './auth/courier/auth.courier.rest-api.module'
import { DeliveryCourierRestApiModule } from './delivery/courier/delivery.courier.rest-api.module'
import { LocationNoteCourierRestApiModule } from './location-note/courier/location-note.courier.rest-api.module'
import { CourierCourierRestApiModule } from './courier/courier/courier.courier.rest-api.module'
import { PayoutCourierRestApiModule } from './payout/courier/payouts.courier.rest-api.module'
import { CourierSettingCourierRestApiModule } from './courier-setting/courier/courier-setting.courier.rest-api.module'
import { CourierDeviceCourierRestApiModule } from './courier-device/courier/courier-device.courier.rest-api.module'
import { DispatchStopCourierRestApiModule } from './dispatch-stop/courier/dispatch-stop.courier.rest-api.module'
import { PartnerCourierRestApiModule } from './partner/courier/partner.courier.rest-api.module'

@Module({
  imports: [
    ConfigCourierRestApiModule,
    AuthCourierRestApiModule,
    DeliveryCourierRestApiModule,
    LocationNoteCourierRestApiModule,
    CourierCourierRestApiModule,
    CourierSettingCourierRestApiModule,
    PayoutCourierRestApiModule,
    CourierDeviceCourierRestApiModule,
    // Whether dispatch is stopped, for the Home banner (spec 0014).
    DispatchStopCourierRestApiModule,
    // Restaurant pickup points for the map's restaurant layer (spec 0018).
    PartnerCourierRestApiModule,
  ],
})
export class CourierRestApiModule {}
