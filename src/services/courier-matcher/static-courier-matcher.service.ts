import { EnumCourierMatcherType } from 'src/shared-types/courier-matching'
import { Injectable, Logger } from '@nestjs/common'
import { ICourierMatcherInput } from './interfaces/ICourierMatcherInput'
import { ICourierMatcherService } from './interfaces/ICourierMatcherService'

@Injectable()
export class StaticCourierMatcherService implements ICourierMatcherService {
  private readonly logger = new Logger(StaticCourierMatcherService.name)

  private static courierId = 'testing-courier'

  static setStaticCourierId(courierId: string) {
    this.courierId = courierId
  }

  static getStaticCourierId() {
    return this.courierId
  }

  async findCourierForDelivery(input: ICourierMatcherInput) {
    return Promise.resolve({
      courierId: StaticCourierMatcherService.courierId,
      distance: 1,
      // Spec 0044 (AC-6): the one test rider hard coded above, free or not (a testing tool, row 185).
      reason: { strategy: EnumCourierMatcherType.STATIC, values: {} },
    })
  }
}
