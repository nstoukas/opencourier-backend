import * as fs from 'fs'
import * as path from 'path'
import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common'
import { EnumDeliveryEventType, EnumDeliveryStatus, EnumDistanceUnit, Prisma } from '@prisma/types'
import { DeliveryDomainService } from './delivery.domain.service'
import { DeliveryEntity } from './entities/delivery.entity'
import { DeliveryWithLocationsEntity } from './entities/delivery-with-locations.entity'
import {
  LEG_LABELS_LOCKED_SENTENCE,
  LEG_TAKEN_SENTENCE,
  MAX_LEG_COUNT,
  MIN_LEG_COUNT,
  SIBLING_LEG_HELD_SENTENCE,
  legLabelsProblem,
  legPayload,
  missingLegNumbers,
  siblingConflict,
} from './legs'
import { OFFER_CARD_PAYLOAD_KEYS, buildOfferCardPayload } from './offer-card-payload'
import { UNKNOWN_OFFER_TRIP } from './offer-trip'
import { BoxOverCapacityException, DeliveryNotFoundException } from 'src/errors'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { siblingLegHeldSql } from 'src/persistence/repositories/courier.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryAdminRestApiController } from 'src/rest-api/delivery/admin/delivery.admin.rest-api.controller'
import { DeliveryAdminDto } from 'src/rest-api/delivery/admin/dtos/delivery.admin.dto'
import { DeliveryCourierDto } from 'src/rest-api/delivery/courier/dtos/delivery.courier.dto'
import { DeliveryPartnerRestApiController } from 'src/rest-api/delivery/partner/delivery.partner.rest-api.controller'
import { DeliveryPartnerRestApiService } from 'src/rest-api/delivery/partner/delivery.partner.rest-api.service'
import { DeliveryPartnerDto } from 'src/rest-api/delivery/partner/dtos/delivery.partner.dto'
import { DeliveryCreatePartnerInput } from 'src/rest-api/delivery/partner/queries/delivery-create.partner.input'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'

/**
 * Spec 0046 (row 10, GA): multi leg orders. One order too big for one box is N ordinary deliveries
 * ("legs") sharing the restaurant's orderReference, labelled "leg 1 of 2". Written from the spec's
 * acceptance criteria (AC-1, AC-4, AC-6, AC-7, AC-8) and its "Cross check" section, which wins where
 * the two differ. Tests by a Fable subagent standing in for agy (decision R.25).
 */

// The exact sentences a restaurant or an admin reads; pinned as text so a reworded constant is seen.
const BOTH_OR_NEITHER = 'legNumber and legCount go together: send both, or neither for a single delivery.'
const RIDER_HOLDS_SIBLING = 'This rider already carries another leg of the same order. Each leg goes to a different rider.'
const LEG_LOCKED = 'This delivery is one leg of an order: its order reference and leg numbers cannot change.'

// A Prisma "unique constraint failed" error as the client throws it (recognised by name and code).
function uniqueConstraintError(target: unknown): Error {
  const error: any = new Error('Unique constraint failed on the fields')
  error.name = 'PrismaClientKnownRequestError'
  error.code = 'P2002'
  error.meta = { target }
  return error
}

describe('Multi leg orders (spec 0046)', () => {
  // ==========================================================================
  // AC-1: the two labels and their rules
  // ==========================================================================
  describe('AC-1: the leg labels (legLabelsProblem)', () => {
    test('both absent is a single delivery: no problem', () => {
      expect(legLabelsProblem({})).toBeNull()
      expect(legLabelsProblem({ legNumber: undefined, legCount: undefined })).toBeNull()
    })

    test('a JSON null counts as not sent', () => {
      expect(legLabelsProblem({ legNumber: null, legCount: null })).toBeNull()
    })

    test.each([
      [{ legNumber: 1 }],
      [{ legCount: 2 }],
      [{ legNumber: 1, legCount: null }],
      [{ legNumber: null, legCount: 2 }],
    ])('one label without the other is a problem: %j', (labels) => {
      expect(legLabelsProblem(labels)).toBe(BOTH_OR_NEITHER)
    })

    test('the bounds are 2 to 4 legs', () => {
      expect(MIN_LEG_COUNT).toBe(2)
      expect(MAX_LEG_COUNT).toBe(4)
    })

    test.each([
      [1, 2],
      [2, 2],
      [1, 3],
      [3, 3],
      [1, 4],
      [4, 4],
    ])('leg %i of %i is fine', (legNumber, legCount) => {
      expect(legLabelsProblem({ legNumber, legCount })).toBeNull()
    })

    test.each([
      [1, 1],
      [1, 0],
      [1, 5],
      [5, 5],
      [1, -2],
    ])('a count outside 2 to 4 is a problem: leg %i of %i', (legNumber, legCount) => {
      expect(legLabelsProblem({ legNumber, legCount })).toBe('legCount must be from 2 to 4.')
    })

    // AC-8: "a test fails if a leg with legNumber > legCount is accepted".
    test.each([
      [3, 2],
      [4, 3],
      [5, 4],
      [0, 2],
      [-1, 3],
    ])('a number outside 1..legCount is a problem: leg %i of %i', (legNumber, legCount) => {
      expect(legLabelsProblem({ legNumber, legCount })).toBe(`legNumber must be from 1 to legCount (${legCount}).`)
    })

    test.each([
      [1.5, 2],
      [1, 2.5],
      [Number.NaN, 2],
    ])('a number that is not whole is a problem: leg %d of %d', (legNumber, legCount) => {
      expect(legLabelsProblem({ legNumber, legCount })).toBe('legNumber and legCount must be whole numbers.')
    })
  })

  describe('AC-1: the partner create body (DeliveryCreatePartnerInput)', () => {
    const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } })
    const problemsOf = async (body: Record<string, unknown>): Promise<string[]> => {
      try {
        await pipe.transform(body, { type: 'body', metatype: DeliveryCreatePartnerInput })
        return []
      } catch (error: any) {
        expect(error).toBeInstanceOf(BadRequestException)
        // A list from class-validator, or one sentence from @RefuseIfNotSentAsNumber.
        const messages: string[] = ([] as string[]).concat(error.getResponse().message)
        return messages.filter((message) => message.includes('legNumber') || message.includes('legCount'))
      }
    }

    test('both labels as whole numbers pass', async () => {
      expect(await problemsOf({ legNumber: 1, legCount: 2 })).toEqual([])
    })

    test('neither label passes (both are optional)', async () => {
      expect(await problemsOf({})).toEqual([])
    })

    // The ValidationPipe turns "2", "" and true into numbers before @IsInt runs; none may get through.
    test.each([
      ['a number sent as text', { legNumber: '1', legCount: 2 }, 'legNumber'],
      ['a count sent as text', { legNumber: 1, legCount: '2' }, 'legCount'],
      ['an empty text', { legNumber: '', legCount: 2 }, 'legNumber'],
      ['true', { legNumber: 1, legCount: true }, 'legCount'],
      ['a fraction', { legNumber: 1.5, legCount: 2 }, 'legNumber'],
    ])('%s answers 400 naming the field', async (_name, body, field) => {
      const problems = await problemsOf(body)
      expect(problems.length).toBeGreaterThan(0)
      expect(problems.join(' ')).toContain(field)
    })
  })

  // ==========================================================================
  // Key invariants, cross check 2: a new leg agrees with the legs already sent
  // ==========================================================================
  describe('key invariants: siblingConflict', () => {
    test('no siblings: no conflict', () => {
      expect(siblingConflict({ legNumber: 1, legCount: 2 }, [])).toBeNull()
    })

    test('a different number of the same count: no conflict', () => {
      expect(siblingConflict({ legNumber: 2, legCount: 2 }, [{ legNumber: 1, legCount: 2 }])).toBeNull()
    })

    test('the same number again is a conflict naming the leg', () => {
      expect(siblingConflict({ legNumber: 1, legCount: 2 }, [{ legNumber: 1, legCount: 2 }])).toBe(
        'Leg 1 of 2 of this order was already sent.'
      )
      expect(LEG_TAKEN_SENTENCE(1, 2)).toBe('Leg 1 of 2 of this order was already sent.')
    })

    test('cross check 2: a count that differs from a sibling is a conflict, even for a free number', () => {
      expect(siblingConflict({ legNumber: 2, legCount: 3 }, [{ legNumber: 1, legCount: 2 }])).toBe(
        'This order was sent as 2 legs; leg 2 of 3 does not match.'
      )
    })

    test('a single delivery with the same reference (no labels) is not a sibling', () => {
      expect(siblingConflict({ legNumber: 1, legCount: 2 }, [{ legNumber: null, legCount: null }])).toBeNull()
    })
  })

  describe('cross check 5: missingLegNumbers', () => {
    test('a 3 leg order with only leg 1 misses 2 and 3', () => {
      expect(missingLegNumbers(3, [{ legNumber: 1, legCount: 3 }])).toEqual([2, 3])
    })

    test('a complete order misses nothing', () => {
      expect(
        missingLegNumbers(2, [
          { legNumber: 1, legCount: 2 },
          { legNumber: 2, legCount: 2 },
        ])
      ).toEqual([])
    })

    test('a missing first leg is found too', () => {
      expect(missingLegNumbers(2, [{ legNumber: 2, legCount: 2 }])).toEqual([1])
    })

    test('a single delivery (no count) misses nothing', () => {
      expect(missingLegNumbers(null, [])).toEqual([])
    })
  })

  // ==========================================================================
  // The partner create route's service (AC-1, key invariants, cross checks 1 and 2)
  // ==========================================================================
  describe('partner create (DeliveryPartnerRestApiService.create)', () => {
    const partnerId = 'partner-legs'
    const NOW = new Date('2026-11-21T12:00:00.000Z')
    let service: DeliveryPartnerRestApiService
    let quotes: any
    let deliveries: any
    let partners: any
    let locations: any
    let conversion: any

    const partner = new PartnerEntity({
      id: partnerId,
      name: 'To Steki',
      logo: null,
      phoneNumber: '+302421012345',
      webhookUrl: null,
      usualPrepMinutes: 15,
      busyExtraMinutes: null,
      pausedUntil: null,
      disabledAt: null,
      disabledReason: null,
      userId: 'user-1',
      pickupLocationId: 'loc-1',
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
    } as any)

    const input = (overrides: Record<string, unknown> = {}): any => ({
      quoteId: 'quote-leg',
      orderReference: 'order-77',
      pickupAddress: {},
      dropoffAddress: {},
      ...overrides,
    })

    beforeEach(() => {
      jest.useFakeTimers('modern')
      jest.setSystemTime(NOW)
      quotes = {
        getByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'quote-leg',
          expiresAt: new Date(NOW.getTime() + 10 * 60_000),
          pickupLocationId: 'loc-pickup',
          dropoffLocationId: 'loc-dropoff',
        }),
      }
      deliveries = {
        getByDeliveryQuoteId: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'del-leg' }),
        getOrderLegsOf: jest.fn().mockResolvedValue([]),
      }
      partners = { getById: jest.fn().mockResolvedValue(partner) }
      locations = {
        getByIds: jest.fn().mockResolvedValue([{ id: 'loc-pickup' }, { id: 'loc-dropoff' }]),
        findOrCreate: jest.fn().mockResolvedValue({ id: 'loc-1' }),
      }
      conversion = { isValidDeliveryLocationDrift: jest.fn().mockReturnValue(true) }
      service = new DeliveryPartnerRestApiService(
        quotes,
        deliveries,
        partners,
        locations,
        { getByIdWithSettings: jest.fn() } as any,
        conversion,
        { findOn: jest.fn().mockResolvedValue(null) } as any,
        { instanceConfig: { getRestaurantHistoryDays: async () => 30 } } as any,
        {} as any,
        {} as any
      )
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    // verify.md: "One label alone, leg 3 of 2, a count of 5 → 400, each with its sentence".
    test.each([
      ['legNumber alone', { legNumber: 1 }, BOTH_OR_NEITHER],
      ['legCount alone', { legCount: 2 }, BOTH_OR_NEITHER],
      ['leg 3 of 2', { legNumber: 3, legCount: 2 }, 'legNumber must be from 1 to legCount (2).'],
      ['a count of 5', { legNumber: 1, legCount: 5 }, 'legCount must be from 2 to 4.'],
      ['a count of 1', { legNumber: 1, legCount: 1 }, 'legCount must be from 2 to 4.'],
      ['leg 0 of 2', { legNumber: 0, legCount: 2 }, 'legNumber must be from 1 to legCount (2).'],
    ])('%s answers 400 with its sentence, and nothing is read or created', async (_name, labels, sentence) => {
      const call = service.create(partnerId, input(labels))

      await expect(call).rejects.toBeInstanceOf(BadRequestException)
      await expect(call).rejects.toMatchObject({ status: 400, message: sentence })
      expect(deliveries.getOrderLegsOf).not.toHaveBeenCalled()
      expect(quotes.getByIdOrThrow).not.toHaveBeenCalled()
      expect(locations.findOrCreate).not.toHaveBeenCalled()
      expect(deliveries.create).not.toHaveBeenCalled()
    })

    test('leg 1 of 2 is created with both labels, after its siblings were read by restaurant and reference', async () => {
      const created = await service.create(partnerId, input({ legNumber: 1, legCount: 2 }))

      expect(created).toEqual({ id: 'del-leg' })
      expect(deliveries.getOrderLegsOf).toHaveBeenCalledWith(partnerId, 'order-77')
      expect(deliveries.create).toHaveBeenCalledTimes(1)
      expect(deliveries.create).toHaveBeenCalledWith(expect.objectContaining({ legNumber: 1, legCount: 2 }))
    })

    test('a single delivery is created with both labels null and reads no siblings', async () => {
      await service.create(partnerId, input())

      expect(deliveries.getOrderLegsOf).not.toHaveBeenCalled()
      expect(deliveries.create).toHaveBeenCalledWith(expect.objectContaining({ legNumber: null, legCount: null }))
    })

    test('JSON nulls for both labels are a single delivery', async () => {
      await service.create(partnerId, input({ legNumber: null, legCount: null }))

      expect(deliveries.create).toHaveBeenCalledWith(expect.objectContaining({ legNumber: null, legCount: null }))
    })

    test('key invariants: leg 1 sent twice answers 409 and creates nothing', async () => {
      deliveries.getOrderLegsOf.mockResolvedValue([{ id: 'del-1', legNumber: 1, legCount: 2 }])

      const call = service.create(partnerId, input({ legNumber: 1, legCount: 2 }))

      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({ status: 409, message: 'Leg 1 of 2 of this order was already sent.' })
      expect(quotes.getByIdOrThrow).not.toHaveBeenCalled()
      expect(deliveries.create).not.toHaveBeenCalled()
    })

    test('cross check 2: leg 2 of 3 after a 2 leg order answers 409 and creates nothing', async () => {
      deliveries.getOrderLegsOf.mockResolvedValue([{ id: 'del-1', legNumber: 1, legCount: 2 }])

      const call = service.create(partnerId, input({ legNumber: 2, legCount: 3 }))

      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({
        status: 409,
        message: 'This order was sent as 2 legs; leg 2 of 3 does not match.',
      })
      expect(deliveries.create).not.toHaveBeenCalled()
    })

    test('leg 2 of 2 after leg 1 of 2 is created', async () => {
      deliveries.getOrderLegsOf.mockResolvedValue([{ id: 'del-1', legNumber: 1, legCount: 2 }])

      await service.create(partnerId, input({ legNumber: 2, legCount: 2 }))

      expect(deliveries.create).toHaveBeenCalledWith(expect.objectContaining({ legNumber: 2, legCount: 2 }))
    })

    // Cross check 1: two creates of one leg at once both pass the read; the unique index refuses one.
    test.each([
      ['a list of columns', ['partnerId', 'orderReference', 'legNumber']],
      ['the index name', 'Delivery_partnerId_orderReference_legNumber_key'],
    ])('cross check 1: the unique index refusing a leg (target as %s) answers 409 with the leg sentence', async (_name, target) => {
      deliveries.create.mockRejectedValue(uniqueConstraintError(target))

      const call = service.create(partnerId, input({ legNumber: 2, legCount: 2 }))

      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({ status: 409, message: 'Leg 2 of 2 of this order was already sent.' })
    })

    test('a unique error on another index (the idempotency key) is passed on unchanged for a leg', async () => {
      const error = uniqueConstraintError(['idempotencyKey', 'partnerId'])
      deliveries.create.mockRejectedValue(error)

      await expect(service.create(partnerId, input({ legNumber: 2, legCount: 2 }))).rejects.toBe(error)
    })

    test('any other error from the create is passed on unchanged for a leg', async () => {
      const error = new Error('database is away')
      deliveries.create.mockRejectedValue(error)

      await expect(service.create(partnerId, input({ legNumber: 2, legCount: 2 }))).rejects.toBe(error)
    })

    test('a single delivery never gets the leg sentence, whatever the unique error names', async () => {
      const error = uniqueConstraintError(['partnerId', 'orderReference', 'legNumber'])
      deliveries.create.mockRejectedValue(error)

      await expect(service.create(partnerId, input())).rejects.toBe(error)
    })
  })

  // ==========================================================================
  // Cross check 2: the partner update cannot move a leg to another order
  // ==========================================================================
  describe('partner update (cross check 2)', () => {
    const partnerId = 'partner-legs'
    let service: DeliveryPartnerRestApiService
    let deliveries: any

    const stored = (overrides: Record<string, unknown> = {}) => ({
      id: 'del-leg-1',
      partnerId,
      status: EnumDeliveryStatus.CREATED,
      createdAt: new Date(),
      dropoffLocationId: 'loc-1',
      orderReference: 'order-77',
      legNumber: 1,
      legCount: 2,
      ...overrides,
    })
    const body = (orderReference: string): any => ({ orderReference, dropoffLatitude: 39.36, dropoffLongitude: 22.94 })

    beforeEach(() => {
      deliveries = {
        getByIdOrThrow: jest.fn().mockResolvedValue(stored()),
        update: jest.fn().mockResolvedValue({ id: 'del-leg-1' }),
        changeBoxSize: jest.fn(),
      }
      service = new DeliveryPartnerRestApiService(
        { getByIdOrThrow: jest.fn() } as any,
        deliveries,
        {} as any,
        { getById: jest.fn().mockResolvedValue({ id: 'loc-1', latitude: 39.36, longitude: 22.94 }) } as any,
        {} as any,
        {} as any,
        { findOn: jest.fn().mockResolvedValue(null) } as any,
        { instanceConfig: { getRestaurantHistoryDays: async () => 30 } } as any,
        { recordDropoffPointCorrectedEvent: jest.fn() } as any,
        {} as any
      )
    })

    test('a new orderReference on a leg answers 409 with the sentence and writes nothing', async () => {
      const call = service.update('del-leg-1', partnerId, body('another-order'))

      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({ status: 409, message: LEG_LOCKED })
      expect(LEG_LABELS_LOCKED_SENTENCE).toBe(LEG_LOCKED)
      expect(deliveries.update).not.toHaveBeenCalled()
      expect(deliveries.changeBoxSize).not.toHaveBeenCalled()
    })

    test('the same orderReference on a leg is updated as usual', async () => {
      await service.update('del-leg-1', partnerId, body('order-77'))

      expect(deliveries.update).toHaveBeenCalledWith('del-leg-1', expect.objectContaining({ orderReference: 'order-77' }))
    })

    test('a single delivery may still change its orderReference', async () => {
      deliveries.getByIdOrThrow.mockResolvedValue(stored({ legNumber: null, legCount: null }))

      await service.update('del-leg-1', partnerId, body('another-order'))

      expect(deliveries.update).toHaveBeenCalledWith(
        'del-leg-1',
        expect.objectContaining({ orderReference: 'another-order' })
      )
    })

    test('the update never writes a leg number or count (the route does not take them)', async () => {
      await service.update('del-leg-1', partnerId, { ...body('order-77'), legNumber: 2, legCount: 4 })

      const written = deliveries.update.mock.calls[0][1]
      expect(written).not.toHaveProperty('legNumber')
      expect(written).not.toHaveProperty('legCount')
    })
  })

  // ==========================================================================
  // AC-3, AC-6: GET partner/v1/deliveries/:id/order-legs
  // ==========================================================================
  describe('the partner order legs route', () => {
    const partnerId = 'partner-legs'
    const legRow = (id: string, legNumber: number, overrides: Record<string, unknown> = {}) => ({
      id,
      partnerId,
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      createdAt: new Date(),
      pickupLocationId: 'loc-p',
      dropoffLocationId: 'loc-d',
      courierId: null,
      orderReference: 'order-77',
      legNumber,
      legCount: 3,
      ...overrides,
    })

    describe('service.getOrderLegsWithRelations', () => {
      let service: DeliveryPartnerRestApiService
      let deliveries: any

      beforeEach(() => {
        deliveries = {
          getById: jest.fn(),
          getOrderLegs: jest.fn(),
        }
        service = new DeliveryPartnerRestApiService(
          {} as any,
          deliveries,
          {} as any,
          { getByIds: jest.fn().mockResolvedValue([{ id: 'loc-p' }, { id: 'loc-d' }]) } as any,
          { getByIdWithSettings: jest.fn() } as any,
          {} as any,
          { findOn: jest.fn().mockResolvedValue(null) } as any,
          { instanceConfig: { getRestaurantHistoryDays: async () => 30 } } as any,
          {} as any,
          {} as any
        )
      })

      test('lists every leg with its locations, by the order the domain gave, and the numbers never sent', async () => {
        const one = legRow('del-1', 1)
        const three = legRow('del-3', 3)
        deliveries.getById.mockImplementation(async (id: string) => (id === 'del-1' ? one : id === 'del-3' ? three : null))
        deliveries.getOrderLegs.mockResolvedValue({
          legs: [
            { id: 'del-1', legNumber: 1, legCount: 3 },
            { id: 'del-3', legNumber: 3, legCount: 3 },
          ],
          missingLegNumbers: [2],
        })

        const result = await service.getOrderLegsWithRelations('del-3', partnerId)

        expect(deliveries.getOrderLegs).toHaveBeenCalledWith(three)
        expect(result.missingLegNumbers).toEqual([2])
        expect(result.legs.map((leg) => leg.delivery.id)).toEqual(['del-1', 'del-3'])
        expect(result.legs[0]!.pickupLocation).toEqual({ id: 'loc-p' })
        expect(result.legs[0]!.dropoffLocation).toEqual({ id: 'loc-d' })
      })

      test("security model: another restaurant's delivery answers 404 and no legs are read", async () => {
        deliveries.getById.mockResolvedValue(legRow('del-other', 1, { partnerId: 'partner-other' }))

        await expect(service.getOrderLegsWithRelations('del-other', partnerId)).rejects.toBeInstanceOf(
          DeliveryNotFoundException
        )
        expect(deliveries.getOrderLegs).not.toHaveBeenCalled()
      })

      test('a single delivery has no legs and no missing numbers', async () => {
        deliveries.getById.mockResolvedValue(legRow('del-single', 1, { legNumber: null, legCount: null }))
        deliveries.getOrderLegs.mockResolvedValue({ legs: [], missingLegNumbers: [] })

        await expect(service.getOrderLegsWithRelations('del-single', partnerId)).resolves.toEqual({
          legs: [],
          missingLegNumbers: [],
        })
      })
    })

    describe('controller.getOrderLegs', () => {
      test("asks for the caller's own restaurant and answers the legs as partner DTOs with the missing numbers", async () => {
        const restApiService: any = {
          getOrderLegsWithRelations: jest.fn().mockResolvedValue({
            legs: [
              {
                delivery: new DeliveryEntity(legRow('del-1', 1) as any),
                courierWithSettings: null,
                pickupLocation: undefined,
                dropoffLocation: undefined,
              },
            ],
            missingLegNumbers: [2, 3],
          }),
        }
        const controller = new DeliveryPartnerRestApiController(restApiService, {} as any)

        const answer = await controller.getOrderLegs('del-1', new PartnerEntity({ id: partnerId } as any))

        expect(restApiService.getOrderLegsWithRelations).toHaveBeenCalledWith('del-1', partnerId)
        expect(answer.missingLegNumbers).toEqual([2, 3])
        expect(answer.legs).toHaveLength(1)
        expect(answer.legs[0]).toBeInstanceOf(DeliveryPartnerDto)
        expect(answer.legs[0]).toMatchObject({ id: 'del-1', legNumber: 1, legCount: 3, orderReference: 'order-77' })
      })
    })
  })

  // ==========================================================================
  // The domain service: reading an order's legs, and the two admin paths (AC-4, AC-6, AC-8)
  // ==========================================================================
  describe('DeliveryDomainService', () => {
    let service: DeliveryDomainService
    let deliveryRepository: any
    let deliveryEventService: any
    let courierRepository: any
    let compensationRepository: any

    beforeEach(() => {
      deliveryRepository = {
        findByIdOrThrow: jest.fn(),
        findOrderLegs: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async (data: any) => ({ id: 'del-new', status: 'CREATED', ...data })),
      }
      deliveryEventService = {
        processDeliveryEvent: jest.fn().mockResolvedValue(undefined),
        recordBoxEvent: jest.fn().mockResolvedValue(undefined),
        refuseIfDispatchStopped: jest.fn().mockResolvedValue(undefined),
        refuseIfCourierInSos: jest.fn().mockResolvedValue(undefined),
        refuseIfCourierDeactivated: jest.fn().mockResolvedValue(undefined),
        refuseIfCourierHoldsSiblingLeg: jest.fn().mockResolvedValue(undefined),
        offerDeliveryToCourierAsAdmin: jest.fn().mockResolvedValue({ heldUnits: 0, deliveryUnits: 50 }),
        hasSuccessfulReassignedWithMessage: jest.fn().mockResolvedValue(true),
      }
      courierRepository = {
        findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'courier-new' }),
        heldBoxUnits: jest.fn().mockResolvedValue(0),
      }
      compensationRepository = {
        create: jest.fn().mockResolvedValue({ id: 'comp-1' }),
        deleteById: jest.fn().mockResolvedValue(undefined),
      }
      service = new DeliveryDomainService(
        deliveryRepository,
        { emit: jest.fn() } as any,
        { getOrDefault: jest.fn().mockResolvedValue([]), save: jest.fn().mockResolvedValue(undefined) } as any,
        deliveryEventService,
        courierRepository,
        compensationRepository,
        {
          instanceConfig: {
            getBoxDefaultSize: jest.fn().mockResolvedValue('MEDIUM'),
            getBoxUnitsSmall: jest.fn().mockResolvedValue(30),
            getBoxUnitsMedium: jest.fn().mockResolvedValue(50),
            getBoxUnitsLarge: jest.fn().mockResolvedValue(100),
            getReassignmentPayoutPolicies: jest.fn().mockResolvedValue({ FULL_COMPENSATION: 100 }),
            getReassignmentPayoutDefaultPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
          },
        } as any,
        { findById: jest.fn().mockResolvedValue(null) } as any
      )
    })

    test('AC-1: create hands both labels to the repository', async () => {
      await service.create({
        partnerId: 'partner-1',
        pickupLocationId: 'loc-1',
        dropoffLocationId: 'loc-2',
        boxSize: 'SMALL',
        legNumber: 2,
        legCount: 3,
      } as any)

      expect(deliveryRepository.create).toHaveBeenCalledWith(expect.objectContaining({ legNumber: 2, legCount: 3 }))
    })

    describe('getOrderLegsOf', () => {
      test('reads the legs by restaurant and reference', async () => {
        const legs = [{ id: 'del-1', legNumber: 1, legCount: 2 }]
        deliveryRepository.findOrderLegs.mockResolvedValue(legs)

        await expect(service.getOrderLegsOf('partner-1', 'order-77')).resolves.toBe(legs)
        expect(deliveryRepository.findOrderLegs).toHaveBeenCalledWith('partner-1', 'order-77')
      })

      test.each([[null], [undefined], ['']])('no reference (%p) has no legs and reads nothing', async (reference) => {
        await expect(service.getOrderLegsOf('partner-1', reference)).resolves.toEqual([])
        expect(deliveryRepository.findOrderLegs).not.toHaveBeenCalled()
      })
    })

    describe('getOrderLegs (AC-6, cross check 5)', () => {
      test('a leg gets its order\'s legs and the numbers never created', async () => {
        const legs = [{ id: 'del-1', legNumber: 1, legCount: 3, status: 'CREATED', courierId: null, courierName: null }]
        deliveryRepository.findOrderLegs.mockResolvedValue(legs)

        const order = await service.getOrderLegs({
          id: 'del-1',
          partnerId: 'partner-1',
          orderReference: 'order-77',
          legNumber: 1,
          legCount: 3,
        } as any)

        expect(deliveryRepository.findOrderLegs).toHaveBeenCalledWith('partner-1', 'order-77')
        expect(order).toEqual({ legs, missingLegNumbers: [2, 3] })
      })

      test('a single delivery has none, and nothing is read', async () => {
        const order = await service.getOrderLegs({
          id: 'del-single',
          partnerId: 'partner-1',
          orderReference: 'order-78',
          legNumber: null,
          legCount: null,
        } as any)

        expect(order).toEqual({ legs: [], missingLegNumbers: [] })
        expect(deliveryRepository.findOrderLegs).not.toHaveBeenCalled()
      })
    })

    // AC-4, AC-8, cross check 3: an admin assignment that would give one rider two legs is 409.
    describe('admin hand offer (submitDeliveryEvent ACCEPTED)', () => {
      const admin = { id: 'admin-1', email: 'admin@coop.gr', username: 'coordinator' }
      const waitingLeg = { id: 'del-leg-2', status: EnumDeliveryStatus.CREATED, matchedCourierId: null, courierId: null, boxUnits: 50 }
      const handOffer = (confirmOverCapacity?: boolean) =>
        service.submitDeliveryEvent(
          {
            deliveryId: 'del-leg-2',
            eventType: EnumDeliveryEventType.ACCEPTED,
            courierId: 'courier-leg-1',
            ...(confirmOverCapacity === undefined ? {} : { confirmOverCapacity }),
          } as any,
          'by hand',
          admin
        )

      beforeEach(() => {
        deliveryRepository.findByIdOrThrow.mockResolvedValue(waitingLeg)
      })

      test('asks whether this rider holds a sibling of this delivery', async () => {
        await handOffer()

        expect(deliveryEventService.refuseIfCourierHoldsSiblingLeg).toHaveBeenCalledWith('courier-leg-1', 'del-leg-2')
        expect(deliveryEventService.offerDeliveryToCourierAsAdmin).toHaveBeenCalledTimes(1)
      })

      test('the rider holds leg 1: 409, and nothing is offered or recorded', async () => {
        deliveryEventService.refuseIfCourierHoldsSiblingLeg.mockRejectedValue(
          new ConflictException(SIBLING_LEG_HELD_SENTENCE)
        )

        const call = handOffer()

        await expect(call).rejects.toBeInstanceOf(ConflictException)
        await expect(call).rejects.toMatchObject({ status: 409, message: RIDER_HOLDS_SIBLING })
        expect(deliveryEventService.offerDeliveryToCourierAsAdmin).not.toHaveBeenCalled()
        expect(deliveryEventService.recordBoxEvent).not.toHaveBeenCalled()
        expect(deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      })

      test('cross check 3: confirmOverCapacity does not let it through', async () => {
        deliveryEventService.refuseIfCourierHoldsSiblingLeg.mockRejectedValue(
          new ConflictException(SIBLING_LEG_HELD_SENTENCE)
        )

        await expect(handOffer(true)).rejects.toMatchObject({ status: 409, message: RIDER_HOLDS_SIBLING })
        expect(deliveryEventService.refuseIfCourierHoldsSiblingLeg).toHaveBeenCalledWith('courier-leg-1', 'del-leg-2')
        expect(deliveryEventService.offerDeliveryToCourierAsAdmin).not.toHaveBeenCalled()
        expect(deliveryEventService.recordBoxEvent).not.toHaveBeenCalled()
      })

      test('a full box and a sibling leg together answer the sibling sentence, not the box confirmation', async () => {
        // A box refusal invites "confirm and send anyway"; for a sibling leg that button must never appear.
        courierRepository.heldBoxUnits.mockResolvedValue(100)
        deliveryEventService.refuseIfCourierHoldsSiblingLeg.mockRejectedValue(
          new ConflictException(SIBLING_LEG_HELD_SENTENCE)
        )

        const call = handOffer()

        await expect(call).rejects.not.toBeInstanceOf(BoxOverCapacityException)
        await expect(call).rejects.toMatchObject({ status: 409, message: RIDER_HOLDS_SIBLING })
      })
    })

    describe('admin reassign (reassignDelivery)', () => {
      const carriedLeg = {
        id: 'del-leg-2',
        status: EnumDeliveryStatus.ACCEPTED,
        courierId: 'courier-old',
        matchedCourierId: null,
        boxUnits: 30,
        totalCompensation: 350,
        currencyCode: 'EUR',
      }

      beforeEach(() => {
        deliveryRepository.findByIdOrThrow.mockResolvedValue(carriedLeg)
      })

      test('the new rider carries leg 1: 409 before any award or event', async () => {
        deliveryEventService.refuseIfCourierHoldsSiblingLeg.mockRejectedValue(
          new ConflictException(SIBLING_LEG_HELD_SENTENCE)
        )

        const call = service.reassignDelivery('del-leg-2', 'courier-leg-1', undefined, 'note')

        await expect(call).rejects.toBeInstanceOf(ConflictException)
        await expect(call).rejects.toMatchObject({ status: 409, message: RIDER_HOLDS_SIBLING })
        expect(deliveryEventService.refuseIfCourierHoldsSiblingLeg).toHaveBeenCalledWith('courier-leg-1', 'del-leg-2')
        expect(compensationRepository.create).not.toHaveBeenCalled()
        expect(deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      })

      test('cross check 3: confirmOverCapacity does not let a reassign through either', async () => {
        courierRepository.heldBoxUnits.mockResolvedValue(100)
        deliveryEventService.refuseIfCourierHoldsSiblingLeg.mockRejectedValue(
          new ConflictException(SIBLING_LEG_HELD_SENTENCE)
        )

        const call = service.reassignDelivery('del-leg-2', 'courier-leg-1', undefined, 'note', {
          confirmOverCapacity: true,
          admin: { id: 'admin-1', email: 'admin@coop.gr', username: 'coordinator' },
        })

        await expect(call).rejects.toMatchObject({ status: 409, message: RIDER_HOLDS_SIBLING })
        expect(compensationRepository.create).not.toHaveBeenCalled()
        expect(deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      })
    })
  })

  // ==========================================================================
  // DeliveryEventService: the check, the locked hand offer, the Static matcher's leg
  // ==========================================================================
  describe('DeliveryEventService', () => {
    let service: DeliveryEventService
    let deliveryRepository: any
    let courierRepository: any
    let deliveryEventRepository: any
    let websocketDispatcher: any
    let matching: any

    const waiting = {
      id: 'del-leg-2',
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      partnerId: 'partner-1',
      matchedCourierId: null,
      courierId: null,
      offeredAt: null,
      offerExpiresAt: null,
    }

    beforeEach(() => {
      websocketDispatcher = {
        sendOfferToCourier: jest.fn().mockResolvedValue(undefined),
        sendOfferEnded: jest.fn().mockResolvedValue(undefined),
        dispatchDeliveryStatusUpdated: jest.fn().mockResolvedValue(undefined),
      }
      courierRepository = {
        findById: jest.fn(),
        findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'courier-leg-1', userId: 'user-1' }),
        hasActiveSos: jest.fn().mockResolvedValue(false),
      }
      deliveryRepository = {
        findById: jest.fn().mockResolvedValue(waiting),
        findByIdOrThrow: jest.fn().mockResolvedValue(waiting),
        update: jest.fn().mockResolvedValue(waiting),
        updateIfMatches: jest.fn().mockResolvedValue(true),
        claimOfferWithinBox: jest.fn().mockResolvedValue('CLAIMED'),
        claimForRiderWithinBox: jest.fn().mockResolvedValue({ outcome: 'CLAIMED', heldUnits: 0, deliveryUnits: 50 }),
        holdsSiblingLeg: jest.fn().mockResolvedValue(false),
      }
      deliveryEventRepository = {
        create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
        findLatestOfTypes: jest.fn().mockResolvedValue(null),
      }
      matching = { findCourierForDelivery: jest.fn() }
      service = new DeliveryEventService(
        { get: jest.fn() } as any,
        websocketDispatcher,
        courierRepository,
        deliveryRepository,
        deliveryEventRepository,
        { scheduleTask: jest.fn().mockResolvedValue(undefined) } as any,
        { registerTaskHandler: jest.fn() } as any,
        { sendDeliveryUpdatePartnerWebhook: jest.fn().mockResolvedValue(undefined) } as any,
        matching,
        {
          calculateDeliveryAmountsForMatchedCourier: jest
            .fn()
            .mockResolvedValue({ totalCost: 1000, totalCompensation: 800, fee: 200, feePercentage: 20 }),
        } as any,
        { addJob: jest.fn().mockResolvedValue({ id: 'job-1' }), removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue([]) } as any,
        {
          instanceConfig: {
            getOfferExpiryEnabled: jest.fn().mockResolvedValue(true),
            getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
            getOfferExpirySeconds: jest.fn().mockResolvedValue(20),
            getNoCourierRetrySeconds: jest.fn().mockResolvedValue(30),
          },
        } as any,
        { getOrDefault: jest.fn().mockResolvedValue([]), save: jest.fn().mockResolvedValue(undefined) } as any,
        { newOffer: jest.fn(), offerEnded: jest.fn() } as any,
        { findOn: jest.fn().mockResolvedValue(null) } as any,
        { getRoute: jest.fn() } as any,
        {} as any,
        {} as any,
        { closeOpenForDelivery: jest.fn().mockResolvedValue(undefined) } as any
      )
    })

    describe('refuseIfCourierHoldsSiblingLeg', () => {
      test('409 with the sentence when the rider holds another leg of the order', async () => {
        deliveryRepository.holdsSiblingLeg.mockResolvedValue(true)

        const call = service.refuseIfCourierHoldsSiblingLeg('courier-leg-1', 'del-leg-2')

        await expect(call).rejects.toBeInstanceOf(ConflictException)
        await expect(call).rejects.toMatchObject({ status: 409, message: RIDER_HOLDS_SIBLING })
        expect(deliveryRepository.holdsSiblingLeg).toHaveBeenCalledWith('courier-leg-1', 'del-leg-2')
        expect(SIBLING_LEG_HELD_SENTENCE).toBe(RIDER_HOLDS_SIBLING)
      })

      test('passes when the rider holds none', async () => {
        await expect(service.refuseIfCourierHoldsSiblingLeg('courier-free', 'del-leg-2')).resolves.toBeUndefined()
      })
    })

    describe('offerDeliveryToCourierAsAdmin (the write under the rider\'s lock)', () => {
      const siblingHeld = { outcome: 'SIBLING_LEG', heldUnits: 0, deliveryUnits: 0 }

      test('SIBLING_LEG answers 409 with the sentence; no event, no offer sent', async () => {
        deliveryRepository.claimForRiderWithinBox.mockResolvedValue(siblingHeld)

        const call = service.offerDeliveryToCourierAsAdmin('del-leg-2', 'courier-leg-1')

        await expect(call).rejects.toBeInstanceOf(ConflictException)
        await expect(call).rejects.toMatchObject({ status: 409, message: RIDER_HOLDS_SIBLING })
        expect(deliveryEventRepository.create).not.toHaveBeenCalled()
        expect(websocketDispatcher.sendOfferToCourier).not.toHaveBeenCalled()
      })

      test('cross check 3: with confirmOverCapacity true it is still 409, never the box answer', async () => {
        deliveryRepository.claimForRiderWithinBox.mockResolvedValue(siblingHeld)

        const call = service.offerDeliveryToCourierAsAdmin('del-leg-2', 'courier-leg-1', 'by hand', true, 'admin-1')

        await expect(call).rejects.not.toBeInstanceOf(BoxOverCapacityException)
        await expect(call).rejects.toMatchObject({ status: 409, message: RIDER_HOLDS_SIBLING })
        expect(deliveryEventRepository.create).not.toHaveBeenCalled()
        expect(websocketDispatcher.sendOfferToCourier).not.toHaveBeenCalled()
      })
    })

    describe('the matcher naming a rider who holds a sibling leg (Static matcher)', () => {
      test('the leg is not offered to them and waits, as if no rider were free', async () => {
        matching.findCourierForDelivery.mockResolvedValue({
          courier: { id: 'courier-leg-1', userId: 'user-1' },
          delivery: waiting,
          pickupLocation: {},
          travelSeconds: null,
        })
        deliveryRepository.claimOfferWithinBox.mockResolvedValue('SIBLING_LEG')

        const result = await (service as any).offerToNextCourier('del-leg-2')

        expect(deliveryRepository.claimOfferWithinBox).toHaveBeenCalledTimes(1)
        expect(result).toBe('NO_COURIER')
        expect(websocketDispatcher.sendOfferToCourier).not.toHaveBeenCalled()
        // No offer went out, so nothing was written about one.
        expect(deliveryRepository.update).not.toHaveBeenCalled()
        expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      })
    })
  })

  // ==========================================================================
  // The repository: the claim under the rider's lock, the plain check, the legs read
  // ==========================================================================
  describe('DeliveryRepository', () => {
    let tx: any
    let prisma: any
    let repository: DeliveryRepository

    beforeEach(() => {
      tx = {
        $queryRaw: jest.fn(),
        delivery: { findUnique: jest.fn().mockResolvedValue({ boxUnits: 30 }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      }
      prisma = {
        $transaction: jest.fn((callback: any) => callback(tx)),
        $queryRaw: jest.fn(),
        delivery: { findMany: jest.fn().mockResolvedValue([]) },
      }
      repository = new DeliveryRepository(prisma)
    })

    const where = { status: EnumDeliveryStatus.ASSIGNING_COURIER }
    const data = { matchedCourierId: 'courier-1' }
    const sqlOf = (call: any[]): string => (call[0]?.sql ?? (Array.isArray(call[0]) ? call[0].join('?') : String(call[0])))

    describe('claimForRiderWithinBox (AC-4, AC-8, cross check 3)', () => {
      test('a rider holding a sibling leg: SIBLING_LEG, and nothing is written', async () => {
        tx.$queryRaw.mockResolvedValueOnce([{ deactivated: false }]).mockResolvedValueOnce([{ exists: true }])

        const claim = await repository.claimForRiderWithinBox('del-leg-2', 'courier-1', where, data, false)

        expect(claim).toEqual({ outcome: 'SIBLING_LEG', heldUnits: 0, deliveryUnits: 0 })
        expect(tx.delivery.updateMany).not.toHaveBeenCalled()
      })

      test('cross check 3: allowOverCapacity (the admin\'s confirm) never bypasses it', async () => {
        tx.$queryRaw
          .mockResolvedValueOnce([{ deactivated: false }])
          .mockResolvedValueOnce([{ exists: true }])
          .mockResolvedValueOnce([{ held: 0 }])

        const claim = await repository.claimForRiderWithinBox('del-leg-2', 'courier-1', where, data, true)

        expect(claim.outcome).toBe('SIBLING_LEG')
        expect(tx.delivery.updateMany).not.toHaveBeenCalled()
      })

      test('the matcher\'s claim (claimOfferWithinBox) answers SIBLING_LEG too', async () => {
        tx.$queryRaw.mockResolvedValueOnce([{ deactivated: false }]).mockResolvedValueOnce([{ exists: true }])

        await expect(repository.claimOfferWithinBox('del-leg-2', 'courier-1', where, data)).resolves.toBe('SIBLING_LEG')
        expect(tx.delivery.updateMany).not.toHaveBeenCalled()
      })

      test('the sibling question is asked inside the transaction, after the rider\'s row lock and before the write', async () => {
        tx.$queryRaw
          .mockResolvedValueOnce([{ deactivated: false }])
          .mockResolvedValueOnce([{ exists: false }])
          .mockResolvedValueOnce([{ held: 0 }])

        const claim = await repository.claimForRiderWithinBox('del-leg-2', 'courier-1', where, data, false)

        expect(claim.outcome).toBe('CLAIMED')
        expect(prisma.$queryRaw).not.toHaveBeenCalled()
        expect(sqlOf(tx.$queryRaw.mock.calls[0])).toContain('FOR UPDATE')
        const second: Prisma.Sql = tx.$queryRaw.mock.calls[1][0]
        expect(second.sql).toBe(siblingLegHeldSql(Prisma.sql`${'courier-1'}`, 'del-leg-2').sql)
        expect(second.values).toEqual(siblingLegHeldSql(Prisma.sql`${'courier-1'}`, 'del-leg-2').values)
        expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.delivery.updateMany.mock.invocationCallOrder[0])
      })

      test('a rider with no sibling leg is claimed as before', async () => {
        tx.$queryRaw
          .mockResolvedValueOnce([{ deactivated: false }])
          .mockResolvedValueOnce([{ exists: false }])
          .mockResolvedValueOnce([{ held: 20 }])

        const claim = await repository.claimForRiderWithinBox('del-leg-2', 'courier-1', where, data, false)

        expect(claim).toEqual({ outcome: 'CLAIMED', heldUnits: 20, deliveryUnits: 30 })
        expect(tx.delivery.updateMany).toHaveBeenCalledTimes(1)
      })
    })

    describe('holdsSiblingLeg', () => {
      test('true when the database says a sibling leg is held, asked for this rider and delivery', async () => {
        prisma.$queryRaw.mockResolvedValue([{ exists: true }])

        await expect(repository.holdsSiblingLeg('courier-1', 'del-leg-2')).resolves.toBe(true)
        const asked: Prisma.Sql = prisma.$queryRaw.mock.calls[0][0]
        expect(asked.sql).toBe(siblingLegHeldSql(Prisma.sql`${'courier-1'}`, 'del-leg-2').sql)
        expect(asked.values).toContain('courier-1')
        expect(asked.values).toContain('del-leg-2')
      })

      test('false when none is held, or nothing came back', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([{ exists: false }])
        await expect(repository.holdsSiblingLeg('courier-1', 'del-leg-2')).resolves.toBe(false)

        prisma.$queryRaw.mockResolvedValueOnce([])
        await expect(repository.holdsSiblingLeg('courier-1', 'del-leg-2')).resolves.toBe(false)
      })
    })

    // No test here runs SQL against a database (decision 61.20), so the question's text is pinned.
    describe('siblingLegHeldSql (the text of the question)', () => {
      const query = siblingLegHeldSql(Prisma.sql`${'courier-1'}`, 'del-leg-2')
      const text = query.sql.replace(/\s+/g, ' ')

      test('a sibling is another delivery of the same restaurant and reference, both labelled as legs', () => {
        expect(text).toContain('"Delivery"."partnerId" = "target"."partnerId"')
        expect(text).toContain('"Delivery"."orderReference" = "target"."orderReference"')
        expect(text).toContain('"Delivery"."id" <> "target"."id"')
        expect(text).toContain('"Delivery"."legCount" IS NOT NULL')
        expect(text).toContain('"target"."legCount" IS NOT NULL')
      })

      test('the target is the delivery asked about, the holder is the rider asked about', () => {
        expect(text).toMatch(/WHERE "target"\."id" = (\?|\$\d+)/)
        expect(query.values).toContain('del-leg-2')
        expect(query.values.filter((value) => value === 'courier-1').length).toBeGreaterThan(0)
      })

      test('"holds" is the box sense: an open offer, a job up to the drop off, food going back; a finished leg is not held', () => {
        expect(text).toContain('"Delivery"."matchedCourierId" =')
        expect(text).toContain('"Delivery"."courierId" =')
        expect(query.values).toContain(EnumDeliveryStatus.ASSIGNING_COURIER)
        expect(query.values).toContain(EnumDeliveryStatus.ACCEPTED)
        expect(query.values).toContain(EnumDeliveryStatus.PICKED_UP)
        // Cross check 3: a rider who finished leg 1 may later be offered leg 2.
        expect(query.values).not.toContain(EnumDeliveryStatus.DROPPED_OFF)
      })

      test('the "holds" alternatives are bracketed as one condition, so the target and leg checks bind to all of them', () => {
        expect(text).toMatch(/"target"\."legCount" IS NOT NULL AND \(\(/)
        expect(text).toMatch(/\)\) \)$/)
      })
    })

    describe('findOrderLegs (AC-6, key invariants)', () => {
      test('reads the labelled deliveries of that restaurant and reference, by leg number', async () => {
        await repository.findOrderLegs('partner-1', 'order-77')

        const args = prisma.delivery.findMany.mock.calls[0][0]
        expect(args.where).toEqual({ partnerId: 'partner-1', orderReference: 'order-77', legCount: { not: null } })
        expect(args.orderBy).toEqual({ legNumber: 'asc' })
      })

      test('each leg comes back with its status and its rider\'s name, or none', async () => {
        prisma.delivery.findMany.mockResolvedValue([
          {
            id: 'del-1',
            legNumber: 1,
            legCount: 2,
            status: EnumDeliveryStatus.ACCEPTED,
            courierId: 'courier-1',
            courier: { firstName: 'Maria', lastName: 'Papadopoulou' },
          },
          { id: 'del-2', legNumber: 2, legCount: 2, status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId: null, courier: null },
        ])

        await expect(repository.findOrderLegs('partner-1', 'order-77')).resolves.toEqual([
          {
            id: 'del-1',
            legNumber: 1,
            legCount: 2,
            status: EnumDeliveryStatus.ACCEPTED,
            courierId: 'courier-1',
            courierName: 'Maria Papadopoulou',
          },
          {
            id: 'del-2',
            legNumber: 2,
            legCount: 2,
            status: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId: null,
            courierName: null,
          },
        ])
      })
    })
  })

  // ==========================================================================
  // What each audience reads (AC-6, AC-7)
  // ==========================================================================
  describe('the labels in what each audience reads', () => {
    const row = (overrides: Record<string, unknown> = {}): any => ({
      id: 'del-1',
      status: EnumDeliveryStatus.ACCEPTED,
      partnerId: 'partner-1',
      orderReference: 'order-77',
      pickupLocationId: 'loc-1',
      dropoffLocationId: 'loc-2',
      pickupLocation: null,
      dropoffLocation: null,
      customerNotes: [],
      boxSize: 'MEDIUM',
      boxUnits: 50,
      boxSizeAssumed: false,
      createdAt: new Date('2026-11-21T10:00:00Z'),
      updatedAt: new Date('2026-11-21T10:00:00Z'),
      legNumber: 1,
      legCount: 2,
      ...overrides,
    })

    test('both entities copy the labels, and give null for a single delivery', () => {
      expect(new DeliveryEntity(row())).toMatchObject({ legNumber: 1, legCount: 2 })
      expect(new DeliveryWithLocationsEntity(row())).toMatchObject({ legNumber: 1, legCount: 2 })
      expect(new DeliveryEntity(row({ legNumber: null, legCount: null }))).toMatchObject({ legNumber: null, legCount: null })
      expect(new DeliveryWithLocationsEntity(row({ legNumber: null, legCount: null }))).toMatchObject({
        legNumber: null,
        legCount: null,
      })
    })

    test.each([
      ['the rider (AC-7)', (data: any) => new DeliveryCourierDto(data)],
      ['the restaurant (AC-6)', (data: any) => new DeliveryPartnerDto(data)],
      ['the admin (AC-6)', (data: any) => new DeliveryAdminDto(data)],
    ])('%s reads "leg 1 of 2" as two numbers, and null for a single delivery', (_name, build) => {
      expect(build(new DeliveryEntity(row()))).toMatchObject({ legNumber: 1, legCount: 2 })
      expect(build(new DeliveryEntity(row({ legNumber: null, legCount: null })))).toMatchObject({
        legNumber: null,
        legCount: null,
      })
    })

    test('the admin list answer carries no legs of its own (only the delivery page asks)', () => {
      const dto = new DeliveryAdminDto(new DeliveryEntity(row()))
      expect(dto.orderLegs).toEqual([])
      expect(dto.missingLegNumbers).toEqual([])
    })

    describe('the admin delivery page (cross check 5)', () => {
      const build = (order: { legs: any[]; missingLegNumbers: number[] }, delivery = new DeliveryEntity(row({ legCount: 3 }))) => {
        const domain: any = {
          getByIdOrThrowWithQuote: jest.fn().mockResolvedValue({ delivery, quote: null }),
          getOfferViews: jest.fn().mockResolvedValue(new Map()),
          getPartnerCharge: jest.fn().mockResolvedValue(null),
          getWaitCharges: jest.fn().mockResolvedValue([]),
          getOfferReasons: jest.fn().mockResolvedValue([]),
          getOrderLegs: jest.fn().mockResolvedValue(order),
        }
        return { domain, controller: new DeliveryAdminRestApiController(domain, {} as any, {} as any, {} as any), delivery }
      }

      test('lists each leg with its status and rider, and the leg numbers never sent', async () => {
        const { controller, domain, delivery } = build({
          legs: [
            {
              id: 'del-1',
              legNumber: 1,
              legCount: 3,
              status: EnumDeliveryStatus.ACCEPTED,
              courierId: 'courier-1',
              courierName: 'Maria Papadopoulou',
            },
          ],
          missingLegNumbers: [2, 3],
        })

        const dto = await controller.getDelivery('del-1')

        expect(domain.getOrderLegs).toHaveBeenCalledWith(delivery)
        expect(dto.legNumber).toBe(1)
        expect(dto.legCount).toBe(3)
        expect(dto.orderLegs).toEqual([
          {
            id: 'del-1',
            legNumber: 1,
            status: EnumDeliveryStatus.ACCEPTED,
            courierId: 'courier-1',
            courierName: 'Maria Papadopoulou',
          },
        ])
        expect(dto.missingLegNumbers).toEqual([2, 3])
      })

      test('a single delivery has empty lists', async () => {
        const { controller } = build(
          { legs: [], missingLegNumbers: [] },
          new DeliveryEntity(row({ legNumber: null, legCount: null }))
        )

        const dto = await controller.getDelivery('del-1')

        expect(dto.orderLegs).toEqual([])
        expect(dto.missingLegNumbers).toEqual([])
      })
    })

    describe('the offer card payload (AC-7, decision 10.2)', () => {
      const source = (legNumber: number | null, legCount: number | null): any => ({
        delivery: {
          id: 'del-card-1',
          offeredAt: new Date('2026-11-21T12:00:00.000Z'),
          offerExpiresAt: new Date('2026-11-21T12:01:00.000Z'),
          totalCompensation: 350,
          currencyCode: 'EUR',
          pickupBusinessName: 'To Steki',
          boxSize: 'LARGE',
          legNumber,
          legCount,
        },
        dropoffLocation: { street: 'Iasonos', houseNumber: '42', city: 'Volos' },
        quote: { distance: 2.34, distanceUnit: EnumDistanceUnit.KILOMETERS },
        trip: { ...UNKNOWN_OFFER_TRIP },
      })
      const options = { serverNow: new Date('2026-11-21T12:00:05.000Z'), insistent: false }

      test('the allow list names legNumber and legCount', () => {
        expect(OFFER_CARD_PAYLOAD_KEYS).toContain('legNumber')
        expect(OFFER_CARD_PAYLOAD_KEYS).toContain('legCount')
      })

      test('a leg sends its number and count as strings', () => {
        const payload = buildOfferCardPayload(source(2, 3), options)

        expect(payload.legNumber).toBe('2')
        expect(payload.legCount).toBe('3')
      })

      test("a single delivery sends '' for both (push data must be strings; '' is \"not known\")", () => {
        const payload = buildOfferCardPayload(source(null, null), options)

        expect(payload.legNumber).toBe('')
        expect(payload.legCount).toBe('')
        // Every value of a push is a string: an undefined or a number would be refused by FCM.
        for (const value of Object.values(payload)) expect(typeof value).toBe('string')
      })

      test('legPayload: half a label is treated as none', () => {
        expect(legPayload({ legNumber: 1, legCount: null })).toEqual({ legNumber: '', legCount: '' })
        expect(legPayload({ legNumber: null, legCount: 2 })).toEqual({ legNumber: '', legCount: '' })
        expect(legPayload({ legNumber: 1, legCount: 2 })).toEqual({ legNumber: '1', legCount: '2' })
      })
    })
  })

  // ==========================================================================
  // AC-1, cross check 1: the schema and its migration (read as text; no database here)
  // ==========================================================================
  describe('the schema and the migration', () => {
    const root = path.resolve(__dirname, '../../..')
    const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8')
    const deliveryModel = schema.slice(schema.indexOf('model Delivery {'), schema.indexOf('\n}', schema.indexOf('model Delivery {')))
    const migration = fs
      .readFileSync(path.join(root, 'prisma/migrations/20261121150000_multi_leg_orders/migration.sql'), 'utf8')
      .replace(/\s+/g, ' ')

    test('Delivery has legNumber Int? and legCount Int?', () => {
      expect(deliveryModel).toMatch(/^\s*legNumber\s+Int\?\s*$/m)
      expect(deliveryModel).toMatch(/^\s*legCount\s+Int\?\s*$/m)
    })

    test('cross check 1: one leg number per restaurant and reference, in the model and in the migration', () => {
      expect(deliveryModel).toContain('@@unique([partnerId, orderReference, legNumber])')
      expect(migration).toMatch(/CREATE UNIQUE INDEX "[^"]+" ON "Delivery"\("partnerId", "orderReference", "legNumber"\)/)
    })

    test('the database itself refuses labels that do not go together or are out of range', () => {
      expect(migration).toContain('ADD CONSTRAINT "Delivery_leg_labels_consistent" CHECK')
      expect(migration).toContain('("legNumber" IS NULL AND "legCount" IS NULL)')
      expect(migration).toContain('"legCount" BETWEEN 2 AND 4 AND "legNumber" BETWEEN 1 AND "legCount"')
    })
  })
})
