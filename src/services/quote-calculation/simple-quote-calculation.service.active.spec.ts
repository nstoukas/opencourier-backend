import { SimpleQuoteCalculationService } from './simple-quote-calculation.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { GeoCalculationService } from '../geo-calculation/geo-calculation.service'

describe('SimpleQuoteCalculationService', () => {
  let service: SimpleQuoteCalculationService
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

    geoCalculationService = {
      calculateDistance: jest.fn().mockResolvedValue(0.49),
    } as any

    service = new SimpleQuoteCalculationService(configDomainService, geoCalculationService)
  })

  // C1. The unit bug, pinned: 0.49 distance * 150 rate = 73.5
  it('pins quote calculation unit agreement (distance 0.49 km * rate 150 = 73.5)', async () => {
    geoCalculationService.calculateDistance.mockResolvedValue(0.49)
    ;(configDomainService.instanceConfig.getQuoteRatePerDistanceUnit as jest.Mock).mockResolvedValue(150)

    const result = await service.calculateDeliveryQuote(sampleInput)

    expect(result.quoteRangeFrom).toBe(73.5)
    expect(result.quoteRangeTo).toBe(73.5)
  })

  // C2. Distance is actually read (deterministic results for distances 1 and 2)
  it('reads and uses the calculated distance deterministically', async () => {
    ;(configDomainService.instanceConfig.getQuoteRatePerDistanceUnit as jest.Mock).mockResolvedValue(150)

    geoCalculationService.calculateDistance.mockResolvedValue(1)
    const quote1 = await service.calculateDeliveryQuote(sampleInput)

    geoCalculationService.calculateDistance.mockResolvedValue(2)
    const quote2 = await service.calculateDeliveryQuote(sampleInput)

    expect(quote1.quoteRangeFrom).toBe(150)
    expect(quote2.quoteRangeFrom).toBe(300)
  })

  // C3. The rate is read per call from configDomainService, not cached at construction
  it('fetches quoteRatePerDistanceUnit per call so voted rate changes apply immediately', async () => {
    geoCalculationService.calculateDistance.mockResolvedValue(1)

    ;(configDomainService.instanceConfig.getQuoteRatePerDistanceUnit as jest.Mock).mockResolvedValueOnce(150)
    const quote1 = await service.calculateDeliveryQuote(sampleInput)

    ;(configDomainService.instanceConfig.getQuoteRatePerDistanceUnit as jest.Mock).mockResolvedValueOnce(200)
    const quote2 = await service.calculateDeliveryQuote(sampleInput)

    expect(quote1.quoteRangeFrom).toBe(150)
    expect(quote2.quoteRangeFrom).toBe(200)
    expect(configDomainService.instanceConfig.getQuoteRatePerDistanceUnit).toHaveBeenCalledTimes(2)
  })

  // C4. Unit coupling is explicit: getQuoteRatePerDistanceUnit is called, distance passed unconverted
  it('couples unit directly by passing converted distance without calling getDistanceUnit', async () => {
    await service.calculateDeliveryQuote(sampleInput)

    expect(configDomainService.instanceConfig.getQuoteRatePerDistanceUnit).toHaveBeenCalled()
    expect(geoCalculationService.calculateDistance).toHaveBeenCalledWith({
      fromLocation: { latitude: sampleInput.pickupLocation.latitude, longitude: sampleInput.pickupLocation.longitude },
      toLocation: { latitude: sampleInput.dropoffLocation.latitude, longitude: sampleInput.dropoffLocation.longitude },
    })
  })

  // C5. Constructing without DELIVERY_QUOTE_PER_MILE env variable does not throw
  it('can be instantiated without any DELIVERY_QUOTE_PER_MILE env variable', () => {
    delete process.env.DELIVERY_QUOTE_PER_MILE
    expect(() => new SimpleQuoteCalculationService(configDomainService, geoCalculationService)).not.toThrow()
  })
})
