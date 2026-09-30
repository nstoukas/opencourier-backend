import { SurgeQuoteCalculationService } from './surge-quote-calculation.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { GeoCalculationService } from '../geo-calculation/geo-calculation.service'

describe('SurgeQuoteCalculationService', () => {
  let service: SurgeQuoteCalculationService
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
      calculateDistance: jest.fn().mockResolvedValue(2),
    } as any

    service = new SurgeQuoteCalculationService(configDomainService, geoCalculationService)
  })

  // AC-2 zero cases: SURGE returns baseFee 0 and rounded distanceFee, and stored parts sum to price
  it('returns baseFee 0 and rounded distanceFee equal to quote price for SURGE', async () => {
    const result = await service.calculateDeliveryQuote(sampleInput)

    expect(result.baseFee).toBe(0)
    expect(result.distanceFee).toBe(300) // 2 km * 150
    expect(result.baseFee + result.distanceFee).toBe(result.quoteRangeFrom)
  })

  it('rounds distanceFee to whole cents (107) for fractional daytime calculation (0.71 km at 150)', async () => {
    geoCalculationService.calculateDistance.mockResolvedValue(0.71)

    const result = await service.calculateDeliveryQuote({
      ...sampleInput,
      pickupReadyAt: new Date('2026-09-30T12:00:00.000Z'),
    })

    expect(result.baseFee).toBe(0)
    expect(result.distanceFee).toBe(107) // 0.71 * 150 = 106.5 -> 107
    expect(Number.isInteger(result.distanceFee)).toBe(true)
  })

  it('rounds distanceFee to whole cents (160) for night SURGE calculation (0.71 km at 150 x 1.5)', async () => {
    geoCalculationService.calculateDistance.mockResolvedValue(0.71)

    const result = await service.calculateDeliveryQuote({
      ...sampleInput,
      pickupReadyAt: new Date('2026-09-30T23:00:00.000Z'),
    })

    expect(result.baseFee).toBe(0)
    expect(result.distanceFee).toBe(160) // 0.71 * 150 * 1.5 = 159.75 -> 160
    expect(Number.isInteger(result.distanceFee)).toBe(true)
  })
})
