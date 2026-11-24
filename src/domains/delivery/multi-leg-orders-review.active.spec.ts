import * as fs from 'fs'
import * as path from 'path'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { EnumDeliveryStatus, Prisma } from '@prisma/types'
import { LEG_REFERENCE_REQUIRED_SENTENCE } from './legs'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { CourierRepository, siblingLegCondition, siblingLegHeldSql } from 'src/persistence/repositories/courier.repository'
import { DeliveryPartnerRestApiService } from 'src/rest-api/delivery/partner/delivery.partner.rest-api.service'
import { CourierSeniorityMatcherService } from 'src/services/courier-matcher/courier-seniority-matcher.service'
import { FairnessCourierMatcherService } from 'src/services/courier-matcher/fairness-courier-matcher.service'
import { NearestCourierMatcherService } from 'src/services/courier-matcher/nearest-courier-matcher.service'

/**
 * Spec 0046 (row 10), the review fixes of backend ce8d7fe: the leg labels CHECK that counts the labels,
 * matchers that leave out a rider holding another leg of the order, a leg needing a reference, and the
 * locked reference refused before anything is written. Tests by a Fable subagent standing in for agy (R.25).
 */
describe('Multi leg orders: review fixes (spec 0046)', () => {
  // ==========================================================================
  // AC-1: the database's own check (read as text; no test here runs SQL)
  // ==========================================================================
  describe('migration 20261121180000_multi_leg_labels_check', () => {
    const sql = fs
      .readFileSync(
        path.resolve(__dirname, '../../../prisma/migrations/20261121180000_multi_leg_labels_check/migration.sql'),
        'utf8'
      )
      // Comments out, so the test reads the statements only.
      .replace(/--.*$/gm, '')
      .replace(/\s+/g, ' ')

    test('drops the first check and adds one of the same name', () => {
      const drop = sql.indexOf('ALTER TABLE "Delivery" DROP CONSTRAINT "Delivery_leg_labels_consistent"')
      const add = sql.indexOf('ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_leg_labels_consistent" CHECK')
      expect(drop).toBeGreaterThanOrEqual(0)
      expect(add).toBeGreaterThan(drop)
    })

    test('counts the labels with num_nonnulls: none, or both (a NULL comparison can no longer pass)', () => {
      expect(sql).toContain('num_nonnulls("legNumber", "legCount") = 0')
      expect(sql).toContain('num_nonnulls("legNumber", "legCount") = 2')
      // The old shape, which let one label alone through, is gone.
      expect(sql).not.toContain('IS NULL')
    })

    test('both set means 2 to 4 legs and a number from 1 to the count, all three joined by AND', () => {
      expect(sql).toMatch(
        /num_nonnulls\("legNumber", "legCount"\) = 0 OR \( num_nonnulls\("legNumber", "legCount"\) = 2 AND "legCount" BETWEEN 2 AND 4 AND "legNumber" BETWEEN 1 AND "legCount" \)/
      )
    })
  })

  // ==========================================================================
  // AC-4: the candidate queries leave out a rider who holds another leg of the order
  // ==========================================================================
  describe('siblingLegCondition', () => {
    test('with a delivery: NOT (the sibling question), asked for each candidate rider row', () => {
      const condition = siblingLegCondition('del-leg-2')
      const question = siblingLegHeldSql(Prisma.sql`"Courier"."id"`, 'del-leg-2')

      expect(condition.sql.replace(/\s+/g, ' ')).toContain(`AND NOT (${question.sql.replace(/\s+/g, ' ')})`)
      expect(condition.sql).toContain('"Courier"."id"')
      expect(condition.values).toContain('del-leg-2')
    })

    test.each([[undefined], ['']])('with no delivery (%p, a quote): adds nothing', (deliveryId) => {
      const condition = siblingLegCondition(deliveryId)

      expect(condition.sql.trim()).toBe('')
      expect(condition.values).toEqual([])
    })
  })

  describe('both candidate queries carry the condition', () => {
    let prisma: any
    let repository: CourierRepository
    const location = { latitude: 39.36, longitude: 22.95 }
    const MARK = 'AND NOT (SELECT EXISTS'
    const flat = (query: Prisma.Sql) => query.sql.replace(/\s+/g, ' ')

    beforeEach(() => {
      prisma = { $queryRaw: jest.fn().mockResolvedValue([]), courier: { findUniqueOrThrow: jest.fn() } }
      repository = new CourierRepository(prisma)
    })

    const cases: [string, (args: any) => Promise<unknown>][] = [
      ['findNearestAvailableCourier', (args) => repository.findNearestAvailableCourier(args)],
      ['findNearestAvailableCandidates', (args) => repository.findNearestAvailableCandidates(args, 5)],
      ['findMostSeniorAvailableCourier', (args) => repository.findMostSeniorAvailableCourier(args)],
    ]

    test.each(cases)('%s leaves out a rider holding a sibling of the delivery it is asked for', async (_name, run) => {
      await run({ location, siblingOfDeliveryId: 'del-leg-2' })

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
      const query: Prisma.Sql = prisma.$queryRaw.mock.calls[0][0]
      expect(flat(query)).toContain(MARK)
      expect(flat(query)).toContain('"Delivery"."orderReference" = "target"."orderReference"')
      expect(query.values).toContain('del-leg-2')
    })

    test.each(cases)('%s adds nothing when no delivery is named (a quote)', async (_name, run) => {
      await run({ location })

      const query: Prisma.Sql = prisma.$queryRaw.mock.calls[0][0]
      expect(flat(query)).not.toContain(MARK)
      expect(flat(query)).not.toContain('"target"')
    })
  })

  describe('each matcher names the delivery it is matching', () => {
    const pickupLocation = { latitude: 39.3621, longitude: 22.9421 }
    const dropoffLocation = { latitude: 39.3701, longitude: 22.9501 }
    const input = { pickupLocation, dropoffLocation, rejectedCourierIds: [], boxUnits: 50, deliveryId: 'del-leg-2' }
    const quoteInput = { pickupLocation, dropoffLocation, rejectedCourierIds: [] }

    test('nearest, by straight distance', async () => {
      const couriers: any = { getNearestAvailableCourier: jest.fn().mockResolvedValue(null), getNearestAvailableCandidates: jest.fn() }
      const config: any = {
        instanceConfig: {
          getMaxAssignmentDistanceInKM: jest.fn().mockResolvedValue(20),
          getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
        },
      }
      const matcher = new NearestCourierMatcherService(couriers, config, { getRoute: jest.fn() } as any)

      await matcher.findCourierForDelivery(input)
      expect(couriers.getNearestAvailableCourier.mock.calls[0][0].siblingOfDeliveryId).toBe('del-leg-2')

      await matcher.findCourierForDelivery(quoteInput)
      expect(couriers.getNearestAvailableCourier.mock.calls[1][0].siblingOfDeliveryId).toBeUndefined()
    })

    test('nearest, by road time (offers timed)', async () => {
      const couriers: any = { getNearestAvailableCourier: jest.fn(), getNearestAvailableCandidates: jest.fn().mockResolvedValue([]) }
      const config: any = {
        instanceConfig: {
          getMaxAssignmentDistanceInKM: jest.fn().mockResolvedValue(20),
          getOfferTimingEnabled: jest.fn().mockResolvedValue(true),
          getOfferTimingCandidates: jest.fn().mockResolvedValue(5),
        },
      }
      const matcher = new NearestCourierMatcherService(couriers, config, { getRoute: jest.fn() } as any)

      await matcher.findCourierForDelivery(input)

      expect(couriers.getNearestAvailableCourier).not.toHaveBeenCalled()
      expect(couriers.getNearestAvailableCandidates.mock.calls[0][0].siblingOfDeliveryId).toBe('del-leg-2')
    })

    test('seniority', async () => {
      const couriers: any = { getMostSeniorAvailableCourier: jest.fn().mockResolvedValue(null) }
      const config: any = { instanceConfig: { getMaxAssignmentDistanceInKM: jest.fn().mockResolvedValue(20) } }
      const matcher = new CourierSeniorityMatcherService(couriers, config)

      await matcher.findCourierForDelivery(input)
      expect(couriers.getMostSeniorAvailableCourier.mock.calls[0][0].siblingOfDeliveryId).toBe('del-leg-2')

      await matcher.findCourierForDelivery(quoteInput)
      expect(couriers.getMostSeniorAvailableCourier.mock.calls[1][0].siblingOfDeliveryId).toBeUndefined()
    })

    test('fairness', async () => {
      const couriers: any = { getNearestAvailableCandidates: jest.fn().mockResolvedValue([]) }
      const config: any = {
        instanceConfig: {
          getMaxAssignmentDistanceInKM: jest.fn().mockResolvedValue(20),
          getFairnessCandidateLimit: jest.fn().mockResolvedValue(10),
          getFairnessMinOnlineMinutes: jest.fn().mockResolvedValue(30),
          getFairnessWeightRoadTime: jest.fn().mockResolvedValue(50),
          getFairnessWeightEarnings: jest.fn().mockResolvedValue(30),
          getFairnessWeightWaiting: jest.fn().mockResolvedValue(20),
          getShiftsEnabled: jest.fn().mockResolvedValue(false),
          getFairnessWeightShift: jest.fn().mockResolvedValue(0),
        },
      }
      const matcher = new FairnessCourierMatcherService(
        couriers,
        config,
        { getTableSecondsTo: jest.fn() } as any,
        { todayForFairness: jest.fn() } as any
      )

      await matcher.findCourierForDelivery(input)

      expect(couriers.getNearestAvailableCandidates.mock.calls[0][0].siblingOfDeliveryId).toBe('del-leg-2')
    })
  })

  // ==========================================================================
  // The partner routes
  // ==========================================================================
  describe('partner create: a leg needs a reference', () => {
    const partnerId = 'partner-legs'
    let service: DeliveryPartnerRestApiService
    let deliveries: any
    let quotes: any

    beforeEach(() => {
      deliveries = {
        getByDeliveryQuoteId: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'del-leg' }),
        getOrderLegsOf: jest.fn().mockResolvedValue([]),
      }
      quotes = {
        getByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'quote-leg',
          expiresAt: new Date(Date.now() + 10 * 60_000),
          pickupLocationId: 'loc-pickup',
          dropoffLocationId: 'loc-dropoff',
        }),
      }
      service = new DeliveryPartnerRestApiService(
        quotes,
        deliveries,
        {
          getById: jest
            .fn()
            .mockResolvedValue(new PartnerEntity({ id: partnerId, pausedUntil: null, disabledAt: null, usualPrepMinutes: 15 } as any)),
        } as any,
        {
          getByIds: jest.fn().mockResolvedValue([{ id: 'loc-pickup' }, { id: 'loc-dropoff' }]),
          findOrCreate: jest.fn().mockResolvedValue({ id: 'loc-1' }),
        } as any,
        {} as any,
        { isValidDeliveryLocationDrift: jest.fn().mockReturnValue(true) } as any,
        { findOn: jest.fn().mockResolvedValue(null) } as any,
        { instanceConfig: { getRestaurantHistoryDays: async () => 30 } } as any,
        {} as any,
        {} as any
      )
    })

    const body = (orderReference: string, labels: Record<string, unknown> = { legNumber: 1, legCount: 2 }): any => ({
      quoteId: 'quote-leg',
      orderReference,
      pickupAddress: {},
      dropoffAddress: {},
      ...labels,
    })

    test.each([['', 'empty'], ['   ', 'blank'], ['\t\n', 'only whitespace']])(
      'a leg with reference %j (%s) answers 400 with the sentence; nothing is read or created',
      async (orderReference) => {
        const call = service.create(partnerId, body(orderReference))

        await expect(call).rejects.toBeInstanceOf(BadRequestException)
        await expect(call).rejects.toMatchObject({
          status: 400,
          message: 'A leg needs an orderReference: it is what ties the legs of an order together.',
        })
        expect(LEG_REFERENCE_REQUIRED_SENTENCE).toBe(
          'A leg needs an orderReference: it is what ties the legs of an order together.'
        )
        expect(deliveries.getOrderLegsOf).not.toHaveBeenCalled()
        expect(quotes.getByIdOrThrow).not.toHaveBeenCalled()
        expect(deliveries.create).not.toHaveBeenCalled()
      }
    )

    test('a leg with a reference is created', async () => {
      await service.create(partnerId, body('order-77'))

      expect(deliveries.create).toHaveBeenCalledTimes(1)
    })

    test('a single delivery with an empty reference is not refused by this rule', async () => {
      await service.create(partnerId, body('', {}))

      expect(deliveries.create).toHaveBeenCalledTimes(1)
    })
  })

  describe('partner update: the locked reference is refused before anything is written', () => {
    const partnerId = 'partner-legs'
    let service: DeliveryPartnerRestApiService
    let deliveries: any
    let locations: any
    let events: any

    const leg = (overrides: Record<string, unknown> = {}) => ({
      id: 'del-leg-1',
      partnerId,
      status: EnumDeliveryStatus.CREATED,
      createdAt: new Date(),
      dropoffLocationId: 'loc-1',
      deliveryQuoteId: 'quote-1',
      orderReference: 'order-77',
      legNumber: 1,
      legCount: 2,
      ...overrides,
    })
    // The stored point is 39.36, 22.94; this body moves it.
    const movedBody = (orderReference: string): any => ({ orderReference, dropoffLatitude: 39.3605, dropoffLongitude: 22.9405 })

    beforeEach(() => {
      deliveries = {
        getByIdOrThrow: jest.fn().mockResolvedValue(leg()),
        update: jest.fn().mockResolvedValue({ id: 'del-leg-1' }),
        changeBoxSize: jest.fn(),
      }
      locations = {
        getById: jest.fn().mockResolvedValue({ id: 'loc-1', latitude: 39.36, longitude: 22.94 }),
        create: jest.fn().mockResolvedValue({ id: 'loc-new' }),
      }
      events = {
        recordDropoffPointCorrectedEvent: jest.fn().mockResolvedValue(undefined),
        recordTipChangedEvent: jest.fn().mockResolvedValue(undefined),
      }
      service = new DeliveryPartnerRestApiService(
        { getByIdOrThrow: jest.fn().mockResolvedValue({ id: 'quote-1', dropoffLocationId: 'loc-1' }) } as any,
        deliveries,
        {} as any,
        locations,
        {} as any,
        { isValidDeliveryLocationDrift: jest.fn().mockResolvedValue(true) } as any,
        { findOn: jest.fn().mockResolvedValue(null) } as any,
        { instanceConfig: { getRestaurantHistoryDays: async () => 30 } } as any,
        events,
        {} as any
      )
    })

    test('a moved point plus a new reference on a leg: 409, and no Location is created', async () => {
      const call = service.update('del-leg-1', partnerId, movedBody('another-order'))

      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({ status: 409 })
      expect(locations.create).not.toHaveBeenCalled()
      expect(deliveries.update).not.toHaveBeenCalled()
      expect(deliveries.changeBoxSize).not.toHaveBeenCalled()
      expect(events.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
    })

    test('the same move with the leg\'s own reference goes through (the fixture really moves the point)', async () => {
      await service.update('del-leg-1', partnerId, movedBody('order-77'))

      expect(locations.create).toHaveBeenCalledTimes(1)
      expect(deliveries.update).toHaveBeenCalledWith('del-leg-1', expect.objectContaining({ dropoffLocationId: 'loc-new' }))
    })

    test("another restaurant's leg still answers 404, not the 409 (visibility comes first)", async () => {
      deliveries.getByIdOrThrow.mockResolvedValue(leg({ partnerId: 'partner-other' }))

      await expect(service.update('del-leg-1', partnerId, movedBody('another-order'))).rejects.toMatchObject({ status: 404 })
      expect(locations.create).not.toHaveBeenCalled()
    })
  })
})
