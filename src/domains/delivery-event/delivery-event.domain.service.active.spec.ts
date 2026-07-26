import { DeliveryEventDomainService } from './delivery-event.domain.service'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'

describe('DeliveryEventDomainService', () => {
  let service: DeliveryEventDomainService
  let mockRepository: jest.Mocked<DeliveryEventRepository>

  beforeEach(() => {
    // Create minimal mock for DeliveryEventRepository with findSuccessfulDropOffRowsForCourier
    mockRepository = {
      findSuccessfulDropOffRowsForCourier: jest.fn(),
    } as unknown as jest.Mocked<DeliveryEventRepository>

    service = new DeliveryEventDomainService(mockRepository)
  })

  describe('getEarningsSummaryForCourier', () => {
    test('fetches delivery drop-off rows and returns summarized earnings by day', async () => {
      // Setup test inputs: courierId, date range, timezone
      const courierId = 'courier-123'
      const from = new Date('2026-07-01T00:00:00Z')
      const to = new Date('2026-07-31T23:59:59Z')
      const timezone = 'UTC'

      // Mock repository returning two completed drop-off rows
      mockRepository.findSuccessfulDropOffRowsForCourier.mockResolvedValue([
        {
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-10T10:00:00Z'),
          totalCompensation: 500,
          tips: 100,
        },
        {
          deliveryId: 'del-2',
          droppedOffAt: new Date('2026-07-10T15:00:00Z'),
          totalCompensation: 700,
          tips: 50,
        },
      ])

      const result = await service.getEarningsSummaryForCourier(courierId, from, to, timezone)

      // Verify repository was queried with exact arguments
      expect(mockRepository.findSuccessfulDropOffRowsForCourier).toHaveBeenCalledWith(courierId, from, to)

      // Verify summarized result structure
      expect(result).toEqual([
        {
          date: '2026-07-10',
          deliveryCount: 2,
          compensation: 1200,
          tips: 150,
          total: 1350,
        },
      ])
    })

    test('returns empty array when no drop-off events exist for the courier', async () => {
      const courierId = 'courier-empty'
      const from = new Date('2026-07-01T00:00:00Z')
      const to = new Date('2026-07-31T23:59:59Z')

      mockRepository.findSuccessfulDropOffRowsForCourier.mockResolvedValue([])

      const result = await service.getEarningsSummaryForCourier(courierId, from, to, 'UTC')

      expect(result).toEqual([])
    })
  })
})
