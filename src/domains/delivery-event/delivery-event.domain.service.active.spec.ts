import { DeliveryEventDomainService } from './delivery-event.domain.service'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'

describe('DeliveryEventDomainService', () => {
  let service: DeliveryEventDomainService
  let mockRepository: jest.Mocked<DeliveryEventRepository>

  beforeEach(() => {
    // Create minimal mock for DeliveryEventRepository with findSuccessfulDropOffRowsForCourier and new drill-down methods
    mockRepository = {
      findSuccessfulDropOffRowsForCourier: jest.fn(),
      findCompletedDeliveryRowsForCourier: jest.fn(),
      findCompletedDeliveryRowForCourierDelivery: jest.fn(),
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

  describe('getEarningsDeliveriesForCourierDay', () => {
    test('computes day boundaries in timezone and maps deliveries for requested date', async () => {
      const courierId = 'courier-123'
      const date = '2026-07-10'
      const timezone = 'Europe/Athens'

      mockRepository.findCompletedDeliveryRowsForCourier.mockResolvedValue([
        {
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-10T10:00:00Z'),
          totalCompensation: 500,
          tips: 100,
          pickupBusinessName: 'Ta Koutsavakia',
          dropoffAddress: 'Iasonos 12, Volos',
        },
      ])

      const result = await service.getEarningsDeliveriesForCourierDay(courierId, date, timezone)

      // Check repository queried with completed delivery rows method
      expect(mockRepository.findCompletedDeliveryRowsForCourier).toHaveBeenCalled()
      expect(result).toHaveLength(1)
      expect(result[0]?.deliveryId).toBe('del-1')
      expect(result[0]?.compensation).toBe(500)
      expect(result[0]?.tips).toBe(100)
      expect(result[0]?.total).toBe(600)
    })
  })

  describe('getEarningsDeliveryDetailForCourier', () => {
    test('returns mapped EarningsDelivery when completed delivery row exists', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue({
        deliveryId: 'del-1',
        droppedOffAt: new Date('2026-07-10T10:00:00Z'),
        totalCompensation: 600,
        tips: 150,
        pickupBusinessName: 'Ta Koutsavakia',
        dropoffAddress: 'Iasonos 12, Volos',
      })

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-1')

      expect(mockRepository.findCompletedDeliveryRowForCourierDelivery).toHaveBeenCalledWith('courier-123', 'del-1')
      expect(result).toEqual({
        deliveryId: 'del-1',
        droppedOffAt: new Date('2026-07-10T10:00:00Z'),
        dropoffAddress: 'Iasonos 12, Volos',
        pickupBusinessName: 'Ta Koutsavakia',
        compensation: 600,
        tips: 150,
        total: 750,
      })
    })

    test('returns null when delivery row is not found or not completed', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue(null)

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-missing')

      expect(result).toBeNull()
    })
  })
})

