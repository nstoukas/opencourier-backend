import { Injectable, Logger } from '@nestjs/common'
import { IGeoCalculationInput } from './interfaces/IGeoCalculationInput'
import { IGeoCalculationService } from './interfaces/IGeoCalculationService'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { convertKilometresToDistanceUnit } from './utils/distance-unit.util'

@Injectable()
export class HaversineGeoCalculationService implements IGeoCalculationService {
  private readonly logger = new Logger(HaversineGeoCalculationService.name)

  constructor(private readonly configDomainService: ConfigDomainService) {}

  async calculateDistance(input: IGeoCalculationInput) {
    const distanceUnit = await this.configDomainService.instanceConfig.getDistanceUnit()

    const { fromLocation, toLocation } = input

    const toRadians = (angle: number) => (Math.PI / 180) * angle

    const R = 6371 // Radius of the Earth in kilometers
    const dLat = toRadians(toLocation.latitude - fromLocation.latitude)
    const dLon = toRadians(toLocation.longitude - fromLocation.longitude)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(fromLocation.latitude)) *
        Math.cos(toRadians(toLocation.latitude)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    const distance = R * c // Distance in kilometers

    return convertKilometresToDistanceUnit(distance, distanceUnit)
  }
}
