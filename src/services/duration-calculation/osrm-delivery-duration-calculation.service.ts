import { Injectable } from '@nestjs/common'
import { IDeliveryDurationCalculationInput } from './interfaces/IDeliveryDurationCalculationInput'
import { IDeliveryDurationCalculationService } from './interfaces/IDeliveryDurationCalculationService'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'

// Duration calculation strategy using OSRM road routing engine (driving time only)
@Injectable()
export class OsrmDeliveryDurationCalculationService implements IDeliveryDurationCalculationService {
  constructor(private readonly osrmRoutingService: OsrmRoutingService) {}

  async calculateDeliveryDuration(input: IDeliveryDurationCalculationInput): Promise<number> {
    const route = await this.osrmRoutingService.getRoute({
      fromLocation: input.pickupLocation,
      toLocation: input.dropoffLocation,
    })

    // OSRM answers in seconds; every caller of this method treats the result as minutes
    // (DeliveryCalculationService.calculateDropoffEta multiplies by 60000).
    return Math.round((route.durationSeconds / 60) * 100) / 100
  }
}
