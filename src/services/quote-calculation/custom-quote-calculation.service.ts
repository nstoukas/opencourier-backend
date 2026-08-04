import { Injectable, Logger } from '@nestjs/common'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { IQuoteCalculationInput } from './interfaces/IQuoteCalculationInput'
import { GeoCalculationService } from '../geo-calculation/geo-calculation.service'
import { IQuoteCalculationService } from './interfaces/IQuoteCalculationService'

@Injectable()
export class CustomQuoteCalculationService implements IQuoteCalculationService {
  private readonly logger = new Logger(CustomQuoteCalculationService.name)

  constructor(
    private readonly configDomainService: ConfigDomainService,
    private readonly geoCalculationService: GeoCalculationService
  ) {}

  async calculateDeliveryQuote(input: IQuoteCalculationInput) {
    const ratePerDistanceUnit = await this.configDomainService.instanceConfig.getQuoteRatePerDistanceUnit()
    const quote = Math.random() * ratePerDistanceUnit * 100.3

    this.logger.warn(
      'quoteCalculationType=CUSTOM: this quote is a RANDOM number and ignores the delivery distance. ' +
        'With courierCompensationCalculationType=FROM_QUOTE_FROM it is also the courier’s pay. ' +
        'Development only — set quoteCalculationType=BY_DISTANCE for a real instance.'
    )

    return Promise.resolve({
      quoteRangeFrom: quote,
      quoteRangeTo: quote,
    })
  }
}
