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
import { SosAdminRestApiModule } from './sos/admin/sos.admin.rest-api.module'

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
    SosAdminRestApiModule,
  ],
})
export class AdminRestApiModule {}
