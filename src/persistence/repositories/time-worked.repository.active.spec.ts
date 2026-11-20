import { TimeWorkedRepository } from './time-worked.repository'
import { PrismaService } from 'src/services/prisma/prisma.service'
import {
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumDistanceUnit,
  EnumEventActor,
} from '@prisma/types'

describe('TimeWorkedRepository (spec 0042 AC-3, AC-12)', () => {
  let repository: TimeWorkedRepository
  let mockPrisma: any

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      courierStatusChange: {
        aggregate: jest.fn().mockResolvedValue({ _min: { createdAt: new Date('2026-01-01') } }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      deliveryEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      delivery: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      courierCompensation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    }

    repository = new TimeWorkedRepository(mockPrisma as unknown as PrismaService)
  })

  describe('findRecords withJobDetails (AC-3, AC-12)', () => {
    const rangeStart = new Date('2026-11-20T00:00:00Z')
    const rangeEnd = new Date('2026-11-20T23:59:59Z')

    test('with withJobDetails true, includes quote and dropoff location, converts MILES to KM, and computes dropoffArea', async () => {
      // Mock event that links delivery
      mockPrisma.deliveryEvent.findMany.mockImplementation(({ where }: any) => {
        if (where?.type === EnumDeliveryEventType.ACCEPTED) {
          return Promise.resolve([
            { id: 'ev-1', deliveryId: 'del-miles', type: EnumDeliveryEventType.ACCEPTED, courierId: 'c-1', occurredAt: rangeStart, createdAt: rangeStart },
            { id: 'ev-2', deliveryId: 'del-street-with-num', type: EnumDeliveryEventType.ACCEPTED, courierId: 'c-1', occurredAt: rangeStart, createdAt: rangeStart },
            { id: 'ev-3', deliveryId: 'del-empty-loc', type: EnumDeliveryEventType.ACCEPTED, courierId: 'c-1', occurredAt: rangeStart, createdAt: rangeStart },
          ])
        }
        return Promise.resolve([])
      })

      // Mock delivery.findMany with quote and dropoffLocation
      mockPrisma.delivery.findMany.mockResolvedValue([
        {
          id: 'del-miles',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId: 'c-1',
          totalCompensation: 600,
          tips: 100,
          pickupBusinessName: 'Taverna',
          delivery: { distance: 10, distanceUnit: EnumDistanceUnit.MILES }, // 10 miles = 16.0934 km
          dropoffLocation: { street: 'Ermou', houseNumber: '42', city: 'Volos' }, // street does not contain houseNumber -> 'Ermou'
        },
        {
          id: 'del-street-with-num',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId: 'c-1',
          totalCompensation: 500,
          tips: 0,
          pickupBusinessName: 'Bakery',
          delivery: { distance: 2.5, distanceUnit: EnumDistanceUnit.KILOMETERS },
          dropoffLocation: { street: 'Iasonos 45', houseNumber: '45', city: 'Volos' }, // street contains houseNumber -> city 'Volos'
        },
        {
          id: 'del-empty-loc',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId: 'c-1',
          totalCompensation: 400,
          tips: 0,
          pickupBusinessName: 'Cafe',
          delivery: { distance: 1.2, distanceUnit: EnumDistanceUnit.KILOMETERS },
          dropoffLocation: { street: '', houseNumber: '', city: '' }, // empty -> null
        },
      ])

      const records = await repository.findRecords({
        courierId: 'c-1',
        windowStart: rangeStart,
        windowEnd: rangeEnd,
        rangeStart,
        rangeEnd,
        withAdminLabels: false,
        withJobDetails: true,
      })

      expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            delivery: { select: { distance: true, distanceUnit: true } },
            dropoffLocation: { select: { street: true, houseNumber: true, city: true } },
          }),
        })
      )

      expect(records.deliveries).toHaveLength(3)

      const delMiles = records.deliveries.find((d) => d.id === 'del-miles')!
      expect(delMiles.paidKm).toBeCloseTo(16.0934, 4) // MILES converted to KM
      expect(delMiles.dropoffArea).toBe('Ermou')

      const delStreetWithNum = records.deliveries.find((d) => d.id === 'del-street-with-num')!
      expect(delStreetWithNum.paidKm).toBe(2.5)
      expect(delStreetWithNum.dropoffArea).toBe('Volos') // town when street contains house number

      const delEmpty = records.deliveries.find((d) => d.id === 'del-empty-loc')!
      expect(delEmpty.paidKm).toBe(1.2)
      expect(delEmpty.dropoffArea).toBeNull() // empty area gives null
    })

    test('without withJobDetails (default false), does not query quote or dropoff location, and leaves paidKm and dropoffArea undefined', async () => {
      mockPrisma.deliveryEvent.findMany.mockImplementation(({ where }: any) => {
        if (where?.type === EnumDeliveryEventType.ACCEPTED) {
          return Promise.resolve([
            { id: 'ev-1', deliveryId: 'del-plain', type: EnumDeliveryEventType.ACCEPTED, courierId: 'c-1', occurredAt: rangeStart, createdAt: rangeStart },
          ])
        }
        return Promise.resolve([])
      })

      mockPrisma.delivery.findMany.mockResolvedValue([
        {
          id: 'del-plain',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId: 'c-1',
          totalCompensation: 500,
          tips: 0,
          pickupBusinessName: 'Plain Restaurant',
        },
      ])

      const records = await repository.findRecords({
        courierId: 'c-1',
        windowStart: rangeStart,
        windowEnd: rangeEnd,
        rangeStart,
        rangeEnd,
        withAdminLabels: false,
        withJobDetails: false,
      })

      expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            status: true,
            courierId: true,
            totalCompensation: true,
            tips: true,
            pickupBusinessName: true,
          },
        })
      )

      const delPlain = records.deliveries[0]!
      expect(delPlain.paidKm).toBeUndefined()
      expect(delPlain.dropoffArea).toBeUndefined()
    })
  })

  describe('findAcceptTimes, findDeliveryPay, findTimelineEvents', () => {
    test('findAcceptTimes returns occurredAt dates for accepted events of delivery', async () => {
      const t1 = new Date('2026-11-20T10:00:00Z')
      const t2 = new Date('2026-11-20T15:00:00Z')
      mockPrisma.deliveryEvent.findMany.mockResolvedValue([
        { occurredAt: t1 },
        { occurredAt: t2 },
      ])

      const result = await repository.findAcceptTimes('c-1', 'del-123')

      expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledWith({
        where: {
          deliveryId: 'del-123',
          courierId: 'c-1',
          type: EnumDeliveryEventType.ACCEPTED,
          transitionSuccessful: true,
        },
        select: { occurredAt: true },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      })
      expect(result).toEqual([t1, t2])
    })

    test('findDeliveryPay returns DeliveryPayRow with converted paidKm and area, or null if delivery not found', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue({
        id: 'del-pay-1',
        status: EnumDeliveryStatus.DROPPED_OFF,
        courierId: 'c-1',
        totalCompensation: 750,
        tips: 50,
        pickupBusinessName: 'Souvlaki Bar',
        delivery: {
          distance: 5,
          distanceUnit: EnumDistanceUnit.KILOMETERS,
          baseFee: 300,
          distanceFee: 450,
        },
        dropoffLocation: {
          street: 'Dimitriadis',
          houseNumber: '10',
          city: 'Volos',
        },
      })

      const pay = await repository.findDeliveryPay('del-pay-1')

      expect(pay).not.toBeNull()
      expect(pay!.id).toBe('del-pay-1')
      expect(pay!.pickupName).toBe('Souvlaki Bar')
      expect(pay!.totalCompensation).toBe(750)
      expect(pay!.tips).toBe(50)
      expect(pay!.baseFee).toBe(300)
      expect(pay!.distanceFee).toBe(450)
      expect(pay!.paidKm).toBe(5)
      expect(pay!.dropoffArea).toBe('Dimitriadis')

      // Not found case
      mockPrisma.delivery.findUnique.mockResolvedValue(null)
      const missing = await repository.findDeliveryPay('del-unknown')
      expect(missing).toBeNull()
    })

    test('findTimelineEvents returns timeline event rows without message or amount', async () => {
      const t = new Date('2026-11-20T10:00:00Z')
      mockPrisma.deliveryEvent.findMany.mockResolvedValue([
        {
          id: 'ev-1',
          deliveryId: 'del-tl',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          actor: EnumEventActor.COURIER,
          courierId: 'c-1',
          occurredAt: t,
          createdAt: t,
        },
      ])

      const events = await repository.findTimelineEvents('del-tl')

      expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledWith({
        where: {
          deliveryId: 'del-tl',
          transitionSuccessful: true,
        },
        select: {
          id: true,
          deliveryId: true,
          type: true,
          oldStatus: true,
          actor: true,
          courierId: true,
          occurredAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe(EnumDeliveryEventType.ACCEPTED)
      expect((events[0] as any).message).toBeUndefined()
    })
  })
})
