import { DeliveryEventDomainService } from './delivery-event.domain.service'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'

describe('DeliveryEventDomainService', () => {
  let service: DeliveryEventDomainService
  let mockRepository: jest.Mocked<DeliveryEventRepository>

  beforeEach(() => {
    mockRepository = {
      findManyByDeliveryId: jest.fn(),
    } as unknown as jest.Mocked<DeliveryEventRepository>

    service = new DeliveryEventDomainService(mockRepository)
  })

  describe('getEventHistoryForDelivery', () => {
    test('delegates directly to repository findManyByDeliveryId', async () => {
      const deliveryId = 'del-event-history-1'
      const mockEvents = [{ id: 'evt-1' } as any]
      mockRepository.findManyByDeliveryId.mockResolvedValue(mockEvents)

      const result = await service.getEventHistoryForDelivery(deliveryId)

      expect(mockRepository.findManyByDeliveryId).toHaveBeenCalledWith(deliveryId)
      expect(result).toEqual(mockEvents)
    })
  })
})
