import { BadRequestException } from '@nestjs/common'
import { DeliveryCalculationService } from './delivery-calculation.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryQuoteRepository } from 'src/persistence/repositories/delivery-quote.repository'
import { GeoCalculationService } from '../geo-calculation/geo-calculation.service'
import { QuoteCalculationService } from '../quote-calculation/quote-calculation.service'
import { CourierCompensationService } from '../courier-compensation/courier-compensation.service'
import { DeliveryDurationCalculationService } from '../duration-calculation/delivery-duration-calculation.service'
import { IDeliveryCalculationsInput } from './interfaces/IDeliveryCalculationsInput'

describe('DeliveryCalculationService', () => {
  let service: DeliveryCalculationService
  let configDomainService: jest.Mocked<ConfigDomainService>
  let deliveryRepository: jest.Mocked<DeliveryRepository>
  let deliveryQuoteRepository: jest.Mocked<DeliveryQuoteRepository>
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

    deliveryQuoteRepository = {
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
      deliveryQuoteRepository,
      geoCalculationService,
      quoteCalculationService,
      courierCompensationService,
      deliveryDurationCalculationModule
    )
  })

  describe('AC-2 & AC-10: Pinned worked example for quote calculation and matched courier amounts', () => {
    it('pins worked example: base 200, 0.71km distance -> 107 distance fee, 10% fee gives price 338 and rider pay 307', async () => {
      // 1. Quote calculation returns base 200 and distance 107
      quoteCalculationService.calculateDeliveryQuote.mockResolvedValue({
        baseFee: 200,
        distanceFee: 107,
        quoteRangeFrom: 307,
        quoteRangeTo: 307,
      })
      ;(configDomainService.instanceConfig.getFeePercentageAmount as jest.Mock).mockResolvedValue(10)

      const quoteResult = await service.calculateDeliveryQuoteAmount(sampleInput)

      expect(quoteResult.baseFee).toBe(200)
      expect(quoteResult.distanceFee).toBe(107)
      expect(quoteResult.feePercentage).toBe(10)
      expect(quoteResult.quoteRangeFrom).toBe(338) // 307 + round(30.7) = 307 + 31 = 338
      expect(quoteResult.quoteRangeTo).toBe(338)

      // 2. Offering to matched courier reads stored quote values
      deliveryRepository.findById.mockResolvedValue({
        id: 'del-worked-example',
        matchedCourierId: 'courier-1',
        deliveryQuoteId: 'quote-worked-example',
      } as any)

      courierCompensationService.calculateCourierCompensationForDelivery.mockResolvedValue(307)

      deliveryQuoteRepository.findById.mockResolvedValue({
        id: 'quote-worked-example',
        baseFee: 200,
        distanceFee: 107,
        quoteRangeFrom: 338,
        quoteRangeTo: 338,
        feePercentage: 10,
      } as any)

      const matchedResult = await service.calculateDeliveryAmountsForMatchedCourier({
        deliveryId: 'del-worked-example',
      })

      expect(matchedResult.totalCompensation).toBe(307)
      expect(matchedResult.fee).toBe(31) // 338 - 307
      expect(matchedResult.feePercentage).toBe(10)
      expect(matchedResult.totalCost).toBe(338)
    })
  })

  describe('calculateDeliveryQuoteAmount with feePercentage', () => {
    it('returns exact base quote without fee surcharge when feePercentageAmount is 0%', async () => {
      quoteCalculationService.calculateDeliveryQuote.mockResolvedValue({
        baseFee: 0,
        distanceFee: 100,
        quoteRangeFrom: 100,
        quoteRangeTo: 100,
      })
      ;(configDomainService.instanceConfig.getFeePercentageAmount as jest.Mock).mockResolvedValue(0)

      const result = await service.calculateDeliveryQuoteAmount(sampleInput)

      expect(result.baseFee).toBe(0)
      expect(result.distanceFee).toBe(100)
      expect(result.quoteRangeFrom).toBe(100)
      expect(result.quoteRangeTo).toBe(100)
      expect(result.feePercentage).toBe(0)
    })

    it('applies 10% fee surcharge on top of rider pay (200 + 100 = 300 -> 330 total)', async () => {
      quoteCalculationService.calculateDeliveryQuote.mockResolvedValue({
        baseFee: 200,
        distanceFee: 100,
        quoteRangeFrom: 300,
        quoteRangeTo: 300,
      })
      ;(configDomainService.instanceConfig.getFeePercentageAmount as jest.Mock).mockResolvedValue(10)

      const result = await service.calculateDeliveryQuoteAmount(sampleInput)

      expect(result.quoteRangeFrom).toBe(330) // 300 + 30
      expect(result.quoteRangeTo).toBe(330)
      expect(result.feePercentage).toBe(10)
    })

    it('calculates customer price from parts only (200 + 107 + 10% = 338) ignoring price service quoteRangeFrom/To (AC-2)', async () => {
      quoteCalculationService.calculateDeliveryQuote.mockResolvedValue({
        baseFee: 200,
        distanceFee: 107,
        quoteRangeFrom: 999.4,
        quoteRangeTo: 999.4,
      })
      ;(configDomainService.instanceConfig.getFeePercentageAmount as jest.Mock).mockResolvedValue(10)

      const result = await service.calculateDeliveryQuoteAmount(sampleInput)

      expect(result.baseFee).toBe(200)
      expect(result.distanceFee).toBe(107)
      expect(result.quoteRangeFrom).toBe(338)
      expect(result.quoteRangeTo).toBe(338)
    })
  })

  describe('AC-3: calculateDeliveryAmountsForMatchedCourier reads from stored quote', () => {
    it('takes fee, feePercentage and totalCost from stored quote even if fee % setting changes after quote', async () => {
      deliveryRepository.findById.mockResolvedValue({
        id: 'del-123',
        matchedCourierId: 'courier-1',
        deliveryQuoteId: 'quote-123',
      } as any)

      courierCompensationService.calculateCourierCompensationForDelivery.mockResolvedValue(307)

      deliveryQuoteRepository.findById.mockResolvedValue({
        id: 'quote-123',
        baseFee: 200,
        distanceFee: 107,
        quoteRangeFrom: 338,
        quoteRangeTo: 338,
        feePercentage: 10,
      } as any)

      // Change setting mock to 20% AFTER quote creation
      ;(configDomainService.instanceConfig.getFeePercentageAmount as jest.Mock).mockResolvedValue(20)

      const result = await service.calculateDeliveryAmountsForMatchedCourier({ deliveryId: 'del-123' })

      // Results must still reflect the stored quote (10% fee, 338 totalCost, 31 fee), not 20%
      expect(result.totalCompensation).toBe(307)
      expect(result.totalCost).toBe(338)
      expect(result.fee).toBe(31)
      expect(result.feePercentage).toBe(10)
    })

    it('throws BadRequestException when delivery is not found', async () => {
      deliveryRepository.findById.mockResolvedValue(null)

      await expect(service.calculateDeliveryAmountsForMatchedCourier({ deliveryId: 'missing-del' })).rejects.toThrow(
        BadRequestException
      )
    })

    it('throws BadRequestException when delivery quote is not found', async () => {
      deliveryRepository.findById.mockResolvedValue({
        id: 'del-123',
        matchedCourierId: 'courier-1',
        deliveryQuoteId: 'missing-quote',
      } as any)
      courierCompensationService.calculateCourierCompensationForDelivery.mockResolvedValue(307)
      deliveryQuoteRepository.findById.mockResolvedValue(null)

      await expect(service.calculateDeliveryAmountsForMatchedCourier({ deliveryId: 'del-123' })).rejects.toThrow(
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
