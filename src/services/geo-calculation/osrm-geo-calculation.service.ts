import { Injectable } from '@nestjs/common'
import { IGeoCalculationInput } from './interfaces/IGeoCalculationInput'
import { IGeoCalculationService } from './interfaces/IGeoCalculationService'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { convertKilometresToDistanceUnit } from './utils/distance-unit.util'

// Distance calculation strategy using OSRM road routing engine
@Injectable()
export class OsrmGeoCalculationService implements IGeoCalculationService {
  constructor(
    private readonly configDomainService: ConfigDomainService,
    private readonly osrmRoutingService: OsrmRoutingService,
  ) {}

  async calculateDistance(input: IGeoCalculationInput): Promise<number> {
    const distanceUnit = await this.configDomainService.instanceConfig.getDistanceUnit()

    const route = await this.osrmRoutingService.getRoute({
      fromLocation: input.fromLocation,
      toLocation: input.toLocation,
    })

    // OSRM answers in metres; the rest of the system speaks Config.distanceUnit.
    return convertKilometresToDistanceUnit(route.distanceMetres / 1000, distanceUnit)
  }
}
