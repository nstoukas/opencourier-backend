import { BadRequestException } from '@nestjs/common'
import { DeliveryCalculationService } from './delivery-calculation.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { GeoCalculationService } from '../geo-calculation/geo-calculation.service'
import { QuoteCalculationService } from '../quote-calculation/quote-calculation.service'
import { CourierCompensationService } from '../courier-compensation/courier-compensation.service'
import { DeliveryDurationCalculationService } from '../duration-calculation/delivery-duration-calculation.service'
import { IDeliveryCalculationsInput } from './interfaces/IDeliveryCalculationsInput'

describe('DeliveryCalculationService', () => {
  let service: DeliveryCalculationService
  let configDomainService: jest.Mocked<ConfigDomainService>
  let deliveryRepository: jest.Mocked<DeliveryRepository>
  let geoCalculationService: jest.Mocked<GeoCalculationService>
  let quoteCalculationService: jest.Mocked<QuoteCalculationService>
  let courierCompensationService: jest.Mocked<CourierCompensationService>
  let deliveryDurationCalculationModule: jest.Mocked<DeliveryDurationCalculationService>

  const sampleInput: IDeliveryCalculationsInput = {
    pickupLocation: { latitude: 39.36, longitude: 22.94 },
    dropoffLocation: { latitude: 39.37, longitude: 22.95 },
    timeOfDay: new Date('2026-09-30T12:00:00.000Z'),
  }

  beforeEach(() => {
    configDomainService = {
      instanceConfig: {
        getFeePercentageAmount: jest.fn().mockResolvedValue(0),
        getQuoteExpirationMinutes: jest.fn().mockResolvedValue(15),
      },
    } as any

    deliveryRepository = {
      findById: jest.fn(),
    } as any

    geoCalculationService = {
      calculateDistance: jest.fn(),
    } as any

    quoteCalculationService = {
      calculateDeliveryQuote: jest.fn(),
    } as any

    courierCompensationService = {
      calculateCourierCompensationForDelivery: jest.fn(),
    } as any

    deliveryDurationCalculationModule = {
      calculateDeliveryDuration: jest.fn(),
    } as any

    service = new DeliveryCalculationService(
      configDomainService,
      deliveryRepository,
      geoCalculationService,
      quoteCalculationService,
      courierCompensationService,
      deliveryDurationCalculationModule
    )
  })

  describe('calculateDeliveryQuoteAmount with feePercentage', () => {
    it('returns exact base quote without surcharge when feePercentageAmount is 0%', async () => {
      // Base quote calculation returns 100
      quoteCalculationService.calculateDeliveryQuote.mockResolvedValue({
        quoteRangeFrom: 100,
        quoteRangeTo: 100,
      })
      ;(configDomainService.instanceConfig.getFeePercentageAmount as jest.Mock).mockResolvedValue(0)

      const result = await service.calculateDeliveryQuoteAmount(sampleInput)

      // A 0% fee means final quote matches base quote exactly
      expect(result.quoteRangeFrom).toBe(100)
      expect(result.quoteRangeTo).toBe(100)
      expect(result.feePercentage).toBe(0)
    })

    it('applies 10% fee surcharge when feePercentageAmount is 10%', async () => {
      quoteCalculationService.calculateDeliveryQuote.mockResolvedValue({
        quoteRangeFrom: 100,
        quoteRangeTo: 100,
      })
      ;(configDomainService.instanceConfig.getFeePercentageAmount as jest.Mock).mockResolvedValue(10)

      const result = await service.calculateDeliveryQuoteAmount(sampleInput)

      // A 10% fee adds 10 to base quote of 100
      expect(result.quoteRangeFrom).toBe(110)
      expect(result.quoteRangeTo).toBe(110)
      expect(result.feePercentage).toBe(10)
    })
  })

  describe('calculateDeliveryAmountsForMatchedCourier with 0% fee', () => {
    it('calculates zero fee when feePercentageAmount is 0%', async () => {
      // Mock existing matched delivery
      deliveryRepository.findById.mockResolvedValue({
        id: 'del-123',
        matchedCourierId: 'courier-1',
      } as any)
      courierCompensationService.calculateCourierCompensationForDelivery.mockResolvedValue(200)
      ;(configDomainService.instanceConfig.getFeePercentageAmount as jest.Mock).mockResolvedValue(0)

      const result = await service.calculateDeliveryAmountsForMatchedCourier({ deliveryId: 'del-123' })

      expect(result.totalCompensation).toBe(200)
      expect(result.totalCost).toBe(200)
      expect(result.fee).toBe(0)
      expect(result.feePercentage).toBe(0)
    })

    it('throws BadRequestException when delivery is not found', async () => {
      deliveryRepository.findById.mockResolvedValue(null)

      await expect(service.calculateDeliveryAmountsForMatchedCourier({ deliveryId: 'missing-del' })).rejects.toThrow(
        BadRequestException
      )
    })
  })

  describe('calculateDeliveryQuoteExpiration failure case', () => {
    it('throws BadRequestException when quote expiration configuration is missing or 0', async () => {
      ;(configDomainService.instanceConfig.getQuoteExpirationMinutes as jest.Mock).mockResolvedValue(0)

      await expect(service.calculateDeliveryQuoteExpiration(sampleInput)).rejects.toThrow(
        'Missing quote expiration minutes configuration'
      )
    })
  })
})
