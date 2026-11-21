import { DynamicModule, Global, Module } from '@nestjs/common'
import { CourierDomainModule } from 'src/domains/courier/courier.domain.module'
import { DeliveryDomainModule } from 'src/domains/delivery/delivery.domain.module'
import { PartnerDomainModule } from 'src/domains/partner/partner.domain.module'
import { LocationDomainModule } from 'src/domains/location/location.domain.module'
import { OsrmRoutingModule } from 'src/services/osrm/osrm-routing.module'
import { NearestCourierMatcherService } from './nearest-courier-matcher.service'
import { CourierMatcherService } from './courier-matcher.service'
import { StaticCourierMatcherService } from './static-courier-matcher.service'
import { useProvideClass } from 'src/core/utils/provider'
import { EnumCourierMatcherType } from 'src/shared-types/index'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { CourierSeniorityMatcherService } from './courier-seniority-matcher.service'
import { FairnessCourierMatcherService } from './fairness-courier-matcher.service'
import { TimeWorkedModule } from 'src/services/time-worked/time-worked.module'

@Global()
@Module({
  imports: [
    OsrmRoutingModule,
    DeliveryDomainModule,
    PartnerDomainModule,
    CourierDomainModule,
    LocationDomainModule,
    ConfigDomainModule,
    TimeWorkedModule,
  ],
})
export class CourierMatcherModule {
  static forRoot(): DynamicModule {
    const providers = [
      useProvideClass(CourierMatcherService, CourierMatcherService),
      {
        provide: EnumCourierMatcherType.NEAREST_COURIER,
        useClass: NearestCourierMatcherService,
      },
      {
        provide: EnumCourierMatcherType.COURIER_SENIORITY,
        useClass: CourierSeniorityMatcherService,
      },
      {
        provide: EnumCourierMatcherType.STATIC,
        useClass: StaticCourierMatcherService,
      },
      // Spec 0044 (rows 12 and 13): the co-op's weighted matcher, the default.
      {
        provide: EnumCourierMatcherType.FAIRNESS,
        useClass: FairnessCourierMatcherService,
      },
    ]

    return {
      module: CourierMatcherModule,
      providers: providers,
      exports: providers,
    }
  }
}
