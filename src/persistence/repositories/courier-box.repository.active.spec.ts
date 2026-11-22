import { Prisma } from '@prisma/types'
import {
  CourierRepository,
  heldBoxDeliveriesWhere,
  heldBoxUnitsSql,
  liveDeliveriesWhere,
  liveDeliveryCountSql,
  boxRoomCondition,
  RETURN_TRIP_HELD_HOURS,
} from './courier.repository'
import { DeliveryRepository } from './delivery.repository'
import { PrismaService } from 'src/services/prisma/prisma.service'
import { DeliveryMatchingService } from 'src/services/delivery-matching/delivery-matching.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { BOX_HELD_STATUSES, RIDER_BOX_UNITS } from 'src/domains/delivery/box'
import { DELIVERY_PICKED_UP_STATUSES } from 'src/shared-types/stateMachine'
import { EnumDeliveryEventType, EnumDeliveryStatus } from 'src/shared-types'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'

/**
 * Spec 0043 (Row 9) - Box Model Matcher & Offer Claim Capacity (AC-5)
 */
describe('Box Model: Matcher & Offer Claim Capacity (AC-5)', () => {
  describe('heldBoxDeliveriesWhere & heldBoxUnitsSql predicate text', () => {
    const riderSql = Prisma.sql`'courier-volos-1'`

    test('heldBoxDeliveriesWhere contains the 6 ongoing statuses, open offer, and return trip conditions', () => {
      const whereSql = heldBoxDeliveriesWhere(riderSql)

      expect(whereSql).toBeDefined()
      expect(typeof whereSql.sql).toBe('string')

      // 1. Ongoing deliveries held by the courier
      expect(whereSql.sql).toContain('"Delivery"."courierId" =')
      expect(whereSql.sql).toContain('"Delivery"."status"::text IN')

      // Verify all 6 ongoing statuses are present in values
      for (const status of BOX_HELD_STATUSES) {
        expect(whereSql.values).toContain(status)
      }
      expect(BOX_HELD_STATUSES).toEqual([
        EnumDeliveryStatus.ACCEPTED,
        EnumDeliveryStatus.DISPATCHED,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        EnumDeliveryStatus.PICKED_UP,
        EnumDeliveryStatus.ON_THE_WAY,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      ])

      // 2. Open offer: matchedCourierId, courierId null, ASSIGNING_COURIER
      expect(whereSql.sql).toContain('"Delivery"."matchedCourierId" =')
      expect(whereSql.sql).toContain('"Delivery"."courierId" IS NULL')
      expect(whereSql.sql).toContain('"Delivery"."status"::text =')
      expect(whereSql.values).toContain(EnumDeliveryStatus.ASSIGNING_COURIER)

      // 3. Return trip: CANCELED from picked-up status, foodOutcome null, within 24h with ::int cast
      expect(whereSql.sql).toContain('"Delivery"."cancelledFromStatus"::text IN')
      for (const pickedUpStatus of DELIVERY_PICKED_UP_STATUSES) {
        expect(whereSql.values).toContain(pickedUpStatus)
      }
      expect(whereSql.sql).toContain('"Delivery"."foodOutcome" IS NULL')
      expect(whereSql.sql).toContain(`make_interval(hours =>`)
      expect(whereSql.sql).toContain(`::int)`)
      expect(whereSql.values).toContain(RETURN_TRIP_HELD_HOURS)
      expect(RETURN_TRIP_HELD_HOURS).toBe(24)
    })

    test('open offer branch counts a delivery whose courierId is the rider while status is ASSIGNING_COURIER (the accept window)', () => {
      const boundRider = Prisma.sql`${'courier-volos-1'}`
      const whereSql = heldBoxDeliveriesWhere(boundRider)
      expect(whereSql.sql).toContain('("Delivery"."courierId" IS NULL OR "Delivery"."courierId" =')
      expect(whereSql.values).toContain('courier-volos-1')
      expect(whereSql.values).toContain(EnumDeliveryStatus.ASSIGNING_COURIER)
    })

    test('return trip branch counts status FAILED as well as CANCELED', () => {
      const whereSql = heldBoxDeliveriesWhere(riderSql)
      expect(whereSql.sql).toContain('"Delivery"."status"::text IN')
      expect(whereSql.values).toContain(EnumDeliveryStatus.CANCELED)
      expect(whereSql.values).toContain(EnumDeliveryStatus.FAILED)
    })

    test('heldBoxUnitsSql sums boxUnits with COALESCE to 0 and casts to ::int', () => {
      const unitsSql = heldBoxUnitsSql(riderSql)

      expect(unitsSql).toBeDefined()
      expect(typeof unitsSql.sql).toBe('string')
      expect(unitsSql.sql).toContain('SELECT COALESCE(SUM("Delivery"."boxUnits"), 0)::int FROM "Delivery" WHERE')
      expect(unitsSql.sql).toContain('"Delivery"."courierId" =')
      expect(unitsSql.sql).toContain('"Delivery"."matchedCourierId" =')
    })

    test('liveDeliveriesWhere contains ongoing statuses and open offer, omitting return trips (review of row 80, major)', () => {
      const liveSql = liveDeliveriesWhere(riderSql)

      expect(liveSql).toBeDefined()
      expect(typeof liveSql.sql).toBe('string')
      expect(liveSql.sql).toContain('"Delivery"."courierId" =')
      expect(liveSql.sql).toContain('"Delivery"."status"::text IN')
      expect(liveSql.sql).toContain('"Delivery"."matchedCourierId" =')
      // agy review of row 80: must match taken offers in accept window as well as open unassigned offers
      expect(liveSql.sql).toContain('("Delivery"."courierId" IS NULL OR "Delivery"."courierId" =')
      expect(liveSql.sql).toContain('"Delivery"."status"::text =')

      // Food being taken back (cancelled with null foodOutcome) is NOT in liveDeliveriesWhere
      expect(liveSql.sql).not.toContain('cancelledFromStatus')
      expect(liveSql.sql).not.toContain('foodOutcome')
    })

    test('liveDeliveriesWhere counts a taken offer in ASSIGNING_COURIER when courierId matches rider (the accept window, agy review of row 80, critical)', () => {
      // During an accept, courierId is written while status is still ASSIGNING_COURIER.
      // The second clause must match this row so the rider is not seen as free and cannot be given a third delivery.
      const boundRider = Prisma.sql`${'courier-volos-1'}`
      const liveSql = liveDeliveriesWhere(boundRider)

      expect(liveSql.sql).toContain('("Delivery"."courierId" IS NULL OR "Delivery"."courierId" =')
      // Bound rider appears in 3 places: ongoing courierId, matchedCourierId, and taken courierId
      const riderOccurrences = liveSql.values.filter((v) => v === 'courier-volos-1')
      expect(riderOccurrences).toHaveLength(3)
      expect(liveSql.values).toContain(EnumDeliveryStatus.ASSIGNING_COURIER)
    })

    test('liveDeliveryCountSql counts live deliveries and excludes exceptDeliveryId', () => {
      const countSql = liveDeliveryCountSql(riderSql, 'del-exclude-1')
      expect(countSql.sql).toContain('SELECT COUNT(*)::int FROM "Delivery" WHERE')
      expect(countSql.sql).toContain('"Delivery"."id" <>')
      expect(countSql.values).toContain('del-exclude-1')
    })

    test('liveDeliveryCountSql embeds the taken offer clause and bound rider (review of row 80)', () => {
      const boundRider = Prisma.sql`${'courier-volos-1'}`
      const countSql = liveDeliveryCountSql(boundRider)

      expect(countSql.sql).toContain('SELECT COUNT(*)::int FROM "Delivery" WHERE')
      expect(countSql.sql).toContain('("Delivery"."courierId" IS NULL OR "Delivery"."courierId" =')
      expect(countSql.values.filter((v) => v === 'courier-volos-1')).toHaveLength(3)
    })
  })

  describe('boxRoomCondition helper', () => {
    test('returns Prisma.empty when deliveryUnits is undefined', () => {
      const cond = boxRoomCondition(undefined)
      expect(cond.sql).toBe('')
      expect(cond.values).toEqual([])
    })

    test('returns SQL comparing held box units + deliveryUnits <= 100 when deliveryUnits is given', () => {
      const cond = boxRoomCondition(50)
      expect(cond.sql).toContain('-- Room left in the box (spec 0043, AC-5)')
      expect(cond.sql).toContain('SELECT COALESCE(SUM("Delivery"."boxUnits"), 0)::int FROM "Delivery"')
      expect(cond.sql).toContain('"Courier"."id"')
      expect(cond.sql).toContain('<=')
      expect(cond.values).toContain(50)
      expect(cond.values).toContain(RIDER_BOX_UNITS)
      expect(RIDER_BOX_UNITS).toBe(100)
    })
  })

  describe('Matcher queries include room condition', () => {
    let mockPrisma: any
    let courierRepo: CourierRepository

    beforeEach(() => {
      mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        courier: {
          findUniqueOrThrow: jest.fn(),
        },
      }
      courierRepo = new CourierRepository(mockPrisma as unknown as PrismaService)
    })

    test('findNearestAvailableCourier includes boxRoomCondition when boxUnits is provided', async () => {
      await courierRepo.findNearestAvailableCourier({
        location: { latitude: 39.36, longitude: 22.95 },
        boxUnits: 40,
      })

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
      const querySql: Prisma.Sql = mockPrisma.$queryRaw.mock.calls[0][0]
      expect(querySql.sql).toContain('-- Room left in the box (spec 0043, AC-5)')
      expect(querySql.values).toContain(40)
      expect(querySql.values).toContain(100)
    })

    test('findNearestAvailableCourier omits boxRoomCondition when boxUnits is not provided', async () => {
      await courierRepo.findNearestAvailableCourier({
        location: { latitude: 39.36, longitude: 22.95 },
      })

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
      const querySql: Prisma.Sql = mockPrisma.$queryRaw.mock.calls[0][0]
      expect(querySql.sql).not.toContain('-- Room left in the box (spec 0043, AC-5)')
    })

    test('findMostSeniorAvailableCourier includes boxRoomCondition when boxUnits is provided', async () => {
      await courierRepo.findMostSeniorAvailableCourier({
        location: { latitude: 39.36, longitude: 22.95 },
        boxUnits: 60,
      })

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
      const querySql: Prisma.Sql = mockPrisma.$queryRaw.mock.calls[0][0]
      expect(querySql.sql).toContain('-- Room left in the box (spec 0043, AC-5)')
      expect(querySql.values).toContain(60)
      expect(querySql.values).toContain(100)
    })

    test('findMostSeniorAvailableCourier omits boxRoomCondition when boxUnits is not provided', async () => {
      await courierRepo.findMostSeniorAvailableCourier({
        location: { latitude: 39.36, longitude: 22.95 },
      })

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
      const querySql: Prisma.Sql = mockPrisma.$queryRaw.mock.calls[0][0]
      expect(querySql.sql).not.toContain('-- Room left in the box (spec 0043, AC-5)')
    })
  })

  describe('DeliveryMatchingService passes boxUnits to matcher input', () => {
    test('findCourierForDelivery passes delivery.boxUnits to courierMatcherService', async () => {
      const mockDeliveryRepository = {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'del-1',
          partnerId: 'partner-1',
          courierId: null,
          matchedCourierId: null,
          pickupLocationId: 'loc-pickup',
          dropoffLocationId: 'loc-dropoff',
          boxUnits: 50,
        }),
      }
      const mockLocationDomainService = {
        getByIdOrThrow: jest.fn().mockResolvedValue({ latitude: 39.36, longitude: 22.95 }),
      }
      const mockCourierMatcherService = {
        findCourierForDelivery: jest.fn().mockResolvedValue(null),
      }
      const mockCacheService = {
        getOrDefault: jest.fn().mockResolvedValue([]),
        getCourierSkipList: jest.fn().mockResolvedValue([]),
      }

      const service = new DeliveryMatchingService(
        {} as any, // courierDomainService
        mockLocationDomainService as any,
        mockCourierMatcherService as any,
        mockDeliveryRepository as any,
        mockCacheService as any
      )

      await service.findCourierForDelivery('del-1')

      expect(mockCourierMatcherService.findCourierForDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-1',
          boxUnits: 50,
        })
      )
    })
  })

  describe('DeliveryRepository.claimOfferWithinBox', () => {
    let mockPrisma: any
    let deliveryRepo: DeliveryRepository
    let mockTx: any

    beforeEach(() => {
      mockTx = {
        $queryRaw: jest.fn(),
        delivery: {
          findUnique: jest.fn(),
          updateMany: jest.fn(),
        },
      }

      mockPrisma = {
        $transaction: jest.fn((callback) => callback(mockTx)),
      }
      deliveryRepo = new DeliveryRepository(mockPrisma as unknown as PrismaService)
    })

    test('locks courier row FOR UPDATE before summing held units', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([{ id: 'courier-1' }])
        .mockResolvedValueOnce([{ exists: false }]) // sibling leg check
        .mockResolvedValueOnce([{ held: 0 }]) // held count check (spec 0048)
        .mockResolvedValueOnce([{ held: 20 }]) // held units sum
      mockTx.delivery.findUnique.mockResolvedValue({ boxUnits: 30 })
      mockTx.delivery.updateMany.mockResolvedValue({ count: 1 })

      const res = await deliveryRepo.claimOfferWithinBox(
        'del-1',
        'courier-1',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: 'courier-1' }
      )

      expect(res).toBe('CLAIMED')
      // 1st query must be FOR UPDATE lock
      const firstCall = mockTx.$queryRaw.mock.calls[0]
      const sqlStrings = Array.isArray(firstCall[0]) ? firstCall[0].join('') : firstCall[0]?.sql ?? ''
      // Spec 0051: the lock also reads whether the rider's account is deactivated.
      expect(sqlStrings).toContain('FROM "Courier" WHERE "id" =')
      expect(sqlStrings).toContain('("deactivatedAt" IS NOT NULL) AS "deactivated"')
      expect(sqlStrings).toContain('FOR UPDATE')
      expect(firstCall[1] ?? firstCall[0]?.values?.[0]).toBe('courier-1')
    })

    test('returns NOT_WAITING if delivery is not found', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([{ id: 'courier-1' }])
        .mockResolvedValueOnce([{ exists: false }])
        .mockResolvedValueOnce([{ held: 0 }])
      mockTx.delivery.findUnique.mockResolvedValue(null)

      const res = await deliveryRepo.claimOfferWithinBox(
        'del-missing',
        'courier-1',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        {}
      )

      expect(res).toBe('NOT_WAITING')
      expect(mockTx.delivery.updateMany).not.toHaveBeenCalled()
    })

    test('returns BOX_FULL without updating when held + units > 100', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([{ id: 'courier-1' }])
        .mockResolvedValueOnce([{ exists: false }])
        .mockResolvedValueOnce([{ held: 0 }])
        .mockResolvedValueOnce([{ held: 60 }]) // Courier already holds 60 units
      mockTx.delivery.findUnique.mockResolvedValue({ boxUnits: 50 }) // 60 + 50 = 110 > 100

      const res = await deliveryRepo.claimOfferWithinBox(
        'del-1',
        'courier-1',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: 'courier-1' }
      )

      expect(res).toBe('BOX_FULL')
      // Must NOT attempt to update delivery
      expect(mockTx.delivery.updateMany).not.toHaveBeenCalled()
    })

    test('allows exactly 100 units (held 60 + delivery 40 = 100) and returns CLAIMED when update hits', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([{ id: 'courier-1' }])
        .mockResolvedValueOnce([{ exists: false }])
        .mockResolvedValueOnce([{ held: 0 }])
        .mockResolvedValueOnce([{ held: 60 }])
      mockTx.delivery.findUnique.mockResolvedValue({ boxUnits: 40 }) // 60 + 40 = 100 <= 100
      mockTx.delivery.updateMany.mockResolvedValue({ count: 1 })

      const res = await deliveryRepo.claimOfferWithinBox(
        'del-1',
        'courier-1',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: 'courier-1' }
      )

      expect(res).toBe('CLAIMED')
      expect(mockTx.delivery.updateMany).toHaveBeenCalled()
    })

    test('returns NOT_WAITING when conditional update misses (count === 0)', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([{ id: 'courier-1' }])
        .mockResolvedValueOnce([{ exists: false }])
        .mockResolvedValueOnce([{ held: 0 }])
        .mockResolvedValueOnce([{ held: 20 }])
      mockTx.delivery.findUnique.mockResolvedValue({ boxUnits: 30 })
      mockTx.delivery.updateMany.mockResolvedValue({ count: 0 }) // Missed race

      const res = await deliveryRepo.claimOfferWithinBox(
        'del-1',
        'courier-1',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: 'courier-1' }
      )

      expect(res).toBe('NOT_WAITING')
    })

    // Spec 0051 (AC-2, AC-11, cross checks 5 and 7): the claim reads the deactivation under the same row
    // lock a deactivation takes, so no offer reaches a deactivated rider, whichever matcher chose them.
    test('returns DEACTIVATED for a deactivated rider, reading and writing nothing after the lock', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([{ deactivated: true }])
      mockTx.delivery.findUnique.mockResolvedValue({ boxUnits: 10 })
      mockTx.delivery.updateMany.mockResolvedValue({ count: 1 })

      const res = await deliveryRepo.claimOfferWithinBox(
        'del-1',
        'courier-1',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: 'courier-1' }
      )

      expect(res).toBe('DEACTIVATED')
      expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1)
      expect(mockTx.delivery.findUnique).not.toHaveBeenCalled()
      expect(mockTx.delivery.updateMany).not.toHaveBeenCalled()
    })

    test('an admin hand offer past capacity (allowOverCapacity) is still DEACTIVATED for a deactivated rider', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([{ deactivated: true }])
      mockTx.delivery.findUnique.mockResolvedValue({ boxUnits: 10 })

      const res = await deliveryRepo.claimForRiderWithinBox(
        'del-1',
        'courier-1',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: 'courier-1' },
        true
      )

      expect(res).toEqual({ outcome: 'DEACTIVATED', heldUnits: 0, deliveryUnits: 0 })
      expect(mockTx.delivery.updateMany).not.toHaveBeenCalled()
    })

    test('an active rider (deactivated false) is claimed as before', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([{ deactivated: false }])
        .mockResolvedValueOnce([{ exists: false }])
        .mockResolvedValueOnce([{ held: 0 }])
        .mockResolvedValueOnce([{ held: 0 }])
      mockTx.delivery.findUnique.mockResolvedValue({ boxUnits: 30 })
      mockTx.delivery.updateMany.mockResolvedValue({ count: 1 })

      const res = await deliveryRepo.claimOfferWithinBox(
        'del-1',
        'courier-1',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: 'courier-1' }
      )

      expect(res).toBe('CLAIMED')
    })

    test('returns TWO_HELD when live deliveries count >= 2 even if allowOverCapacity is true (gap 2, spec 0048 AC-11)', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([{ deactivated: false }])
        .mockResolvedValueOnce([{ exists: false }])
        .mockResolvedValueOnce([{ held: 2 }]) // liveDeliveryCountSql >= 2 (MAX_DELIVERIES_HELD)

      const res = await deliveryRepo.claimForRiderWithinBox(
        'del-new',
        'courier-1',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: 'courier-1' },
        true // allowOverCapacity
      )

      expect(res).toEqual({ outcome: 'TWO_HELD', heldUnits: 0, deliveryUnits: 0 })
      expect(mockTx.delivery.findUnique).not.toHaveBeenCalled()
      expect(mockTx.delivery.updateMany).not.toHaveBeenCalled()
    })

    test('claimOfferWithinBox returns TWO_HELD when live deliveries count is at limit (spec 0048 AC-11)', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([{ deactivated: false }])
        .mockResolvedValueOnce([{ exists: false }])
        .mockResolvedValueOnce([{ held: 2 }]) // liveDeliveryCountSql >= 2

      const res = await deliveryRepo.claimOfferWithinBox(
        'del-new',
        'courier-1',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: 'courier-1' }
      )

      expect(res).toBe('TWO_HELD')
      expect(mockTx.delivery.updateMany).not.toHaveBeenCalled()
    })

    test('allows claim when live deliveries count < 2 even if rider carries cancelled food back (review of row 80, major)', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([{ deactivated: false }])
        .mockResolvedValueOnce([{ exists: false }])
        .mockResolvedValueOnce([{ held: 1 }]) // liveDeliveryCountSql = 1 (< 2)
        .mockResolvedValueOnce([{ held: 30 }]) // heldBoxUnitsSql = 30 (from cancelled return food)
      mockTx.delivery.findUnique.mockResolvedValue({ boxUnits: 40 }) // 30 + 40 = 70 <= 100
      mockTx.delivery.updateMany.mockResolvedValue({ count: 1 })

      const res = await deliveryRepo.claimOfferWithinBox(
        'del-new',
        'courier-1',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: 'courier-1' }
      )

      expect(res).toBe('CLAIMED')
      expect(mockTx.delivery.updateMany).toHaveBeenCalled()

      // Limit query used liveDeliveryCountSql (omitting cancelled returns), not heldBoxCountSql
      const limitQuery: Prisma.Sql = mockTx.$queryRaw.mock.calls[2][0]
      expect(limitQuery.sql).not.toContain('cancelledFromStatus')
      expect(limitQuery.sql).not.toContain('foodOutcome')
    })
  })

  describe('DeliveryEventService.offerToNextCourier on TWO_HELD (spec 0048 AC-11)', () => {
    test('returns NO_COURIER and writes no OFFERED event when claimOfferWithinBox returns TWO_HELD', async () => {
      const mockDeliveryRepo = {
        claimOfferWithinBox: jest.fn().mockResolvedValue('TWO_HELD'),
      }
      const mockConfigDomainService = {
        instanceConfig: {
          getOfferExpiryEnabled: jest.fn().mockResolvedValue(true),
          getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
          getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
        },
      }
      const mockDeliveryMatchingService = {
        findCourierForDelivery: jest.fn().mockResolvedValue({
          courier: { id: 'courier-volos-1' },
          delivery: { id: 'del-1', boxUnits: 60 },
          pickupLocation: {},
        }),
      }
      const mockDeliveryEventRepo = {
        create: jest.fn(),
      }
      const mockTaskBus = {
        queueNamed: jest.fn().mockReturnValue({ add: jest.fn() }),
        registerTaskHandler: jest.fn(),
      }

      const mockCourierRepo = {
        hasActiveSos: jest.fn().mockResolvedValue(false),
      }

      const mockDeliveryCalculationService = {
        calculateDeliveryAmountsForMatchedCourier: jest.fn().mockResolvedValue({
          totalCost: 1000,
          totalCompensation: 400,
          fee: 200,
          feePercentage: 20,
        }),
      }

      const service = new DeliveryEventService(
        {} as any,
        {} as any,
        mockCourierRepo as any,
        mockDeliveryRepo as any,
        mockDeliveryEventRepo as any,
        {} as any,
        mockTaskBus as any,
        {} as any,
        mockDeliveryMatchingService as any,
        mockDeliveryCalculationService as any,
        {} as any,
        mockConfigDomainService as any,
        {} as any,
        {} as any,
        { findOn: jest.fn().mockResolvedValue(null) } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      )

      const result = await (service as any).offerToNextCourier('del-1')

      expect(result).toBe('NO_COURIER')
      expect(mockDeliveryEventRepo.create).not.toHaveBeenCalled()
    })
  })

  describe('DeliveryEventService.offerToNextCourier on BOX_FULL', () => {
    test('returns NO_COURIER and writes no OFFERED event when claimOfferWithinBox returns BOX_FULL', async () => {
      const mockDeliveryRepo = {
        claimOfferWithinBox: jest.fn().mockResolvedValue('BOX_FULL'),
      }
      const mockConfigDomainService = {
        instanceConfig: {
          getOfferExpiryEnabled: jest.fn().mockResolvedValue(true),
          getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
          getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
        },
      }
      const mockDeliveryMatchingService = {
        findCourierForDelivery: jest.fn().mockResolvedValue({
          courier: { id: 'courier-volos-1' },
          delivery: { id: 'del-1', boxUnits: 60 },
          pickupLocation: {},
        }),
      }
      const mockDeliveryEventRepo = {
        create: jest.fn(),
      }
      const mockTaskBus = {
        queueNamed: jest.fn().mockReturnValue({ add: jest.fn() }),
        registerTaskHandler: jest.fn(),
      }

      const mockCourierRepo = {
        hasActiveSos: jest.fn().mockResolvedValue(false),
      }

      const mockDeliveryCalculationService = {
        calculateDeliveryAmountsForMatchedCourier: jest.fn().mockResolvedValue({
          totalCost: 1000,
          totalCompensation: 400,
          fee: 200,
          feePercentage: 20,
        }),
      }

      const service = new DeliveryEventService(
        {} as any, // configService
        {} as any, // websocketDispatcher
        mockCourierRepo as any,
        mockDeliveryRepo as any,
        mockDeliveryEventRepo as any, // deliveryEventRepository
        {} as any, // taskScheduler
        mockTaskBus as any,
        {} as any, // partnerWebhookService
        mockDeliveryMatchingService as any,
        mockDeliveryCalculationService as any,
        {} as any, // bullMQService
        mockConfigDomainService as any,
        {} as any, // cacheService
        {} as any, // offerPushService
        { findOn: jest.fn().mockResolvedValue(null) } as any, // dispatchStopRepository
        {} as any, // osrmRoutingService
        {} as any, // courierCompensationRepository
        {} as any, // partnerChargeRepository
        {} as any // removalRequestRepository
      )

      const result = await (service as any).offerToNextCourier('del-1')

      expect(result).toBe('NO_COURIER')
      // No OFFERED event created
      expect(mockDeliveryEventRepo.create).not.toHaveBeenCalled()
    })
  })

  describe('DeliveryEventService.offerToNextCourier on DEACTIVATED (spec 0051, cross check 7)', () => {
    test('returns NO_COURIER and writes no OFFERED event when claimOfferWithinBox returns DEACTIVATED (only Static can name such a rider)', async () => {
      const mockDeliveryRepo = {
        claimOfferWithinBox: jest.fn().mockResolvedValue('DEACTIVATED'),
      }
      const mockConfigDomainService = {
        instanceConfig: {
          getOfferExpiryEnabled: jest.fn().mockResolvedValue(true),
          getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
          getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
        },
      }
      const mockDeliveryMatchingService = {
        findCourierForDelivery: jest.fn().mockResolvedValue({
          courier: { id: 'courier-volos-1' },
          delivery: { id: 'del-1', boxUnits: 60 },
          pickupLocation: {},
        }),
      }
      const mockDeliveryEventRepo = {
        create: jest.fn(),
      }
      const mockTaskBus = {
        queueNamed: jest.fn().mockReturnValue({ add: jest.fn() }),
        registerTaskHandler: jest.fn(),
      }

      const mockCourierRepo = {
        hasActiveSos: jest.fn().mockResolvedValue(false),
      }

      const mockDeliveryCalculationService = {
        calculateDeliveryAmountsForMatchedCourier: jest.fn().mockResolvedValue({
          totalCost: 1000,
          totalCompensation: 400,
          fee: 200,
          feePercentage: 20,
        }),
      }

      const service = new DeliveryEventService(
        {} as any, // configService
        {} as any, // websocketDispatcher
        mockCourierRepo as any,
        mockDeliveryRepo as any,
        mockDeliveryEventRepo as any, // deliveryEventRepository
        {} as any, // taskScheduler
        mockTaskBus as any,
        {} as any, // partnerWebhookService
        mockDeliveryMatchingService as any,
        mockDeliveryCalculationService as any,
        {} as any, // bullMQService
        mockConfigDomainService as any,
        {} as any, // cacheService
        {} as any, // offerPushService
        { findOn: jest.fn().mockResolvedValue(null) } as any, // dispatchStopRepository
        {} as any, // osrmRoutingService
        {} as any, // courierCompensationRepository
        {} as any, // partnerChargeRepository
        {} as any // removalRequestRepository
      )

      const result = await (service as any).offerToNextCourier('del-1')

      expect(mockDeliveryRepo.claimOfferWithinBox).toHaveBeenCalledTimes(1)
      expect(result).toBe('NO_COURIER')
      // No OFFERED event created
      expect(mockDeliveryEventRepo.create).not.toHaveBeenCalled()
    })
  })

  describe('Critical Scenario: Two 60-unit deliveries claimed for one rider', () => {
    test('second claim is refused with BOX_FULL when the first claim leaves rider holding 60 units', async () => {
      // Simulate state: rider starts with 0 held units.
      // After first claim succeeds, rider holds 60 units.
      let courierHeldUnits = 0

      const fakeTx = {
        $queryRaw: jest.fn().mockImplementation((stringsOrSql: any, ...values: any[]) => {
          const sqlText =
            typeof stringsOrSql === 'string'
              ? stringsOrSql
              : Array.isArray(stringsOrSql)
              ? stringsOrSql.join('?')
              : stringsOrSql?.sql ?? ''
          if (sqlText.includes('FOR UPDATE')) {
            return Promise.resolve([{ id: 'courier-volos-1' }])
          }
          if (sqlText.includes('SELECT COALESCE(SUM("Delivery"."boxUnits")')) {
            return Promise.resolve([{ held: courierHeldUnits }])
          }
          return Promise.resolve([])
        }),
        delivery: {
          findUnique: jest.fn().mockImplementation(({ where }: any) => {
            if (where.id === 'del-60-1') return Promise.resolve({ boxUnits: 60 })
            if (where.id === 'del-60-2') return Promise.resolve({ boxUnits: 60 })
            return Promise.resolve(null)
          }),
          updateMany: jest.fn().mockImplementation(({ where }: any) => {
            if (where.id === 'del-60-1') {
              courierHeldUnits += 60 // First claim claimed: courier now holds 60 units
              return Promise.resolve({ count: 1 })
            }
            if (where.id === 'del-60-2') {
              courierHeldUnits += 60
              return Promise.resolve({ count: 1 })
            }
            return Promise.resolve({ count: 0 })
          }),
        },
      }

      const prisma = {
        $transaction: jest.fn((cb) => cb(fakeTx)),
      }
      const deliveryRepo = new DeliveryRepository(prisma as unknown as PrismaService)

      // 1. Claim first 60-unit delivery: held = 0, 0 + 60 <= 100 -> CLAIMED
      const claim1 = await deliveryRepo.claimOfferWithinBox(
        'del-60-1',
        'courier-volos-1',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: 'courier-volos-1' }
      )
      expect(claim1).toBe('CLAIMED')
      expect(courierHeldUnits).toBe(60)

      // 2. Claim second 60-unit delivery for same courier: held = 60, 60 + 60 = 120 > 100 -> BOX_FULL
      const claim2 = await deliveryRepo.claimOfferWithinBox(
        'del-60-2',
        'courier-volos-1',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: 'courier-volos-1' }
      )
      expect(claim2).toBe('BOX_FULL')
      // Delivery 2 was never updated
      expect(fakeTx.delivery.updateMany).toHaveBeenCalledTimes(1)
      expect(courierHeldUnits).toBe(60)
    })
  })

  describe('claimForRiderWithinBox (spec 0043 review fix)', () => {
    test('locks the Courier row before summing', async () => {
      const callLog: string[] = []
      const fakeTx = {
        $queryRaw: jest.fn().mockImplementation((stringsOrSql: any) => {
          const sqlText = stringsOrSql?.sql ?? (typeof stringsOrSql === 'string' ? stringsOrSql : stringsOrSql.join('?'))
          if (sqlText.includes('FOR UPDATE')) {
            callLog.push('lock')
            return Promise.resolve([{ id: 'courier-1' }])
          }
          if (sqlText.includes('SELECT COALESCE(SUM("Delivery"."boxUnits")')) {
            callLog.push('sum')
            return Promise.resolve([{ held: 0 }])
          }
          return Promise.resolve([])
        }),
        delivery: {
          findUnique: jest.fn().mockResolvedValue({ boxUnits: 50 }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      }
      const prisma = { $transaction: jest.fn((cb) => cb(fakeTx)) }
      const deliveryRepo = new DeliveryRepository(prisma as unknown as PrismaService)

      await deliveryRepo.claimForRiderWithinBox('del-1', 'courier-1', {}, {}, false)

      expect(callLog).toEqual(['lock', 'sum'])
      expect(fakeTx.$queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE')
    })

    test('with allowOverCapacity false and held + units > 100 returns BOX_FULL without writing', async () => {
      const fakeTx = {
        $queryRaw: jest.fn().mockImplementation((stringsOrSql: any) => {
          const sqlText = stringsOrSql?.sql ?? (typeof stringsOrSql === 'string' ? stringsOrSql : stringsOrSql.join('?'))
          if (sqlText.includes('FOR UPDATE')) return Promise.resolve([{ id: 'courier-1' }])
          if (sqlText.includes('SELECT COALESCE(SUM("Delivery"."boxUnits")')) return Promise.resolve([{ held: 60 }])
          return Promise.resolve([])
        }),
        delivery: {
          findUnique: jest.fn().mockResolvedValue({ boxUnits: 50 }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      }
      const prisma = { $transaction: jest.fn((cb) => cb(fakeTx)) }
      const deliveryRepo = new DeliveryRepository(prisma as unknown as PrismaService)

      const result = await deliveryRepo.claimForRiderWithinBox(
        'del-1',
        'courier-1',
        { status: EnumDeliveryStatus.CREATED },
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        false
      )

      expect(result).toEqual({ outcome: 'BOX_FULL', heldUnits: 60, deliveryUnits: 50 })
      expect(fakeTx.delivery.updateMany).not.toHaveBeenCalled()
    })

    test('with allowOverCapacity true writes anyway and returns held and delivery units measured inside transaction', async () => {
      const fakeTx = {
        $queryRaw: jest.fn().mockImplementation((stringsOrSql: any) => {
          const sqlText = stringsOrSql?.sql ?? (typeof stringsOrSql === 'string' ? stringsOrSql : stringsOrSql.join('?'))
          if (sqlText.includes('FOR UPDATE')) return Promise.resolve([{ id: 'courier-1' }])
          if (sqlText.includes('SELECT COALESCE(SUM("Delivery"."boxUnits")')) return Promise.resolve([{ held: 70 }])
          return Promise.resolve([])
        }),
        delivery: {
          findUnique: jest.fn().mockResolvedValue({ boxUnits: 40 }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      }
      const prisma = { $transaction: jest.fn((cb) => cb(fakeTx)) }
      const deliveryRepo = new DeliveryRepository(prisma as unknown as PrismaService)

      const result = await deliveryRepo.claimForRiderWithinBox(
        'del-1',
        'courier-1',
        { status: EnumDeliveryStatus.CREATED },
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        true
      )

      expect(result).toEqual({ outcome: 'CLAIMED', heldUnits: 70, deliveryUnits: 40 })
      expect(fakeTx.delivery.updateMany).toHaveBeenCalledWith({
        where: { status: EnumDeliveryStatus.CREATED, id: 'del-1', boxUnits: 40 },
        data: { status: EnumDeliveryStatus.ASSIGNING_COURIER },
      })
    })

    test("conditional write's where includes boxUnits equal to the units read (a size change in between makes it miss: NOT_WAITING)", async () => {
      const fakeTx = {
        $queryRaw: jest.fn().mockImplementation((stringsOrSql: any) => {
          const sqlText = stringsOrSql?.sql ?? (typeof stringsOrSql === 'string' ? stringsOrSql : stringsOrSql.join('?'))
          if (sqlText.includes('FOR UPDATE')) return Promise.resolve([{ id: 'courier-1' }])
          if (sqlText.includes('SELECT COALESCE(SUM("Delivery"."boxUnits")')) return Promise.resolve([{ held: 20 }])
          return Promise.resolve([])
        }),
        delivery: {
          findUnique: jest.fn().mockResolvedValue({ boxUnits: 30 }),
          // Size changed concurrently in DB so where clause with boxUnits: 30 matches 0 rows!
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      }
      const prisma = { $transaction: jest.fn((cb) => cb(fakeTx)) }
      const deliveryRepo = new DeliveryRepository(prisma as unknown as PrismaService)

      const result = await deliveryRepo.claimForRiderWithinBox(
        'del-1',
        'courier-1',
        { status: EnumDeliveryStatus.CREATED },
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        false
      )

      expect(fakeTx.delivery.updateMany).toHaveBeenCalledWith({
        where: { status: EnumDeliveryStatus.CREATED, id: 'del-1', boxUnits: 30 },
        data: { status: EnumDeliveryStatus.ASSIGNING_COURIER },
      })
      expect(result).toEqual({ outcome: 'NOT_WAITING', heldUnits: 20, deliveryUnits: 30 })
    })

    test('claimOfferWithinBox still answers its three words through it with allowOverCapacity false', async () => {
      const prisma = { $transaction: jest.fn() }
      const deliveryRepo = new DeliveryRepository(prisma as unknown as PrismaService)

      const spy = jest.spyOn(deliveryRepo, 'claimForRiderWithinBox')

      spy.mockResolvedValueOnce({ outcome: 'CLAIMED', heldUnits: 10, deliveryUnits: 30 })
      const res1 = await deliveryRepo.claimOfferWithinBox('del-1', 'courier-1', { status: EnumDeliveryStatus.CREATED }, {})
      expect(res1).toBe('CLAIMED')
      expect(spy).toHaveBeenLastCalledWith('del-1', 'courier-1', { status: EnumDeliveryStatus.CREATED }, {}, false)

      spy.mockResolvedValueOnce({ outcome: 'BOX_FULL', heldUnits: 80, deliveryUnits: 30 })
      const res2 = await deliveryRepo.claimOfferWithinBox('del-1', 'courier-1', { status: EnumDeliveryStatus.CREATED }, {})
      expect(res2).toBe('BOX_FULL')
      expect(spy).toHaveBeenLastCalledWith('del-1', 'courier-1', { status: EnumDeliveryStatus.CREATED }, {}, false)

      spy.mockResolvedValueOnce({ outcome: 'NOT_WAITING', heldUnits: 10, deliveryUnits: 30 })
      const res3 = await deliveryRepo.claimOfferWithinBox('del-1', 'courier-1', { status: EnumDeliveryStatus.CREATED }, {})
      expect(res3).toBe('NOT_WAITING')
      expect(spy).toHaveBeenLastCalledWith('del-1', 'courier-1', { status: EnumDeliveryStatus.CREATED }, {}, false)

      spy.mockRestore()
    })
  })

  // Spec 0048 (cross check 6, review of row 80, c04c08f): settling stop sequence when pair breaks
  describe('DeliveryRepository.settleStopSequence', () => {
    let mockPrisma: any
    let deliveryRepo: DeliveryRepository

    beforeEach(() => {
      mockPrisma = {
        delivery: {
          findMany: jest.fn(),
          updateMany: jest.fn(),
        },
      }
      deliveryRepo = new DeliveryRepository(mockPrisma as unknown as PrismaService)
    })

    test('clears stopSequence to DbNull when stack pair is no longer together (partner alone)', async () => {
      // One delivery is back to ASSIGNING_COURIER without rider; the partner is ACCEPTED with courier-1
      mockPrisma.delivery.findMany.mockResolvedValueOnce([
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: null, courierId: null },
        { status: EnumDeliveryStatus.ACCEPTED, matchedCourierId: null, courierId: 'courier-1' },
      ])
      mockPrisma.delivery.updateMany.mockResolvedValueOnce({ count: 1 })

      const cleared = await deliveryRepo.settleStopSequence('grp-stack-1')

      expect(cleared).toBe(1)
      expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith({
        where: { offerGroupId: 'grp-stack-1' },
        select: { status: true, matchedCourierId: true, courierId: true },
      })
      expect(mockPrisma.delivery.updateMany).toHaveBeenCalledWith({
        where: { offerGroupId: 'grp-stack-1', NOT: { stopSequence: { equals: Prisma.DbNull } } },
        data: { stopSequence: Prisma.DbNull },
      })
    })

    test('does not clear stopSequence when deliveries are still together with the same rider', async () => {
      // Both deliveries are with the same rider (one accepted, one dispatched)
      mockPrisma.delivery.findMany.mockResolvedValueOnce([
        { status: EnumDeliveryStatus.ACCEPTED, matchedCourierId: null, courierId: 'courier-1' },
        { status: EnumDeliveryStatus.DISPATCHED, matchedCourierId: null, courierId: 'courier-1' },
      ])

      const cleared = await deliveryRepo.settleStopSequence('grp-stack-together')

      expect(cleared).toBe(0)
      expect(mockPrisma.delivery.updateMany).not.toHaveBeenCalled()
    })

    test('clears stopSequence when no members found (empty group)', async () => {
      mockPrisma.delivery.findMany.mockResolvedValueOnce([])
      mockPrisma.delivery.updateMany.mockResolvedValueOnce({ count: 0 })

      const cleared = await deliveryRepo.settleStopSequence('grp-empty')

      expect(cleared).toBe(0)
      expect(mockPrisma.delivery.updateMany).toHaveBeenCalledWith({
        where: { offerGroupId: 'grp-empty', NOT: { stopSequence: { equals: Prisma.DbNull } } },
        data: { stopSequence: Prisma.DbNull },
      })
    })
  })
})
