import { EnumCourierMatcherType } from 'src/shared-types/courier-matching'
import { Injectable, Logger } from '@nestjs/common'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { ICourierMatcherInput } from './interfaces/ICourierMatcherInput'
import { ICourierMatcherService } from './interfaces/ICourierMatcherService'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'

@Injectable()
export class CourierSeniorityMatcherService implements ICourierMatcherService {
  private readonly logger = new Logger(CourierSeniorityMatcherService.name)
  constructor(
    private readonly courierDomainService: CourierDomainService,
    private readonly configDomainService: ConfigDomainService
  ) {}

  async findCourierForDelivery(input: ICourierMatcherInput) {
    const { pickupLocation, rejectedCourierIds, boxUnits, deliveryId } = input

    const maxAssignmentDistance = await this.configDomainService.instanceConfig.getMaxAssignmentDistanceInKM()

    const result = await this.courierDomainService.getMostSeniorAvailableCourier({
      location: {
        latitude: pickupLocation.latitude,
        longitude: pickupLocation.longitude,
      },
      maxDistanceInKM: maxAssignmentDistance,
      excludeCourierIds: rejectedCourierIds,
      boxUnits,
      siblingOfDeliveryId: deliveryId,
    })

    if (!result?.courier) {
      return null
    }

    return {
      courierId: result.courier.id,
      distance: result.distance,
      // Spec 0044 (AC-6): the longest member in range.
      reason: {
        strategy: EnumCourierMatcherType.COURIER_SENIORITY,
        values: { memberSince: result.courier.createdAt.toISOString(), straightMetres: Math.round(result.distance) },
      },
    }
  }
}
