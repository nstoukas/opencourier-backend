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
        getQuoteBaseFee: jest.fn().mockResolvedValue(200),
      },
    } as any

    geoCalculationService = {
      calculateDistance: jest.fn().mockResolvedValue(0.49),
    } as any

    service = new SimpleQuoteCalculationService(configDomainService, geoCalculationService)
  })

  // AC-1 / AC-2: Worked example distance part calculation
  it('calculates base fee and distance fee (0.71 km * 150 = 106.5 -> 107 distance fee + 200 base fee = 307)', async () => {
    geoCalculationService.calculateDistance.mockResolvedValue(0.71)
    ;(configDomainService.instanceConfig.getQuoteRatePerDistanceUnit as jest.Mock).mockResolvedValue(150)
    ;(configDomainService.instanceConfig.getQuoteBaseFee as jest.Mock).mockResolvedValue(200)

    const result = await service.calculateDeliveryQuote(sampleInput)

    expect(result.baseFee).toBe(200)
    expect(result.distanceFee).toBe(107)
    expect(result.quoteRangeFrom).toBe(307)
    expect(result.quoteRangeTo).toBe(307)
  })

  // C1. The unit bug, updated with base fee 0
  it('pins quote calculation unit agreement when base fee is 0 (distance 0.49 km * rate 150 = 73.5 -> 74)', async () => {
    geoCalculationService.calculateDistance.mockResolvedValue(0.49)
    ;(configDomainService.instanceConfig.getQuoteRatePerDistanceUnit as jest.Mock).mockResolvedValue(150)
    ;(configDomainService.instanceConfig.getQuoteBaseFee as jest.Mock).mockResolvedValue(0)

    const result = await service.calculateDeliveryQuote(sampleInput)

    expect(result.baseFee).toBe(0)
    expect(result.distanceFee).toBe(74)
    expect(result.quoteRangeFrom).toBe(74)
    expect(result.quoteRangeTo).toBe(74)
  })

  // AC-2 zero cases: 0 km at base 0 prices 0
  it('returns baseFee 0 and distanceFee 0 for a 0 km trip at base 0', async () => {
    geoCalculationService.calculateDistance.mockResolvedValue(0)
    ;(configDomainService.instanceConfig.getQuoteRatePerDistanceUnit as jest.Mock).mockResolvedValue(150)
    ;(configDomainService.instanceConfig.getQuoteBaseFee as jest.Mock).mockResolvedValue(0)

    const result = await service.calculateDeliveryQuote(sampleInput)

    expect(result.baseFee).toBe(0)
    expect(result.distanceFee).toBe(0)
    expect(result.quoteRangeFrom).toBe(0)
    expect(result.quoteRangeTo).toBe(0)
  })

  // C2. Distance is actually read (deterministic results for distances 1 and 2)
  it('reads and uses the calculated distance deterministically', async () => {
    ;(configDomainService.instanceConfig.getQuoteRatePerDistanceUnit as jest.Mock).mockResolvedValue(150)
    ;(configDomainService.instanceConfig.getQuoteBaseFee as jest.Mock).mockResolvedValue(200)

    geoCalculationService.calculateDistance.mockResolvedValue(1)
    const quote1 = await service.calculateDeliveryQuote(sampleInput)

    geoCalculationService.calculateDistance.mockResolvedValue(2)
    const quote2 = await service.calculateDeliveryQuote(sampleInput)

    expect(quote1.distanceFee).toBe(150)
    expect(quote1.quoteRangeFrom).toBe(350) // 200 + 150
    expect(quote2.distanceFee).toBe(300)
    expect(quote2.quoteRangeFrom).toBe(500) // 200 + 300
  })

  // C3. The rate and base fee are read per call from configDomainService
  it('fetches settings per call so voted changes apply immediately', async () => {
    geoCalculationService.calculateDistance.mockResolvedValue(1)

    ;(configDomainService.instanceConfig.getQuoteRatePerDistanceUnit as jest.Mock).mockResolvedValueOnce(150)
    ;(configDomainService.instanceConfig.getQuoteBaseFee as jest.Mock).mockResolvedValueOnce(200)
    const quote1 = await service.calculateDeliveryQuote(sampleInput)

    ;(configDomainService.instanceConfig.getQuoteRatePerDistanceUnit as jest.Mock).mockResolvedValueOnce(200)
    ;(configDomainService.instanceConfig.getQuoteBaseFee as jest.Mock).mockResolvedValueOnce(300)
    const quote2 = await service.calculateDeliveryQuote(sampleInput)

    expect(quote1.quoteRangeFrom).toBe(350) // 200 + 150
    expect(quote2.quoteRangeFrom).toBe(500) // 300 + 200
  })

  // C4. Unit coupling is explicit: getQuoteRatePerDistanceUnit and getQuoteBaseFee are called
  it('couples unit directly by passing converted distance without calling getDistanceUnit', async () => {
    await service.calculateDeliveryQuote(sampleInput)

    expect(configDomainService.instanceConfig.getQuoteRatePerDistanceUnit).toHaveBeenCalled()
    expect(configDomainService.instanceConfig.getQuoteBaseFee).toHaveBeenCalled()
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
