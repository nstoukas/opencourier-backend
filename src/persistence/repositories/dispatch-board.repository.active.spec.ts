import { EnumCourierStatus, EnumDeliveryStatus, Prisma } from '@prisma/types'
import { DISPATCH_MAP_POSITION_MAX_AGE_MINUTES } from 'src/constants'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { DispatchBoardRepository } from './dispatch-board.repository'

describe('DispatchBoardRepository (spec 0034)', () => {
  let repository: DispatchBoardRepository
  let mockPrisma: {
    delivery: { findMany: jest.Mock }
    deliveryEvent: { findMany: jest.Mock }
    $queryRaw: jest.Mock
  }

  beforeEach(() => {
    mockPrisma = {
      delivery: { findMany: jest.fn() },
      deliveryEvent: { findMany: jest.fn() },
      $queryRaw: jest.fn(),
    }
    repository = new DispatchBoardRepository(mockPrisma as unknown as PrismaService)
  })

  describe('findLiveDeliveries', () => {
    test('queries ASSIGNING_COURIER plus all ongoing statuses with LIVE_DELIVERY_SELECT', async () => {
      const mockResult = [{ id: 'del-1', status: EnumDeliveryStatus.ASSIGNING_COURIER }]
      mockPrisma.delivery.findMany.mockResolvedValue(mockResult)

      const result = await repository.findLiveDeliveries()

      expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: [EnumDeliveryStatus.ASSIGNING_COURIER, ...DELIVERY_ONGOING_STATUSES] },
        },
        select: expect.objectContaining({
          id: true,
          status: true,
          courierId: true,
          matchedCourierId: true,
          offeredAt: true,
          offerExpiresAt: true,
          orderReference: true,
          pickupBusinessName: true,
          dropoffName: true,
          dropoffBusinessName: true,
          createdAt: true,
          readyAt: true,
          foodReadyAt: true,
          promisedReadyAt: true,
          undispatchedAt: true,
          pickupLocation: { select: { latitude: true, longitude: true } },
          courier: { select: { firstName: true, lastName: true } },
        }),
      })
      expect(result).toBe(mockResult)
    })
  })

  describe('findDroppedOffBetween (AC-2)', () => {
    test('queries DROPPED_OFF events distinct by deliveryId and maps createdAt from delivery relation', async () => {
      const start = new Date('2026-11-08T22:00:00.000Z')
      const end = new Date('2026-11-09T22:00:00.000Z')
      const mockEvents = [
        {
          deliveryId: 'del-1',
          occurredAt: new Date('2026-11-09T10:30:00.000Z'),
          delivery: { createdAt: new Date('2026-11-09T10:00:00.000Z') },
        },
      ]
      mockPrisma.deliveryEvent.findMany.mockResolvedValue(mockEvents)

      const result = await repository.findDroppedOffBetween(start, end)

      expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledWith({
        where: {
          newStatus: EnumDeliveryStatus.DROPPED_OFF,
          transitionSuccessful: true,
          occurredAt: { gte: start, lt: end },
        },
        distinct: ['deliveryId'],
        select: {
          deliveryId: true,
          occurredAt: true,
          delivery: { select: { createdAt: true } },
        },
      })
      expect(result).toEqual([
        {
          deliveryId: 'del-1',
          occurredAt: new Date('2026-11-09T10:30:00.000Z'),
          createdAt: new Date('2026-11-09T10:00:00.000Z'),
        },
      ])
    })
  })

  describe('findWorkingCouriers (AC-11, AC-12 freshness in SQL)', () => {
    test('builds SQL querying only ONLINE and LAST_CALL, with freshness interval and ST_X / ST_Y coordinates', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 'courier-1',
          name: 'Nikos Papastamou',
          status: 'ONLINE',
          busy: true,
          latitude: 39.362,
          longitude: 22.942,
        },
      ])

      const result = await repository.findWorkingCouriers()

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
      const sqlObj = mockPrisma.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql
      // SQL text reconstruction from Prisma.sql
      const sqlText = sqlObj.strings.join(' ? ')

      // 1. Freshness rule: checks currentLocation is not null and currentLocationAt within max age
      expect(sqlText).toContain('"currentLocation" IS NOT NULL')
      expect(sqlText).toContain('"currentLocationAt" >= (NOW() AT TIME ZONE \'UTC\') - make_interval(mins =>')
      expect(sqlText).toContain('::int)')
      // Verify DISPATCH_MAP_POSITION_MAX_AGE_MINUTES value (5 minutes) is passed in SQL values
      expect(sqlObj.values).toContain(DISPATCH_MAP_POSITION_MAX_AGE_MINUTES)
      expect(DISPATCH_MAP_POSITION_MAX_AGE_MINUTES).toBe(5)

      // 2. Only ONLINE and LAST_CALL couriers are queried; OFFLINE couriers are never queried
      expect(sqlText).toContain('WHERE "Courier"."status"::text IN (')
      expect(sqlObj.values).toContain(EnumCourierStatus.ONLINE)
      expect(sqlObj.values).toContain(EnumCourierStatus.LAST_CALL)
      expect(sqlObj.values).not.toContain(EnumCourierStatus.OFFLINE)

      // 3. Busy matcher subquery is embedded
      expect(sqlText).toContain('EXISTS (')

      // 4. Spatial extractors ST_X and ST_Y
      expect(sqlText).toContain('ST_Y("currentLocation")')
      expect(sqlText).toContain('ST_X("currentLocation")')

      // Note on what a unit test mock cannot prove:
      // The mock asserts the exact SQL template string and bound parameters, but only a live PostgreSQL/PostGIS database
      // can prove that `ST_X`, `ST_Y`, and `make_interval(mins => 5::int)` execute successfully against PostGIS geometry.
      expect(result).toHaveLength(1)
      expect(result[0]?.id).toBe('courier-1')
      expect(result[0]?.busy).toBe(true)
      expect(result[0]?.latitude).toBe(39.362)
      expect(result[0]?.longitude).toBe(22.942)
    })

    test('preserves null latitude and longitude when database returns null for stale or missing positions', async () => {
      // When CASE WHEN condition fails in DB (e.g. position is 6 minutes old or null), DB returns null
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 'courier-stale',
          name: 'Elena Rider',
          status: 'ONLINE',
          busy: false,
          latitude: null,
          longitude: null,
        },
      ])

      const result = await repository.findWorkingCouriers()

      expect(result[0]?.latitude).toBeNull()
      expect(result[0]?.longitude).toBeNull()
    })
  })
})
