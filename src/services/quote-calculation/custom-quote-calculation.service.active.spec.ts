import { CustomQuoteCalculationService } from './custom-quote-calculation.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { GeoCalculationService } from '../geo-calculation/geo-calculation.service'
import { QUOTE_CALCULATION_TYPE_TO_HUMAN, EnumQuoteCalculationType } from 'src/shared-types'

describe('CustomQuoteCalculationService', () => {
  let service: CustomQuoteCalculationService
  let configDomainService: jest.Mocked<ConfigDomainService>
  let geoCalculationService: jest.Mocked<GeoCalculationService>

  const sampleInput = {
    pickupLocation: { latitude: 39.36, longitude: 22.94 },
    dropoffLocation: { latitude: 39.37, longitude: 22.95 },
  }

  beforeEach(() => {
    configDomainService = {
      instanceConfig: {
        getQuoteRatePerDistanceUnit: jest.fn().mockResolvedValue(150),
      },
    } as any

    geoCalculationService = {} as any

    service = new CustomQuoteCalculationService(configDomainService, geoCalculationService)
  })

  // G1. calculateDeliveryQuote emits a logger.warn whose message contains BY_DISTANCE and RANDOM / random
  it('emits a warning log when calculateDeliveryQuote is called advising BY_DISTANCE', async () => {
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => {})

    await service.calculateDeliveryQuote(sampleInput)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const warnMessage = warnSpy.mock.calls[0]![0]
    expect(warnMessage).toContain('BY_DISTANCE')
    expect(warnMessage.toLowerCase()).toContain('random')

    warnSpy.mockRestore()
  })

  // G2. QUOTE_CALCULATION_TYPE_TO_HUMAN.CUSTOM contains DEVELOPMENT ONLY
  it('contains DEVELOPMENT ONLY in human-readable metadata label for CUSTOM', () => {
    const humanLabel = QUOTE_CALCULATION_TYPE_TO_HUMAN[EnumQuoteCalculationType.CUSTOM]
    expect(humanLabel).toContain('DEVELOPMENT ONLY')
  })
})
