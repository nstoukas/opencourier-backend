import { SimpleCourierCompensationService } from './simple-courier-compensation.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryQuoteRepository } from 'src/persistence/repositories/delivery-quote.repository'

describe('SimpleCourierCompensationService', () => {
  let service: SimpleCourierCompensationService
  let configDomainService: jest.Mocked<ConfigDomainService>
  let courierRepository: jest.Mocked<CourierRepository>
  let deliveryRepository: jest.Mocked<DeliveryRepository>
  let deliveryQuoteRepository: jest.Mocked<DeliveryQuoteRepository>

  const sampleInput = {
    courierId: 'courier-1',
    deliveryId: 'delivery-1',
  }

  const sampleCourier = { id: 'courier-1' }
  const sampleDelivery = { id: 'delivery-1', deliveryQuoteId: 'quote-1' }
  const sampleQuote = { id: 'quote-1', quoteRangeFrom: 21 }

  beforeEach(() => {
    configDomainService = {
      instanceConfig: {
        getDefaultMinimumCourierPay: jest.fn().mockResolvedValue(250),
      },
    } as any

    courierRepository = {
      findById: jest.fn().mockResolvedValue(sampleCourier),
    } as any

    deliveryRepository = {
      findById: jest.fn().mockResolvedValue(sampleDelivery),
    } as any

    deliveryQuoteRepository = {
      findById: jest.fn().mockResolvedValue(sampleQuote),
    } as any

    service = new SimpleCourierCompensationService(
      configDomainService,
      courierRepository,
      deliveryRepository,
      deliveryQuoteRepository
    )
  })

  // D1. Quote quoteRangeFrom = 21, defaultMinimumCourierPay = 250 -> returns 250
  it('binds minimum courier pay floor when quote compensation is below floor', async () => {
    deliveryQuoteRepository.findById.mockResolvedValue({ id: 'quote-1', quoteRangeFrom: 21 } as any)
    ;(configDomainService.instanceConfig.getDefaultMinimumCourierPay as jest.Mock).mockResolvedValue(250)

    const compensation = await service.calculateCourierCompensationForDelivery(sampleInput)

    expect(compensation).toBe(250)
  })

  // D2. Quote quoteRangeFrom = 900, floor 250 -> returns 900
  it('returns raw quote compensation when it exceeds minimum pay floor', async () => {
    deliveryQuoteRepository.findById.mockResolvedValue({ id: 'quote-1', quoteRangeFrom: 900 } as any)
    ;(configDomainService.instanceConfig.getDefaultMinimumCourierPay as jest.Mock).mockResolvedValue(250)

    const compensation = await service.calculateCourierCompensationForDelivery(sampleInput)

    expect(compensation).toBe(900)
  })

  // D3. Floor null -> returns quoteRangeFrom unchanged
  it('returns quoteRangeFrom unchanged when minimum courier pay is null', async () => {
    deliveryQuoteRepository.findById.mockResolvedValue({ id: 'quote-1', quoteRangeFrom: 21 } as any)
    ;(configDomainService.instanceConfig.getDefaultMinimumCourierPay as jest.Mock).mockResolvedValue(null)

    const compensation = await service.calculateCourierCompensationForDelivery(sampleInput)

    expect(compensation).toBe(21)
  })

  // D4. When floor binds, logger.warn is called once with delivery id, both amounts, and absorbed difference
  it('emits a warning log when minimum courier pay floor binds with delivery details', async () => {
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => {})
    deliveryQuoteRepository.findById.mockResolvedValue({ id: 'quote-1', quoteRangeFrom: 21 } as any)
    ;(configDomainService.instanceConfig.getDefaultMinimumCourierPay as jest.Mock).mockResolvedValue(250)

    await service.calculateCourierCompensationForDelivery(sampleInput)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const warnMessage = warnSpy.mock.calls[0]![0]
    expect(warnMessage).toContain('delivery-1')
    expect(warnMessage).toContain('quote 21')
    expect(warnMessage).toContain('raised to 250')
    expect(warnMessage).toContain('difference of 229')

    warnSpy.mockRestore()
  })

  // D5. When floor does not bind, no warn log is emitted
  it('does not emit a warning log when minimum pay floor does not bind', async () => {
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => {})
    deliveryQuoteRepository.findById.mockResolvedValue({ id: 'quote-1', quoteRangeFrom: 900 } as any)
    ;(configDomainService.instanceConfig.getDefaultMinimumCourierPay as jest.Mock).mockResolvedValue(250)

    await service.calculateCourierCompensationForDelivery(sampleInput)

    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  // D6. Existing not-found paths (courier, delivery, quote) still reject with current messages
  it('rejects when courier is not found', async () => {
    courierRepository.findById.mockResolvedValue(null)

    await expect(service.calculateCourierCompensationForDelivery(sampleInput)).rejects.toThrow(
      'Courier not found: courier-1'
    )
  })

  it('rejects when delivery is not found', async () => {
    deliveryRepository.findById.mockResolvedValue(null)

    await expect(service.calculateCourierCompensationForDelivery(sampleInput)).rejects.toThrow(
      'Delivery not found: delivery-1'
    )
  })

  it('rejects when delivery quote is not found', async () => {
    deliveryQuoteRepository.findById.mockResolvedValue(null)

    await expect(service.calculateCourierCompensationForDelivery(sampleInput)).rejects.toThrow(
      'Delivery quote not found: quote-1'
    )
  })
})
