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
import { SosCourierRestApiModule } from './sos/courier/sos.courier.rest-api.module'
import { ShiftBookingCourierRestApiModule } from './shift-booking/courier/shift-booking.courier.rest-api.module'
import { PartnerCourierRestApiModule } from './partner/courier/partner.courier.rest-api.module'
import { RemovalRequestCourierRestApiModule } from './removal-request/courier/removal-request.courier.rest-api.module'
import { SplitRequestCourierRestApiModule } from './split-request/courier/split-request.courier.rest-api.module'
import { ReviewRequestCourierRestApiModule } from './review-request/courier/review-request.courier.rest-api.module'
import { SettingChangeCourierRestApiModule } from './setting-change/courier/setting-change.courier.rest-api.module'
import { ChatCourierRestApiModule } from './chat/courier/chat.courier.rest-api.module'
import { TimeWorkedCourierRestApiModule } from './time-worked/courier/time-worked.courier.rest-api.module'
import { ComplaintCourierRestApiModule } from './complaint/courier/complaint.courier.rest-api.module'

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
    SosCourierRestApiModule,
    ShiftBookingCourierRestApiModule,
    // Restaurant pickup points for the map's restaurant layer (spec 0018).
    PartnerCourierRestApiModule,
    // Asking dispatch to take a rider off an order (spec 0035).
    RemovalRequestCourierRestApiModule,
    SplitRequestCourierRestApiModule,
    ReviewRequestCourierRestApiModule,
    // Complaints both ways, with no ratings (spec 0052).
    ComplaintCourierRestApiModule,
    SettingChangeCourierRestApiModule,
    TimeWorkedCourierRestApiModule,
    // A rider's chat with dispatch (spec 0034).
    ChatCourierRestApiModule,
  ],
})
export class CourierRestApiModule {}
