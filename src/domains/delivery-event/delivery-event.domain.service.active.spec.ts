import { EnumCourierCompensationReason } from '@prisma/types'
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

    test('maps CANCELLATION compensation entries to kind CANCELLATION_COMPENSATION (spec 0015 AC-15)', async () => {
      const courierId = 'courier-123'
      const date = '2026-07-10'
      const timezone = 'UTC'

      mockRepository.findCompletedDeliveryRowsForCourier.mockResolvedValue([])
      mockCompensationRepository.findDetailedRowsForCourierDay.mockResolvedValue([
        {
          deliveryId: 'del-cancel-comp',
          createdAt: new Date('2026-07-10T14:30:00Z'),
          amount: 450,
          reason: EnumCourierCompensationReason.CANCELLATION,
          pickupBusinessName: 'Souvlaki Bar',
          dropoffLocation: {
            formattedAddress: 'Dimitriadis 100',
            street: 'Dimitriadis 100',
            city: 'Volos',
            state: 'Thessaly',
          },
        },
      ])

      const result = await service.getEarningsDeliveriesForCourierDay(courierId, date, timezone)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        deliveryId: 'del-cancel-comp',
        droppedOffAt: new Date('2026-07-10T14:30:00Z'),
        dropoffAddress: 'Dimitriadis 100',
        pickupBusinessName: 'Souvlaki Bar',
        compensation: 450,
        tips: 0,
        total: 450,
        kind: 'CANCELLATION_COMPENSATION',
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

    test('adds waitingPay to total and returns waitingPay on a delivered order when WAITING compensation exists (Spec 0033 decision 23.11)', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue({
        deliveryId: 'del-with-wait',
        droppedOffAt: new Date('2026-07-10T10:00:00Z'),
        totalCompensation: 600,
        tips: 150,
        pickupBusinessName: 'Ta Koutsavakia',
        dropoffAddress: 'Iasonos 12, Volos',
      })
      mockCompensationRepository.findDetailedRowsForCourierDelivery.mockResolvedValue([
        {
          deliveryId: 'del-with-wait',
          createdAt: new Date('2026-07-10T09:55:00Z'),
          amount: 100, // 100 cents waiting pay
          reason: EnumCourierCompensationReason.WAITING,
          pickupBusinessName: 'Ta Koutsavakia',
          dropoffLocation: null,
        },
      ])

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-with-wait')

      expect(result).toEqual({
        deliveryId: 'del-with-wait',
        droppedOffAt: new Date('2026-07-10T10:00:00Z'),
        dropoffAddress: 'Iasonos 12, Volos',
        pickupBusinessName: 'Ta Koutsavakia',
        compensation: 600,
        tips: 150,
        waitingPay: 100,
        total: 850, // 600 + 150 + 100
      })
    })

    test('a delivered order with a REASSIGNMENT row and a WAITING row counts only the WAITING amount in waitingPay and total (decision 23.11)', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue({
        deliveryId: 'del-with-wait-and-reassign',
        droppedOffAt: new Date('2026-07-10T10:00:00Z'),
        totalCompensation: 600,
        tips: 150,
        pickupBusinessName: 'Ta Koutsavakia',
        dropoffAddress: 'Iasonos 12, Volos',
      })
      mockCompensationRepository.findDetailedRowsForCourierDelivery.mockResolvedValue([
        {
          deliveryId: 'del-with-wait-and-reassign',
          createdAt: new Date('2026-07-10T09:30:00Z'),
          amount: 250, // 250 cents reassignment compensation from an earlier attempt
          reason: EnumCourierCompensationReason.REASSIGNMENT,
          pickupBusinessName: 'Ta Koutsavakia',
          dropoffLocation: null,
        },
        {
          deliveryId: 'del-with-wait-and-reassign',
          createdAt: new Date('2026-07-10T09:55:00Z'),
          amount: 100, // 100 cents waiting pay
          reason: EnumCourierCompensationReason.WAITING,
          pickupBusinessName: 'Ta Koutsavakia',
          dropoffLocation: null,
        },
      ])

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-with-wait-and-reassign')

      expect(result).toEqual({
        deliveryId: 'del-with-wait-and-reassign',
        droppedOffAt: new Date('2026-07-10T10:00:00Z'),
        dropoffAddress: 'Iasonos 12, Volos',
        pickupBusinessName: 'Ta Koutsavakia',
        compensation: 600,
        tips: 150,
        waitingPay: 100, // Only WAITING row (100 cents), not REASSIGNMENT row (250 cents)
        total: 850, // 600 + 150 + 100
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

    test('cancelled job with return trip pay exposes returnTripPay as its own line and sums into total (Spec 0035 AC-17)', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue(null)
      mockCompensationRepository.findDetailedRowsForCourierDelivery.mockResolvedValue([
        {
          deliveryId: 'del-cancelled-return',
          createdAt: new Date('2026-07-10T09:00:00Z'),
          amount: 450, // Cancellation compensation
          reason: EnumCourierCompensationReason.CANCELLATION,
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: { formattedAddress: 'Address A', street: null, city: null, state: null },
        },
        {
          deliveryId: 'del-cancelled-return',
          createdAt: new Date('2026-07-10T09:15:00Z'),
          amount: 150, // Return trip compensation
          reason: EnumCourierCompensationReason.RETURN_TRIP,
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: { formattedAddress: 'Address A', street: null, city: null, state: null },
        },
      ])

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-cancelled-return')

      expect(result).toEqual({
        deliveryId: 'del-cancelled-return',
        droppedOffAt: new Date('2026-07-10T09:00:00Z'),
        dropoffAddress: 'Address A',
        pickupBusinessName: 'Pizzeria',
        compensation: 450, // Main line holds what is left after breaking out other lines
        tips: 0,
        total: 600,
        kind: 'CANCELLATION_COMPENSATION',
        returnTripPay: 150, // Own line, not mixed into waitingPay or another field
      })
      expect(result?.waitingPay).toBeUndefined()
    })

    test('delivered order does not add RETURN_TRIP rows into waitingPay (Spec 0035 AC-17)', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue({
        deliveryId: 'del-delivered-clean',
        droppedOffAt: new Date('2026-07-10T10:00:00Z'),
        totalCompensation: 500,
        tips: 100,
        pickupBusinessName: 'Pizzeria',
        dropoffAddress: 'Address B',
      })
      mockCompensationRepository.findDetailedRowsForCourierDelivery.mockResolvedValue([
        {
          deliveryId: 'del-delivered-clean',
          createdAt: new Date('2026-07-10T09:45:00Z'),
          amount: 120,
          reason: EnumCourierCompensationReason.WAITING,
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: null,
        },
        {
          deliveryId: 'del-delivered-clean',
          createdAt: new Date('2026-07-10T09:50:00Z'),
          amount: 200,
          reason: EnumCourierCompensationReason.RETURN_TRIP,
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: null,
        },
      ])

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-delivered-clean')

      expect(result?.waitingPay).toBe(120)
      expect(result?.returnTripPay).toBeUndefined()
      expect(result?.total).toBe(720) // 500 + 100 + 120 waitingPay (RETURN_TRIP not added)
    })

    test('job not delivered, removal with wait: REMOVAL names line, compensation holds removal amount, waitingPay is own field, removalPay key absent, compensation plus waitingPay equals total (Spec 0035 AC-17)', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue(null)
      mockCompensationRepository.findDetailedRowsForCourierDelivery.mockResolvedValue([
        {
          deliveryId: 'del-removal-wait',
          createdAt: new Date('2026-07-10T09:00:00Z'),
          amount: 250,
          reason: EnumCourierCompensationReason.REMOVAL,
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: { formattedAddress: 'Address A', street: null, city: null, state: null },
        },
        {
          deliveryId: 'del-removal-wait',
          createdAt: new Date('2026-07-10T09:10:00Z'),
          amount: 80,
          reason: EnumCourierCompensationReason.WAITING,
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: { formattedAddress: 'Address A', street: null, city: null, state: null },
        },
      ])

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-removal-wait')

      expect(result).not.toBeNull()
      expect(result?.kind).toBe('REMOVAL_COMPENSATION')
      expect(result?.compensation).toBe(250)
      expect(result?.waitingPay).toBe(80)
      expect(result).not.toHaveProperty('removalPay')
      expect(result?.total).toBe(330)
      expect(result!.compensation + result!.waitingPay!).toBe(result!.total)
    })

    test('job not delivered, cancellation with removal, wait and return trip: CANCELLATION names line, compensation holds cancellation amount, other pays in own fields, sum equals total (Spec 0035 AC-17)', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue(null)
      mockCompensationRepository.findDetailedRowsForCourierDelivery.mockResolvedValue([
        {
          deliveryId: 'del-canc-all',
          createdAt: new Date('2026-07-10T09:00:00Z'),
          amount: 400,
          reason: EnumCourierCompensationReason.CANCELLATION,
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: { formattedAddress: 'Address A', street: null, city: null, state: null },
        },
        {
          deliveryId: 'del-canc-all',
          createdAt: new Date('2026-07-10T09:05:00Z'),
          amount: 120,
          reason: EnumCourierCompensationReason.REMOVAL,
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: { formattedAddress: 'Address A', street: null, city: null, state: null },
        },
        {
          deliveryId: 'del-canc-all',
          createdAt: new Date('2026-07-10T09:10:00Z'),
          amount: 70,
          reason: EnumCourierCompensationReason.WAITING,
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: { formattedAddress: 'Address A', street: null, city: null, state: null },
        },
        {
          deliveryId: 'del-canc-all',
          createdAt: new Date('2026-07-10T09:20:00Z'),
          amount: 150,
          reason: EnumCourierCompensationReason.RETURN_TRIP,
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: { formattedAddress: 'Address A', street: null, city: null, state: null },
        },
      ])

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-canc-all')

      expect(result).not.toBeNull()
      expect(result?.kind).toBe('CANCELLATION_COMPENSATION')
      expect(result?.compensation).toBe(400)
      expect(result?.removalPay).toBe(120)
      expect(result?.waitingPay).toBe(70)
      expect(result?.returnTripPay).toBe(150)
      expect(result?.total).toBe(740)
      expect(result!.compensation + result!.removalPay! + result!.waitingPay! + result!.returnTripPay!).toBe(result!.total)
    })

    test('delivered job with both WAITING and REMOVAL: total is delivered total plus wait plus removal, and waitingPay and removalPay are each their own field (Spec 0035 AC-17)', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue({
        deliveryId: 'del-delivered-wait-removal',
        droppedOffAt: new Date('2026-07-10T10:00:00Z'),
        totalCompensation: 500,
        tips: 50,
        pickupBusinessName: 'Pizzeria',
        dropoffAddress: 'Address B',
      })
      mockCompensationRepository.findDetailedRowsForCourierDelivery.mockResolvedValue([
        {
          deliveryId: 'del-delivered-wait-removal',
          createdAt: new Date('2026-07-10T09:40:00Z'),
          amount: 110,
          reason: EnumCourierCompensationReason.WAITING,
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: null,
        },
        {
          deliveryId: 'del-delivered-wait-removal',
          createdAt: new Date('2026-07-10T09:45:00Z'),
          amount: 130,
          reason: EnumCourierCompensationReason.REMOVAL,
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: null,
        },
      ])

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-delivered-wait-removal')

      expect(result?.waitingPay).toBe(110)
      expect(result?.removalPay).toBe(130)
      expect(result?.total).toBe(790) // 550 + 110 + 130
    })

    test('delivered job with neither WAITING nor REMOVAL row: returned object has no waitingPay key and no removalPay key (Spec 0035 AC-17)', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue({
        deliveryId: 'del-delivered-plain',
        droppedOffAt: new Date('2026-07-10T10:00:00Z'),
        totalCompensation: 500,
        tips: 50,
        pickupBusinessName: 'Pizzeria',
        dropoffAddress: 'Address C',
      })
      mockCompensationRepository.findDetailedRowsForCourierDelivery.mockResolvedValue([])

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-delivered-plain')

      expect(result).not.toBeNull()
      expect(result).not.toHaveProperty('waitingPay')
      expect(result).not.toHaveProperty('removalPay')
      expect(result?.total).toBe(550)
    })

    test('delivered job with REVIEW correction row includes reviewPay and adds it to total (Spec 0038 AC-7, AC-10)', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue({
        deliveryId: 'del-delivered-review',
        droppedOffAt: new Date('2026-07-10T10:00:00Z'),
        totalCompensation: 500,
        tips: 0,
        pickupBusinessName: 'Pizzeria',
        dropoffAddress: 'Address C',
      })
      mockCompensationRepository.findDetailedRowsForCourierDelivery.mockResolvedValue([
        {
          deliveryId: 'del-delivered-review',
          reason: EnumCourierCompensationReason.REVIEW,
          amount: 150,
          createdAt: new Date('2026-07-15T12:00:00Z'),
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: null,
        },
      ])

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-delivered-review')

      expect(result).not.toBeNull()
      expect(result?.reviewPay).toBe(150)
      expect(result?.total).toBe(650) // 500 + 150
    })

    test('undelivered compensation job with REVIEW correction includes reviewPay as separate line (Spec 0038 AC-7, AC-10)', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue(null)
      mockCompensationRepository.findDetailedRowsForCourierDelivery.mockResolvedValue([
        {
          deliveryId: 'del-canc-review',
          reason: EnumCourierCompensationReason.CANCELLATION,
          amount: 300,
          createdAt: new Date('2026-07-10T09:00:00Z'),
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: { formattedAddress: 'Address A', street: null, city: null, state: null },
        },
        {
          deliveryId: 'del-canc-review',
          reason: EnumCourierCompensationReason.REVIEW,
          amount: 200,
          createdAt: new Date('2026-07-12T10:00:00Z'),
          pickupBusinessName: 'Pizzeria',
          dropoffLocation: { formattedAddress: 'Address A', street: null, city: null, state: null },
        },
      ])

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-canc-review')

      expect(result).not.toBeNull()
      expect(result?.kind).toBe('CANCELLATION_COMPENSATION')
      expect(result?.compensation).toBe(300)
      expect(result?.reviewPay).toBe(200)
      expect(result?.total).toBe(500) // 300 + 200
    })

    it('returns dropoffAddress null in undelivered detail branch when the only row is a REVIEW one (Spec 0038 review)', async () => {
      mockRepository.findCompletedDeliveryRowForCourierDelivery.mockResolvedValue(null)
      mockCompensationRepository.findDetailedRowsForCourierDelivery.mockResolvedValue([
        {
          deliveryId: 'del-review-only',
          amount: 250,
          reason: EnumCourierCompensationReason.REVIEW,
          createdAt: new Date('2026-07-15T12:00:00Z'),
          pickupBusinessName: 'Souvlaki Shop',
          dropoffLocation: { formattedAddress: 'Private Residence 123, Volos', street: null, city: null, state: null },
        },
      ])

      const result = await service.getEarningsDeliveryDetailForCourier('courier-123', 'del-review-only')

      expect(result).not.toBeNull()
      expect(result?.kind).toBe('REVIEW_CORRECTION')
      expect(result?.dropoffAddress).toBeNull()
      expect(result?.pickupBusinessName).toBe('Souvlaki Shop')
      expect(result?.total).toBe(250)
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
