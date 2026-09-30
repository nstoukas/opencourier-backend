import { DeliveryQuoteDomainService } from './delivery-quote.domain.service'
import { ConfigDomainService } from '../config/config.domain.service'
import { DeliveryQuoteRepository } from 'src/persistence/repositories/delivery-quote.repository'
import { DeliveryCalculationService } from 'src/services/delivery-calculation/delivery-calculation.service'
import { LocationEntity } from '../location/entities/location.entity'
import { PartnerEntity } from '../partner/entities/partner.entity'

describe('DeliveryQuoteDomainService (AC-1)', () => {
  let service: DeliveryQuoteDomainService
  let configDomainService: jest.Mocked<ConfigDomainService>
  let deliveryQuoteRepository: jest.Mocked<DeliveryQuoteRepository>
  let deliveryCalculationService: jest.Mocked<DeliveryCalculationService>

  const samplePickup = new LocationEntity({ id: 'loc-pickup', latitude: 39.36, longitude: 22.94 } as any)
  const sampleDropoff = new LocationEntity({ id: 'loc-dropoff', latitude: 39.37, longitude: 22.95 } as any)
  const samplePartner = new PartnerEntity({ id: 'part-1' } as any)

  beforeEach(() => {
    configDomainService = {
      instanceConfig: {
        getCurrency: jest.fn().mockResolvedValue('EUR'),
        getDistanceUnit: jest.fn().mockResolvedValue('KILOMETERS'),
      },
    } as any

    deliveryQuoteRepository = {
      create: jest.fn().mockImplementation((arg) => Promise.resolve({ id: 'quote-new', ...arg })),
    } as any

    deliveryCalculationService = {
      calculateDeliveryQuoteAmount: jest.fn().mockResolvedValue({
        quoteRangeFrom: 338,
        quoteRangeTo: 338,
        feePercentage: 10,
        baseFee: 200,
        distanceFee: 107,
      }),
      calculateDeliveryQuoteDistance: jest.fn().mockResolvedValue(0.71),
      calculateDeliveryQuoteExpiration: jest.fn().mockResolvedValue(new Date()),
      calculateDeliveryQuoteDeliveryDuration: jest.fn().mockResolvedValue(15),
      calculateDropoffEta: jest.fn().mockResolvedValue(new Date()),
    } as any

    service = new DeliveryQuoteDomainService(
      configDomainService,
      deliveryQuoteRepository,
      deliveryCalculationService
    )
  })

  // AC-1: A new quote stores baseFee and distanceFee, passed through to deliveryQuoteRepository.create
  it('stores baseFee and distanceFee from calculation service and passes them to repository create (AC-1)', async () => {
    await service.create(samplePickup, sampleDropoff, samplePartner, {
      orderTotalValue: 1000,
      pickupPhoneNumber: '123',
      dropoffPhoneNumber: '456',
    })

    expect(deliveryQuoteRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseFee: 200,
        distanceFee: 107,
        quoteRangeFrom: 338,
        quoteRangeTo: 338,
        feePercentage: 10,
      })
    )
  })
})
