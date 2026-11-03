import { Logger } from '@nestjs/common'
import { CourierRepository, activeSosCourierSubQuery, busyCourierDeliverySubQuery } from './courier.repository'
import { PrismaService } from '../../services/prisma/prisma.service'
import { DELIVERY_ONGOING_STATUSES } from '../../shared-types/stateMachine'
import { ACTIVE_SOS_WHERE } from 'src/domains/sos/sos-incident-state'
import { CourierEntity } from '../../domains/courier/entities/courier.entity'
import {
  EnumCourierDeliverySetting,
  EnumCourierStatus,
  EnumDeliveryStatus,
  EnumStripeAccountStatus,
  EnumUserRole,
  Prisma,
} from '@prisma/types'

describe('CourierRepository - busy riders matching (scope row 62)', () => {
  let repository: CourierRepository
  let mockPrisma: {
    $queryRaw: jest.Mock
    user: {
      create: jest.Mock
    }
    courier: {
      findUnique: jest.Mock
      findUniqueOrThrow: jest.Mock
      findMany: jest.Mock
      count: jest.Mock
    }
    sosIncident: {
      findFirst: jest.Mock
    }
  }

  // Sample courier row returned by prisma.courier.findUniqueOrThrow
  const sampleCourierRecord = {
    id: 'courier-volos-1',
    node_uri: null,
    firstName: 'Nikos',
    lastName: 'Rider',
    phoneNumber: '+306900000000',
    status: EnumCourierStatus.ONLINE,
    deliverySetting: EnumCourierDeliverySetting.AUTO_ACCEPT,
    rejectedOffers: [],
    stripeAccountId: null,
    stripeAccountStatus: EnumStripeAccountStatus.COMPLETE,
    userId: 'user-volos-1',
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-01T10:00:00Z'),
  }

  // Active delivery statuses that must make a rider busy (no second offer)
  const ACTIVE_DELIVERY_STATUSES: EnumDeliveryStatus[] = [
    EnumDeliveryStatus.ACCEPTED,
    EnumDeliveryStatus.DISPATCHED,
    EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
    EnumDeliveryStatus.PICKED_UP,
    EnumDeliveryStatus.ON_THE_WAY,
    EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
  ]

  // Inactive / finished / cancelled statuses that must NOT make a rider busy
  const NON_BUSY_DELIVERY_STATUSES: EnumDeliveryStatus[] = [
    EnumDeliveryStatus.DROPPED_OFF,
    EnumDeliveryStatus.CANCELED,
    EnumDeliveryStatus.FAILED,
    EnumDeliveryStatus.CREATED,
  ]

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn(),
      user: {
        create: jest.fn(),
      },
      courier: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([sampleCourierRecord]),
        count: jest.fn().mockResolvedValue(1),
      },
      sosIncident: {
        findFirst: jest.fn(),
      },
    }

    repository = new CourierRepository(mockPrisma as unknown as PrismaService)
  })

  describe('busyCourierDeliverySubQuery', () => {
    test('carries the six active ongoing delivery statuses and open offer clause in its parameter values', () => {
      const subQuery = busyCourierDeliverySubQuery()

      // Must be a Prisma.Sql object with sql, values, and strings
      expect(subQuery).toBeDefined()
      expect(typeof subQuery.sql).toBe('string')
      expect(Array.isArray(subQuery.values)).toBe(true)
      expect(Array.isArray(subQuery.strings)).toBe(true)

      // SQL text must correlate Delivery with Courier and check status IN (...)
      expect(subQuery.sql).toContain('"Delivery"."courierId" = "Courier"."id"')
      expect(subQuery.sql).toContain('"Delivery"."status"::text IN')
      // Open offer check: rider is busy if holding an open unanswered offer (scope row 61 review)
      expect(subQuery.sql).toContain('"Delivery"."matchedCourierId" = "Courier"."id"')
      expect(subQuery.sql).toContain('"Delivery"."courierId" IS NULL')
      expect(subQuery.sql).toContain('"Delivery"."status"::text =')

      // Values must contain every active status
      for (const status of ACTIVE_DELIVERY_STATUSES) {
        expect(subQuery.values).toContain(status)
      }
      expect(subQuery.values).toContain(EnumDeliveryStatus.ASSIGNING_COURIER)

      // Values must not contain any finished, cancelled, or pre-assignment status
      for (const status of NON_BUSY_DELIVERY_STATUSES) {
        expect(subQuery.values).not.toContain(status)
      }

      // Values must match DELIVERY_ONGOING_STATUSES + ASSIGNING_COURIER
      expect(subQuery.values).toEqual([...DELIVERY_ONGOING_STATUSES, EnumDeliveryStatus.ASSIGNING_COURIER])
      expect(subQuery.values).toHaveLength(7)
    })
  })

  describe('activeSosCourierSubQuery (Pins 1 & 7, Spec 0022 AC-7)', () => {
    test('correlates SosIncident with Courier.id and requires closedAt, safeAt, and falseAlarmAt all IS NULL', () => {
      const subQuery = activeSosCourierSubQuery()

      expect(subQuery).toBeDefined()
      expect(typeof subQuery.sql).toBe('string')
      expect(subQuery.sql).toContain('"SosIncident"."courierId" = "Courier"."id"')
      expect(subQuery.sql).toContain('"SosIncident"."closedAt" IS NULL')
      expect(subQuery.sql).toContain('"SosIncident"."safeAt" IS NULL')
      expect(subQuery.sql).toContain('"SosIncident"."falseAlarmAt" IS NULL')
    })
  })

  describe('findNearestAvailableCourier', () => {
    const defaultArgs = {
      location: { latitude: 39.36, longitude: 22.95 },
    }

    test('excludes couriers with an active delivery across ALL active statuses via NOT EXISTS subquery', async () => {
      // Mock raw query returning one matching courier
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 'courier-volos-1',
          distance: 1250.5,
          currentLocation: JSON.stringify({
            type: 'Point',
            // GeoJSON order, as PostGIS returns it: [longitude, latitude] (Volos)
            coordinates: [22.951, 39.362],
          }),
        },
      ])
      mockPrisma.courier.findUniqueOrThrow.mockResolvedValue(sampleCourierRecord)

      const result = await repository.findNearestAvailableCourier(defaultArgs)

      // Verify $queryRaw was called with a Prisma.Sql object
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
      const querySql: Prisma.Sql = mockPrisma.$queryRaw.mock.calls[0][0]
      expect(querySql).toBeDefined()
      expect(typeof querySql.sql).toBe('string')
      expect(Array.isArray(querySql.values)).toBe(true)

      // Verify the query checks NOT EXISTS for ongoing deliveries using the shared subquery
      const sharedSubQuery = busyCourierDeliverySubQuery()
      expect(querySql.sql).toContain('NOT EXISTS')
      expect(querySql.sql).toContain(sharedSubQuery.sql)

      // Verify the query checks NOT EXISTS for active SOS (Pin 7, Spec 0022 AC-7)
      const sosSubQuery = activeSosCourierSubQuery()
      expect(querySql.sql).toContain(sosSubQuery.sql)

      // AC-1: Every active status must be in query values so busy riders get no second offer
      for (const activeStatus of ACTIVE_DELIVERY_STATUSES) {
        expect(querySql.values).toContain(activeStatus)
      }
      expect(querySql.values).toContain(EnumDeliveryStatus.ASSIGNING_COURIER)

      // AC-2: Finished/cancelled deliveries (and CREATED) must not be excluded
      for (const nonBusyStatus of NON_BUSY_DELIVERY_STATUSES) {
        expect(querySql.values).not.toContain(nonBusyStatus)
      }

      // AC-3 & AC-4: Filter statuses in the query must match DELIVERY_ONGOING_STATUSES + ASSIGNING_COURIER
      const queryDeliveryStatuses = querySql.values.filter((v): v is EnumDeliveryStatus =>
        Object.values(EnumDeliveryStatus).includes(v as EnumDeliveryStatus)
      )
      expect(queryDeliveryStatuses.sort()).toEqual([...DELIVERY_ONGOING_STATUSES, EnumDeliveryStatus.ASSIGNING_COURIER].sort())
      expect(queryDeliveryStatuses).toHaveLength(DELIVERY_ONGOING_STATUSES.length + 1)

      // Happy path: returns courier domain entity with distance and locations
      expect(result).not.toBeNull()
      expect(result?.courier).toBeInstanceOf(CourierEntity)
      expect(result?.courier.id).toBe('courier-volos-1')
      expect(result?.distance).toBe(1250.5)
      expect(result?.courierLocation).toEqual({ latitude: 39.362, longitude: 22.951 })
      expect(result?.pickupLocation).toEqual({ latitude: 39.36, longitude: 22.95 })
    })

    test('returns null when no courier is available (all busy or out of range)', async () => {
      // Mock empty result from database
      mockPrisma.$queryRaw.mockResolvedValue([])

      const result = await repository.findNearestAvailableCourier(defaultArgs)

      expect(result).toBeNull()
      // findUniqueOrThrow should not be called when no courier matches
      expect(mockPrisma.courier.findUniqueOrThrow).not.toHaveBeenCalled()
    })

    test('supports optional excludeCourierIds and maxDistanceInKM while preserving busy exclusion', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([])

      await repository.findNearestAvailableCourier({
        ...defaultArgs,
        excludeCourierIds: ['courier-volos-99'],
        maxDistanceInKM: 5,
      })

      const querySql: Prisma.Sql = mockPrisma.$queryRaw.mock.calls[0][0]
      expect(querySql.sql).toContain('"id" NOT IN')
      expect(querySql.values).toContain('courier-volos-99')

      // maxDistanceInKM: 5 reaches the query as 5000 metres
      expect(querySql.values).toContain(5000)

      // Still contains all active statuses in the subquery
      for (const activeStatus of ACTIVE_DELIVERY_STATUSES) {
        expect(querySql.values).toContain(activeStatus)
      }
    })
  })

  describe('findMostSeniorAvailableCourier', () => {
    const defaultArgs = {
      location: { latitude: 39.36, longitude: 22.95 },
    }

    test('excludes couriers with an active delivery across ALL active statuses via NOT EXISTS subquery', async () => {
      // Mock raw query returning one matching courier ordered by seniority
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 'courier-volos-1',
          distance: 2100.0,
          currentLocation: JSON.stringify({
            type: 'Point',
            // GeoJSON order, as PostGIS returns it: [longitude, latitude] (Volos)
            coordinates: [22.955, 39.365],
          }),
        },
      ])
      mockPrisma.courier.findUniqueOrThrow.mockResolvedValue(sampleCourierRecord)

      const result = await repository.findMostSeniorAvailableCourier(defaultArgs)

      // Verify $queryRaw was called with a Prisma.Sql object
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
      const querySql: Prisma.Sql = mockPrisma.$queryRaw.mock.calls[0][0]
      expect(querySql).toBeDefined()
      expect(typeof querySql.sql).toBe('string')
      expect(Array.isArray(querySql.values)).toBe(true)

      // Verify the query orders by seniority and checks NOT EXISTS for ongoing deliveries using the shared subquery
      const sharedSubQuery = busyCourierDeliverySubQuery()
      expect(querySql.sql).toContain('ORDER BY seniority ASC')
      expect(querySql.sql).toContain('NOT EXISTS')
      expect(querySql.sql).toContain(sharedSubQuery.sql)

      // Verify the query checks NOT EXISTS for active SOS (Pin 7, Spec 0022 AC-7)
      const sosSubQuery = activeSosCourierSubQuery()
      expect(querySql.sql).toContain(sosSubQuery.sql)

      // AC-1: Every active status must be in query values so busy riders get no second offer
      for (const activeStatus of ACTIVE_DELIVERY_STATUSES) {
        expect(querySql.values).toContain(activeStatus)
      }
      expect(querySql.values).toContain(EnumDeliveryStatus.ASSIGNING_COURIER)

      // AC-2: Finished/cancelled deliveries (and CREATED) must not be excluded
      for (const nonBusyStatus of NON_BUSY_DELIVERY_STATUSES) {
        expect(querySql.values).not.toContain(nonBusyStatus)
      }

      // AC-3 & AC-4: Filter statuses in the query must match DELIVERY_ONGOING_STATUSES + ASSIGNING_COURIER
      const queryDeliveryStatuses = querySql.values.filter((v): v is EnumDeliveryStatus =>
        Object.values(EnumDeliveryStatus).includes(v as EnumDeliveryStatus)
      )
      expect(queryDeliveryStatuses.sort()).toEqual([...DELIVERY_ONGOING_STATUSES, EnumDeliveryStatus.ASSIGNING_COURIER].sort())
      expect(queryDeliveryStatuses).toHaveLength(DELIVERY_ONGOING_STATUSES.length + 1)

      // Happy path: returns courier domain entity with distance and locations
      expect(result).not.toBeNull()
      expect(result?.courier).toBeInstanceOf(CourierEntity)
      expect(result?.courier.id).toBe('courier-volos-1')
      expect(result?.distance).toBe(2100.0)
      expect(result?.courierLocation).toEqual({ latitude: 39.365, longitude: 22.955 })
      expect(result?.pickupLocation).toEqual({ latitude: 39.36, longitude: 22.95 })
    })

    test('returns null when no senior courier is available (all busy or out of range)', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([])

      const result = await repository.findMostSeniorAvailableCourier(defaultArgs)

      expect(result).toBeNull()
      expect(mockPrisma.courier.findUniqueOrThrow).not.toHaveBeenCalled()
    })

    test('supports optional excludeCourierIds and maxDistanceInKM while preserving busy exclusion', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([])

      await repository.findMostSeniorAvailableCourier({
        ...defaultArgs,
        excludeCourierIds: ['courier-volos-88'],
        maxDistanceInKM: 10,
      })

      const querySql: Prisma.Sql = mockPrisma.$queryRaw.mock.calls[0][0]
      expect(querySql.sql).toContain('"id" NOT IN')
      expect(querySql.values).toContain('courier-volos-88')

      // maxDistanceInKM: 10 reaches the query as 10000 metres
      expect(querySql.values).toContain(10000)

      // Still contains all active statuses in the subquery
      for (const activeStatus of ACTIVE_DELIVERY_STATUSES) {
        expect(querySql.values).toContain(activeStatus)
      }
    })
  })

  describe('findManyPaginated (scope row 97, Clause 3)', () => {
    test('passes where and orderBy createdAt desc to prisma.courier.findMany via paginator', async () => {
      const where: Prisma.CourierWhereInput = {
        status: { in: [EnumCourierStatus.ONLINE, EnumCourierStatus.LAST_CALL] },
      }

      const result = await repository.findManyPaginated(where, 1, 10)

      expect(mockPrisma.courier.findMany).toHaveBeenCalledTimes(1)
      expect(mockPrisma.courier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where,
          orderBy: { createdAt: 'desc' },
          take: 10,
          skip: 0,
        })
      )
      expect(mockPrisma.courier.count).toHaveBeenCalledTimes(1)
      expect(mockPrisma.courier.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where,
        })
      )
      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toBeInstanceOf(CourierEntity)
      expect(result.data[0]?.id).toBe('courier-volos-1')
      expect(result.pagination?.currentPage).toBe(1)
      expect(result.pagination?.totalItems).toBe(1)
    })

    test('Clause 3: fails if where is dropped in the repository on the way to prisma.courier', async () => {
      const where: Prisma.CourierWhereInput = {
        status: EnumCourierStatus.OFFLINE,
        AND: [
          {
            OR: [
              { firstName: { contains: 'Giorgos', mode: Prisma.QueryMode.insensitive } },
            ],
          },
        ],
      }

      await repository.findManyPaginated(where, 2, 15)

      expect(mockPrisma.courier.findMany).toHaveBeenCalledTimes(1)
      const findManyCall = mockPrisma.courier.findMany.mock.calls[0][0]
      expect(findManyCall).toHaveProperty('where')
      expect(findManyCall.where).toBe(where)
      expect(findManyCall.where).toEqual(where)

      const countCall = mockPrisma.courier.count.mock.calls[0][0]
      expect(countCall).toHaveProperty('where')
      expect(countCall.where).toBe(where)
    })
  })

  describe('createWithLogin (Spec 0013 AC-1 nested write)', () => {
    test('creates User with COURIER role, email, password and nested Courier with names and phone', async () => {
      ;(mockPrisma as any).user.create.mockResolvedValue({
        id: 'user-new',
        email: 'kostas@coop.gr',
        courier: sampleCourierRecord,
      })

      const result = await repository.createWithLogin({
        firstName: 'Nikos',
        lastName: 'Rider',
        phoneNumber: '+306900000000',
        login: {
          email: 'kostas@coop.gr',
          hashedPassword: 'hashed!password',
        },
      })

      expect((mockPrisma as any).user.create).toHaveBeenCalledWith({
        data: {
          email: 'kostas@coop.gr',
          password: 'hashed!password',
          role: [EnumUserRole.COURIER],
          courier: {
            create: {
              firstName: 'Nikos',
              lastName: 'Rider',
              phoneNumber: '+306900000000',
            },
          },
        },
        include: { courier: true },
      })
      expect(result).toBeInstanceOf(CourierEntity)
      expect(result.id).toBe('courier-volos-1')
    })

    test('throws InternalServerError if user created without courier relation', async () => {
      ;(mockPrisma as any).user.create.mockResolvedValue({
        id: 'user-new',
        email: 'kostas@coop.gr',
        courier: null,
      })

      await expect(
        repository.createWithLogin({
          firstName: 'Nikos',
          lastName: 'Rider',
          phoneNumber: '+306900000000',
          login: {
            email: 'kostas@coop.gr',
            hashedPassword: 'hashed!password',
          },
        })
      ).rejects.toThrow()
    })
  })

  describe('findByPhoneNumber', () => {
    test('returns CourierEntity when courier with phoneNumber exists', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(sampleCourierRecord)

      const result = await repository.findByPhoneNumber('+306900000000')

      expect(mockPrisma.courier.findUnique).toHaveBeenCalledWith({
        where: { phoneNumber: '+306900000000' },
      })
      expect(result).toBeInstanceOf(CourierEntity)
      expect(result?.phoneNumber).toBe('+306900000000')
    })

    test('returns null when no courier has phoneNumber', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(null)

      const result = await repository.findByPhoneNumber('+306999999999')

      expect(result).toBeNull()
    })
  })

  describe('hasActiveSos (Pin 7, Spec 0022 AC-7)', () => {
    test('queries sosIncident.findFirst with courierId and ACTIVE_SOS_WHERE', async () => {
      mockPrisma.sosIncident.findFirst.mockResolvedValueOnce({ id: 'sos-active-1' })

      const result = await repository.hasActiveSos('courier-1')

      expect(result).toBe(true)
      expect(mockPrisma.sosIncident.findFirst).toHaveBeenCalledWith({
        where: { courierId: 'courier-1', ...ACTIVE_SOS_WHERE },
        select: { id: true },
      })
    })

    test('returns false when findFirst returns null', async () => {
      mockPrisma.sosIncident.findFirst.mockResolvedValueOnce(null)

      const result = await repository.hasActiveSos('courier-2')

      expect(result).toBe(false)
      expect(mockPrisma.sosIncident.findFirst).toHaveBeenCalledWith({
        where: { courierId: 'courier-2', ...ACTIVE_SOS_WHERE },
        select: { id: true },
      })
    })
  })

  // Row 100 review: the offer push reads the rider's location on every offer, and a rider whose app
  // never sent one has a NULL column. That is "unknown" (null), not an error worth a log line.
  describe('getCurrentLocation (row 100 review)', () => {
    let loggerError: jest.SpyInstance
    let loggerWarn: jest.SpyInstance
    let consoleLog: jest.SpyInstance
    let consoleError: jest.SpyInstance

    beforeEach(() => {
      loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      loggerWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined)
      consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    test('a courier with no stored location (the row has currentLocation null): null, and nothing logged', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ currentLocation: null }])

      const result = await repository.getCurrentLocation('courier-never-sent')

      expect(result).toBeNull()
      expect(loggerError).not.toHaveBeenCalled()
      expect(loggerWarn).not.toHaveBeenCalled()
      expect(consoleLog).not.toHaveBeenCalled()
      expect(consoleError).not.toHaveBeenCalled()
    })

    test('no courier row at all: null, and nothing logged', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([])

      const result = await repository.getCurrentLocation('courier-unknown')

      expect(result).toBeNull()
      expect(loggerError).not.toHaveBeenCalled()
      expect(consoleLog).not.toHaveBeenCalled()
    })

    test('a stored location: the GeoJSON point read as latitude and longitude', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ currentLocation: '{"type":"Point","coordinates":[22.9411,39.3622]}' }])

      const result = await repository.getCurrentLocation('courier-volos-1')

      expect(result).toEqual({ latitude: 39.3622, longitude: 22.9411 })
      expect(loggerError).not.toHaveBeenCalled()
    })
  })
})
