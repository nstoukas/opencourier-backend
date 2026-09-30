import { SimpleCourierCompensationService } from './simple-courier-compensation.service'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryQuoteRepository } from 'src/persistence/repositories/delivery-quote.repository'

describe('SimpleCourierCompensationService', () => {
  let service: SimpleCourierCompensationService
  let courierRepository: jest.Mocked<CourierRepository>
  let deliveryRepository: jest.Mocked<DeliveryRepository>
  let deliveryQuoteRepository: jest.Mocked<DeliveryQuoteRepository>

  const sampleInput = {
    courierId: 'courier-1',
    deliveryId: 'delivery-1',
  }

  const sampleCourier = { id: 'courier-1' }
  const sampleDelivery = { id: 'delivery-1', deliveryQuoteId: 'quote-1' }
  const sampleQuote = { id: 'quote-1', baseFee: 200, distanceFee: 107 }

  beforeEach(() => {
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
      courierRepository,
      deliveryRepository,
      deliveryQuoteRepository
    )
  })

  // AC-3: Pays quote.baseFee + quote.distanceFee
  it('returns rider pay as quote.baseFee + quote.distanceFee', async () => {
    deliveryQuoteRepository.findById.mockResolvedValue({ id: 'quote-1', baseFee: 200, distanceFee: 107 } as any)

    const compensation = await service.calculateCourierCompensationForDelivery(sampleInput)

    expect(compensation).toBe(307)
  })

  // AC-5: No floor: a 0.14 km trip pays 200 + 21 = 221, not 250
  it('pays 221 (200 base + 21 distance) for a 0.14 km trip without applying a floor of 250', async () => {
    deliveryQuoteRepository.findById.mockResolvedValue({ id: 'quote-1', baseFee: 200, distanceFee: 21 } as any)

    const compensation = await service.calculateCourierCompensationForDelivery(sampleInput)

    expect(compensation).toBe(221)
  })

  // AC-3 zero case: base 0 and distance 0 returns 0
  it('returns 0 when both baseFee and distanceFee are 0', async () => {
    deliveryQuoteRepository.findById.mockResolvedValue({ id: 'quote-1', baseFee: 0, distanceFee: 0 } as any)

    const compensation = await service.calculateCourierCompensationForDelivery(sampleInput)

    expect(compensation).toBe(0)
  })

  // Existing not-found paths (courier, delivery, quote) still reject with current messages
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
