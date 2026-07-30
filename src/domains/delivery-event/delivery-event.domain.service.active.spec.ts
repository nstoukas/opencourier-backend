import { DeliveryEventDomainService } from './delivery-event.domain.service'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'

describe('DeliveryEventDomainService', () => {
  let service: DeliveryEventDomainService
  let mockRepository: jest.Mocked<DeliveryEventRepository>
  let mockCompensationRepository: jest.Mocked<CourierCompensationRepository>

  beforeEach(() => {
    // Create minimal mock for DeliveryEventRepository
    mockRepository = {
      findManyByDeliveryId: jest.fn(),
      findSuccessfulDropOffRowsForCourier: jest.fn(),
      findCompletedDeliveryRowsForCourier: jest.fn(),
      findCompletedDeliveryRowForCourierDelivery: jest.fn(),
    } as unknown as jest.Mocked<DeliveryEventRepository>

    // Create minimal mock for CourierCompensationRepository
    mockCompensationRepository = {
      findRowsForCourierEarnings: jest.fn().mockResolvedValue([]),
      findDetailedRowsForCourierDay: jest.fn().mockResolvedValue([]),
      findDetailedRowsForCourierDelivery: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<CourierCompensationRepository>

    service = new DeliveryEventDomainService(mockRepository, mockCompensationRepository)
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

    // Test Plan Case 14: Summary includes compensation amounts
    test('includes compensation amounts alongside drop-off rows in the returned day summaries', async () => {
      const courierId = 'courier-123'
      const from = new Date('2026-07-01T00:00:00Z')
      const to = new Date('2026-07-31T23:59:59Z')

      mockRepository.findSuccessfulDropOffRowsForCourier.mockResolvedValue([
        {
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-10T10:00:00Z'),
          totalCompensation: 500,
          tips: 100,
        },
      ])
      mockCompensationRepository.findRowsForCourierEarnings.mockResolvedValue([
        {
          deliveryId: 'del-reassigned-1',
          createdAt: new Date('2026-07-10T14:00:00Z'),
          amount: 350,
        },
      ])

      const result = await service.getEarningsSummaryForCourier(courierId, from, to, 'UTC')

      expect(result).toEqual([
        {
          date: '2026-07-10',
          deliveryCount: 1,
          compensation: 850, // 500 + 350
          tips: 100,
          total: 950,
        },
      ])
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

    // Test Plan Case 14: Day list includes compensation entries
    test('includes compensation entries in the day deliveries list', async () => {
      const courierId = 'courier-123'
      const date = '2026-07-10'
      const timezone = 'UTC'

      mockRepository.findCompletedDeliveryRowsForCourier.mockResolvedValue([])
      mockCompensationRepository.findDetailedRowsForCourierDay.mockResolvedValue([
        {
          deliveryId: 'del-comp-1',
          createdAt: new Date('2026-07-10T11:00:00Z'),
          amount: 400,
          pickupBusinessName: 'Test Cafe',
          dropoffLocation: {
            formattedAddress: 'Main St 5',
            street: 'Main St 5',
            city: 'Volos',
            state: 'Thessaly',
          },
        },
      ])

      const result = await service.getEarningsDeliveriesForCourierDay(courierId, date, timezone)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        deliveryId: 'del-comp-1',
        droppedOffAt: new Date('2026-07-10T11:00:00Z'),
        dropoffAddress: 'Main St 5',
        pickupBusinessName: 'Test Cafe',
        compensation: 400,
        tips: 0,
        total: 400,
        kind: 'REASSIGNMENT_COMPENSATION',
      })
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

    test('returns null when delivery row is not found or not completed and no compensation rows exist', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue(null)
      mockCompensationRepository.findDetailedRowsForCourierDelivery.mockResolvedValue([])

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-missing')

      expect(result).toBeNull()
    })

    // Test Plan Case 14: Detail falls back to compensation rows and sums multiple rows
    test('falls back to compensation rows when no drop-off row exists and sums multiple compensation rows', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue(null)
      mockCompensationRepository.findDetailedRowsForCourierDelivery.mockResolvedValue([
        {
          deliveryId: 'del-comp-detail',
          createdAt: new Date('2026-07-10T09:00:00Z'),
          amount: 200,
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: { formattedAddress: 'Address A', street: null, city: null, state: null },
        },
        {
          deliveryId: 'del-comp-detail',
          createdAt: new Date('2026-07-10T12:00:00Z'),
          amount: 150,
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: { formattedAddress: 'Address A', street: null, city: null, state: null },
        },
      ])

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-comp-detail')

      expect(result).toEqual({
        deliveryId: 'del-comp-detail',
        droppedOffAt: new Date('2026-07-10T09:00:00Z'), // earliest timestamp
        dropoffAddress: 'Address A',
        pickupBusinessName: 'Pizzeria',
        compensation: 350, // 200 + 150
        tips: 0,
        total: 350,
        kind: 'REASSIGNMENT_COMPENSATION',
      })
    })
  })

  describe('courierId scoping', () => {
    // Test Plan Case 15: Scoping check
    test('passes courierId argument through to compensation repository in all methods', async () => {
      const courierId = 'courier-scope-check'
      const from = new Date('2026-07-01T00:00:00Z')
      const to = new Date('2026-07-31T23:59:59Z')

      mockRepository.findSuccessfulDropOffRowsForCourier.mockResolvedValue([])
      mockRepository.findCompletedDeliveryRowsForCourier.mockResolvedValue([])
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue(null)

      // 1. getEarningsSummaryForCourier
      await service.getEarningsSummaryForCourier(courierId, from, to, 'UTC')
      expect(mockCompensationRepository.findRowsForCourierEarnings).toHaveBeenCalledWith(courierId, from, to)

      // 2. getEarningsDeliveriesForCourierDay
      await service.getEarningsDeliveriesForCourierDay(courierId, '2026-07-10', 'UTC')
      expect(mockCompensationRepository.findDetailedRowsForCourierDay).toHaveBeenCalledWith(
        courierId,
        expect.any(Date),
        expect.any(Date)
      )

      // 3. getEarningsDeliveryDetailForCourier
      await service.getEarningsDeliveryDetailForCourier(courierId, 'del-123')
      expect(mockCompensationRepository.findDetailedRowsForCourierDelivery).toHaveBeenCalledWith(courierId, 'del-123')
    })
  })
})
