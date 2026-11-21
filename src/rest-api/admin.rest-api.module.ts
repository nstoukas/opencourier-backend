import { Module } from '@nestjs/common'
import { AuthAdminRestApiModule } from './auth/admin/auth.admin.rest-api.module'
import { CourierAdminRestApiModule } from './courier/admin/courier.admin.rest-api.module'
import { CourierSettingAdminRestApiModule } from './courier-setting/admin/courier-setting.admin.rest-api.module'
import { DeliveryAdminRestApiModule } from './delivery/admin/delivery.admin.rest-api.module'
import { LocationAdminRestApiModule } from './location/admin/location.admin.rest-api.module'
import { ConfigAdminRestApiModule } from './config/admin/config.admin.rest-api.module'
import { UserAdminRestApiModule } from './user/admin/user.admin.rest-api.module'
import { PartnerAdminRestApiModule } from './partner/admin/partner.admin.rest-api.module'
import { ProductReportAdminRestApiModule } from './product-report/admin/product-report.admin.rest-api.module'
import { DispatchStopAdminRestApiModule } from './dispatch-stop/admin/dispatch-stop.admin.rest-api.module'
import { ShiftSlotAdminRestApiModule } from './shift-slot/admin/shift-slot.admin.rest-api.module'
import { ShiftOfflineAdminRestApiModule } from './shift-offline/admin/shift-offline.admin.rest-api.module'
import { SosAdminRestApiModule } from './sos/admin/sos.admin.rest-api.module'
import { DispatchBoardAdminRestApiModule } from './dispatch-board/admin/dispatch-board.admin.rest-api.module'
import { RemovalRequestAdminRestApiModule } from './removal-request/admin/removal-request.admin.rest-api.module'
import { ReviewRequestAdminRestApiModule } from './review-request/admin/review-request.admin.rest-api.module'
import { SettingChangeAdminRestApiModule } from './setting-change/admin/setting-change.admin.rest-api.module'
import { ChatAdminRestApiModule } from './chat/admin/chat.admin.rest-api.module'
import { PartnerChargeAdminRestApiModule } from './partner-charge/admin/partner-charge.admin.rest-api.module'
import { TimeWorkedAdminRestApiModule } from './time-worked/admin/time-worked.admin.rest-api.module'

@Module({
  imports: [
    AuthAdminRestApiModule,
    CourierAdminRestApiModule,
    CourierSettingAdminRestApiModule,
    DeliveryAdminRestApiModule,
    LocationAdminRestApiModule,
    ConfigAdminRestApiModule,
    UserAdminRestApiModule,
    PartnerAdminRestApiModule,
    ProductReportAdminRestApiModule,
    // Stopping dispatch for heat or a storm (spec 0014).
    DispatchStopAdminRestApiModule,
    ShiftSlotAdminRestApiModule,
    ShiftOfflineAdminRestApiModule,
    SosAdminRestApiModule,
    // The live Dispatch board (spec 0034).
    DispatchBoardAdminRestApiModule,
    // A rider's request to come off an order (spec 0035).
    RemovalRequestAdminRestApiModule,
    ReviewRequestAdminRestApiModule,
    SettingChangeAdminRestApiModule,
    TimeWorkedAdminRestApiModule,
    // Dispatch's chat inbox (spec 0034).
    ChatAdminRestApiModule,
    // What each restaurant owes, and bills made by hand (spec 0036).
    PartnerChargeAdminRestApiModule,
  ],
})
export class AdminRestApiModule {}
