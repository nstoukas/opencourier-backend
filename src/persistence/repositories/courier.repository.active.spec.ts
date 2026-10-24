import { CourierRepository, busyCourierDeliverySubQuery } from './courier.repository'
import { PrismaService } from '../../services/prisma/prisma.service'
import { DELIVERY_ONGOING_STATUSES } from '../../shared-types/stateMachine'
import { CourierEntity } from '../../domains/courier/entities/courier.entity'
import {
  EnumCourierDeliverySetting,
  EnumCourierStatus,
  EnumDeliveryStatus,
  EnumStripeAccountStatus,
  Prisma,
} from '@prisma/types'

describe('CourierRepository - busy riders matching (scope row 62)', () => {
  let repository: CourierRepository
  let mockPrisma: {
    $queryRaw: jest.Mock
    courier: {
      findUniqueOrThrow: jest.Mock
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
    EnumDeliveryStatus.ASSIGNING_COURIER,
  ]

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn(),
      courier: {
        findUniqueOrThrow: jest.fn(),
      },
    }

    repository = new CourierRepository(mockPrisma as unknown as PrismaService)
  })

  describe('busyCourierDeliverySubQuery', () => {
    test('carries exactly the six active ongoing delivery statuses in its parameter values', () => {
      const subQuery = busyCourierDeliverySubQuery()

      // Must be a Prisma.Sql object with sql, values, and strings
      expect(subQuery).toBeDefined()
      expect(typeof subQuery.sql).toBe('string')
      expect(Array.isArray(subQuery.values)).toBe(true)
      expect(Array.isArray(subQuery.strings)).toBe(true)

      // SQL text must correlate Delivery with Courier and check status IN (...)
      expect(subQuery.sql).toContain('"Delivery"."courierId" = "Courier"."id"')
      expect(subQuery.sql).toContain('"Delivery"."status"::text IN')

      // Values must contain every active status
      for (const status of ACTIVE_DELIVERY_STATUSES) {
        expect(subQuery.values).toContain(status)
      }

      // Values must not contain any finished, cancelled, or pre-assignment status
      for (const status of NON_BUSY_DELIVERY_STATUSES) {
        expect(subQuery.values).not.toContain(status)
      }

      // Values must match DELIVERY_ONGOING_STATUSES exactly
      expect(subQuery.values).toEqual(DELIVERY_ONGOING_STATUSES)
      expect(subQuery.values).toHaveLength(6)
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
            coordinates: [39.362, 22.951],
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

      // AC-1: Every active status must be in query values so busy riders get no second offer
      for (const activeStatus of ACTIVE_DELIVERY_STATUSES) {
        expect(querySql.values).toContain(activeStatus)
      }

      // AC-2: Finished/cancelled deliveries (and CREATED/ASSIGNING_COURIER) must not be excluded
      for (const nonBusyStatus of NON_BUSY_DELIVERY_STATUSES) {
        expect(querySql.values).not.toContain(nonBusyStatus)
      }

      // AC-3 & AC-4: Filter statuses in the query must match DELIVERY_ONGOING_STATUSES exactly
      const queryDeliveryStatuses = querySql.values.filter((v): v is EnumDeliveryStatus =>
        Object.values(EnumDeliveryStatus).includes(v as EnumDeliveryStatus)
      )
      expect(queryDeliveryStatuses.sort()).toEqual([...DELIVERY_ONGOING_STATUSES].sort())
      expect(queryDeliveryStatuses).toHaveLength(DELIVERY_ONGOING_STATUSES.length)

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
            coordinates: [39.365, 22.955],
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

      // AC-1: Every active status must be in query values so busy riders get no second offer
      for (const activeStatus of ACTIVE_DELIVERY_STATUSES) {
        expect(querySql.values).toContain(activeStatus)
      }

      // AC-2: Finished/cancelled deliveries (and CREATED/ASSIGNING_COURIER) must not be excluded
      for (const nonBusyStatus of NON_BUSY_DELIVERY_STATUSES) {
        expect(querySql.values).not.toContain(nonBusyStatus)
      }

      // AC-3 & AC-4: Filter statuses in the query must match DELIVERY_ONGOING_STATUSES exactly
      const queryDeliveryStatuses = querySql.values.filter((v): v is EnumDeliveryStatus =>
        Object.values(EnumDeliveryStatus).includes(v as EnumDeliveryStatus)
      )
      expect(queryDeliveryStatuses.sort()).toEqual([...DELIVERY_ONGOING_STATUSES].sort())
      expect(queryDeliveryStatuses).toHaveLength(DELIVERY_ONGOING_STATUSES.length)

      // Happy path: returns courier domain entity with distance and locations
      expect(result).not.toBeNull()
      expect(result?.courier).toBeInstanceOf(CourierEntity)
      expect(result?.courier.id).toBe('courier-volos-1')
      expect(result?.distance).toBe(2100.0)
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

      // Still contains all active statuses in the subquery
      for (const activeStatus of ACTIVE_DELIVERY_STATUSES) {
        expect(querySql.values).toContain(activeStatus)
      }
    })
  })
})
