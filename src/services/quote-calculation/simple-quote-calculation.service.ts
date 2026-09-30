import { Injectable, Logger } from '@nestjs/common'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { IQuoteCalculationInput } from './interfaces/IQuoteCalculationInput'
import { GeoCalculationService } from '../geo-calculation/geo-calculation.service'
import { IQuoteCalculationService } from './interfaces/IQuoteCalculationService'
import { calculateDistanceQuote } from './utils/distance-quote.util'
import { roundMoney } from 'src/core/utils/money'

@Injectable()
export class SimpleQuoteCalculationService implements IQuoteCalculationService {
  private readonly logger = new Logger(SimpleQuoteCalculationService.name)

  constructor(
    private readonly configDomainService: ConfigDomainService,
    private readonly geoCalculationService: GeoCalculationService
  ) {}

  async calculateDeliveryQuote(input: IQuoteCalculationInput) {
    const { pickupLocation, dropoffLocation } = input

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

    // `distance` is already expressed in Config.distanceUnit (GeoCalculationService converts it),
    // and the rate is defined per that same unit — so the two agree by construction. The old code
    // multiplied a kilometre count by a rate named "per mile".
    const ratePerDistanceUnit = await this.configDomainService.instanceConfig.getQuoteRatePerDistanceUnit()
    // Each part is rounded to whole cents on its own, so the parts always add up exactly.
    const distanceFee = roundMoney(calculateDistanceQuote(distance, ratePerDistanceUnit))
    const baseFee = await this.configDomainService.instanceConfig.getQuoteBaseFee()
    const quote = baseFee + distanceFee

    return { quoteRangeFrom: quote, quoteRangeTo: quote, baseFee, distanceFee }
  }
}
