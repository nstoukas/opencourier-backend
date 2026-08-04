import { Injectable, Logger } from '@nestjs/common'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { IQuoteCalculationInput } from './interfaces/IQuoteCalculationInput'
import { GeoCalculationService } from '../geo-calculation/geo-calculation.service'
import { IQuoteCalculationService } from './interfaces/IQuoteCalculationService'
import { calculateDistanceQuote } from './utils/distance-quote.util'

@Injectable()
export class SurgeQuoteCalculationService implements IQuoteCalculationService {
  private readonly logger = new Logger(SurgeQuoteCalculationService.name)

  constructor(
    private readonly configDomainService: ConfigDomainService,
    private readonly geoCalculationService: GeoCalculationService
  ) {}

  async calculateDeliveryQuote(input: IQuoteCalculationInput) {
    const { pickupLocation, dropoffLocation, pickupReadyAt } = input

    const distance = await this.geoCalculationService.calculateDistance({
      fromLocation: {
        latitude: pickupLocation.latitude,
        longitude: pickupLocation.longitude,
      },
      toLocation: {
        latitude: dropoffLocation.latitude,
        longitude: dropoffLocation.longitude,
      },
    })

    const ratePerDistanceUnit = await this.configDomainService.instanceConfig.getQuoteRatePerDistanceUnit()
    let quote = calculateDistanceQuote(distance, ratePerDistanceUnit)

    // depending on time of day, we may want to add a surge multiplier.
    const hour = pickupReadyAt?.getHours()
    if (hour && (hour >= 22 || hour < 6)) {
      quote = quote * 1.5
    }

    return Promise.resolve({
      quoteRangeFrom: quote,
      quoteRangeTo: quote,
    })
  }
}
