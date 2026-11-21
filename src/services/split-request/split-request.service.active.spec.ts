import { BadRequestException, ConflictException, Logger } from '@nestjs/common'
import {
  EnumCancelledBy,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumPartnerChargeReason,
  EnumQuoteSource,
  EnumSplitRequestStatus,
} from '@prisma/types'
import { SPLIT_SENTENCES } from 'src/domains/split/split'
import { DeliveryNotFoundException, NotFoundException } from 'src/errors'
import { SplitRequestRepository } from 'src/persistence/repositories/split-request.repository'
import { SplitRequestService } from './split-request.service'

// Spec 0047 (row 11): the rider's flag and leave, the admin's refuse and confirm.
//
// No test in this repo talks to a real database, so the confirm (which is one database transaction) runs
// here against a small in-memory stand-in for Prisma. Its `$transaction` copies the tables first and puts
// the copy back if the callback throws, which is what Postgres does on a rollback. The REAL
// SplitRequestRepository runs on top of it, so the "one winner" conditional write is the real code.

type Row = Record<string, any>
type Tables = { splitRequest: Row[]; delivery: Row[]; deliveryQuote: Row[]; partnerCharge: Row[] }

const uniqueError = () => Object.assign(new Error('Unique constraint failed'), { name: 'PrismaClientKnownRequestError', code: 'P2002' })

// True when `row` satisfies a (small subset of a) Prisma `where`.
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    const value = row[key]
    if (wanted !== null && typeof wanted === 'object' && !(wanted instanceof Date)) {
      if ('in' in wanted) return wanted.in.includes(value)
      if ('not' in wanted) return value !== wanted.not
      throw new Error(`The fake Prisma does not know this filter on ${key}`)
    }
    return value === wanted
  })
}

function makeFakePrisma(seed: Tables) {
  let tables: Tables = seed
  let nextId = 1
  // What the test can switch on to make a write fail in the middle of the transaction.
  const failures = { partnerChargeCreate: false, deliveryCreate: false }
  // Which writes happened through the transaction client, to prove nothing is written outside it.
  const log: string[] = []

  const client = (inTx: boolean) => {
    const note = (what: string) => log.push(`${inTx ? 'tx' : 'outside'}:${what}`)
    return {
      splitRequest: {
        create: async ({ data }: any) => {
          if (data.openFor && tables.splitRequest.some((row) => row.openFor === data.openFor)) throw uniqueError()
          const row = {
            id: `split-${nextId++}`,
            finalLegs: null,
            answeredAt: null,
            answeredByUserId: null,
            adminNote: null,
            createdAt: new Date(),
            ...data,
          }
          tables.splitRequest.push(row)
          return { ...row }
        },
        findUnique: async ({ where }: any) => {
          const row = tables.splitRequest.find((candidate) => matches(candidate, where))
          return row ? { ...row } : null
        },
        updateMany: async ({ where, data }: any) => {
          note('splitRequest.updateMany')
          const rows = tables.splitRequest.filter((row) => matches(row, where))
          rows.forEach((row) => Object.assign(row, data))
          return { count: rows.length }
        },
      },
      delivery: {
        findMany: async ({ where }: any) => tables.delivery.filter((row) => matches(row, where)).map((row) => ({ ...row })),
        updateMany: async ({ where, data }: any) => {
          note('delivery.updateMany')
          const rows = tables.delivery.filter((row) => matches(row, where))
          rows.forEach((row) => Object.assign(row, data))
          return { count: rows.length }
        },
        create: async ({ data }: any) => {
          note('delivery.create')
          if (failures.deliveryCreate) throw new Error('The database refused the new leg')
          const row = { id: `new-leg-${nextId++}`, status: EnumDeliveryStatus.CREATED, courierId: null, ...data }
          tables.delivery.push(row)
          return { id: row.id }
        },
      },
      deliveryQuote: {
        findUniqueOrThrow: async ({ where }: any) => {
          const row = tables.deliveryQuote.find((candidate) => candidate.id === where.id)
          if (!row) throw new Error('No such quote')
          return { ...row }
        },
        create: async ({ data }: any) => {
          note('deliveryQuote.create')
          const row = { id: `split-quote-${nextId++}`, ...data }
          tables.deliveryQuote.push(row)
          return { ...row }
        },
      },
      partnerCharge: {
        create: async ({ data }: any) => {
          note('partnerCharge.create')
          if (failures.partnerChargeCreate) throw new Error('The database refused the charge')
          if (data.splitLegOf && tables.partnerCharge.some((row) => row.splitLegOf === data.splitLegOf)) throw uniqueError()
          const row = { id: `charge-${nextId++}`, billId: null, ...data }
          tables.partnerCharge.push(row)
          return { ...row }
        },
      },
    }
  }

  const prisma = {
    ...client(false),
    // All or nothing, like Postgres: a throw inside puts every table back as it was.
    $transaction: async (work: (tx: any) => Promise<unknown>) => {
      const before = structuredClone(tables)
      log.push('transaction:begin')
      try {
        const result = await work(client(true))
        log.push('transaction:commit')
        return result
      } catch (error) {
        tables = before
        log.push('transaction:rollback')
        throw error
      }
    },
  }
  return { prisma, failures, log, tables: () => tables }
}

describe('SplitRequestService (spec 0047)', () => {
  const DELIVERY_ID = 'del-1'
  const COURIER_ID = 'rider-1'
  const PARTNER_ID = 'partner-1'
  const QUOTE_ID = 'quote-1'
  const ADMIN = { id: 'admin-user-9' }
  const FLAGGED_AT = new Date('2026-11-21T12:00:00.000Z')
  const minutesAfterFlag = (minutes: number) => new Date(FLAGGED_AT.getTime() + minutes * 60_000)

  const large = { boxSize: 'LARGE' }
  const medium = { boxSize: 'MEDIUM' }
  const small = { boxSize: 'SMALL' }

  const baseDelivery = (overrides: Row = {}): Row => ({
    id: DELIVERY_ID,
    status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
    courierId: COURIER_ID,
    partnerId: PARTNER_ID,
    deliveryQuoteId: QUOTE_ID,
    orderReference: null,
    legNumber: null,
    legCount: null,
    boxSize: 'LARGE',
    boxUnits: 100,
    boxSizeAssumed: true,
    currencyCode: 'EUR',
    pickupName: 'Volos Test Kitchen',
    pickupPhoneNumber: '+302421000000',
    pickupBusinessName: 'Volos Test Kitchen',
    pickupNotes: 'Back door',
    pickupLocationId: 'loc-pickup',
    dropoffName: 'Maria P.',
    dropoffPhoneNumber: '+306900000000',
    dropoffBusinessName: null,
    dropoffNotes: 'Ring twice',
    dropoffSellerNotes: 'Extra napkins',
    dropoffEta: null,
    dropoffFloor: '3',
    dropoffDoorbell: 'Papadopoulou',
    dropoffLocationId: 'loc-dropoff',
    deliverableAction: 'DELIVERABLE_ACTION_MEET_AT_DOOR',
    undeliverableAction: 'RETURN_TO_PICKUP',
    requiresDropoffSignature: false,
    requiresId: false,
    orderItems: [{ name: 'Party platter', quantity: 3 }],
    tips: 250,
    totalCompensation: 356,
    idempotencyKey: 'idem-original',
    ...overrides,
  })

  const baseQuote = (overrides: Row = {}): Row => ({
    id: QUOTE_ID,
    source: EnumQuoteSource.PARTNER,
    quote: 450,
    quoteRangeFrom: 450,
    quoteRangeTo: 450,
    feePercentage: 20,
    baseFee: 200,
    distanceFee: 156,
    currency: 'EUR',
    duration: 420,
    distance: 2600,
    distanceUnit: 'METERS',
    pickupPhoneNumber: '+302421000000',
    pickupName: 'Volos Test Kitchen',
    dropoffPhoneNumber: '+306900000000',
    dropoffName: 'Maria P.',
    expiresAt: new Date('2026-11-21T11:30:00.000Z'),
    pickupLocationId: 'loc-pickup',
    dropoffLocationId: 'loc-dropoff',
    partnerId: PARTNER_ID,
    ...overrides,
  })

  const openRequest = (overrides: Row = {}): Row => ({
    id: 'split-open-1',
    deliveryId: DELIVERY_ID,
    courierId: COURIER_ID,
    proposedLegs: [large, small],
    finalLegs: null,
    status: EnumSplitRequestStatus.OPEN,
    openFor: DELIVERY_ID,
    createdAt: FLAGGED_AT,
    answeredAt: null,
    answeredByUserId: null,
    adminNote: null,
    ...overrides,
  })

  // Builds the service over the in-memory tables. `order` records the order of the calls that matter.
  function setup(seed: Partial<Tables> = {}) {
    const fake = makeFakePrisma({
      splitRequest: seed.splitRequest ?? [],
      delivery: seed.delivery ?? [baseDelivery()],
      deliveryQuote: seed.deliveryQuote ?? [baseQuote()],
      partnerCharge: seed.partnerCharge ?? [],
    })
    const order = fake.log
    const repository = new SplitRequestRepository(fake.prisma as any)
    const findDelivery = async (id: string) => {
      const row = fake.tables().delivery.find((delivery) => delivery.id === id)
      return row ? { ...row } : null
    }
    const deliveryRepository = {
      findById: jest.fn(findDelivery),
      findByIdOrThrow: jest.fn(async (id: string) => {
        const row = await findDelivery(id)
        if (!row) throw new Error('not found')
        return row
      }),
    }
    const deliveryEventService = {
      recordSplitEvent: jest.fn(async (event: any) => {
        order.push(`event:${event.type}`)
      }),
      recordBoxEvent: jest.fn(async (event: any) => {
        order.push(`event:${event.type}`)
      }),
      settleSplitWait: jest.fn(async () => {
        order.push('settleSplitWait')
      }),
      processDeliveryEvent: jest.fn(async (event: any) => {
        order.push(`process:${event.type}`)
      }),
      notifySplitDecided: jest.fn(async () => {
        order.push('notifySplitDecided')
      }),
    }
    const instanceConfig = {
      getSplitAnswerMinutes: jest.fn().mockResolvedValue(10),
      getBoxUnitsSmall: jest.fn().mockResolvedValue(30),
      getBoxUnitsMedium: jest.fn().mockResolvedValue(60),
      getBoxUnitsLarge: jest.fn().mockResolvedValue(100),
      getQuoteExpirationMinutes: jest.fn().mockResolvedValue(15),
    }
    const service = new SplitRequestService(
      repository,
      deliveryRepository as any,
      deliveryEventService as any,
      { instanceConfig } as any,
      fake.prisma as any
    )
    const tables = fake.tables
    const delivery = (id: string) => tables().delivery.find((row) => row.id === id)
    const newLegs = () => tables().delivery.filter((row) => row.id !== DELIVERY_ID && String(row.id).startsWith('new-leg-'))
    const request = (id = 'split-open-1') => tables().splitRequest.find((row) => row.id === id)
    return { service, fake, order, repository, deliveryRepository, deliveryEventService, instanceConfig, tables, delivery, newLegs, request }
  }

  beforeEach(() => {
    // The service logs a warning or an error on some paths; keep the test output readable.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  // ---------------------------------------------------------------------------------------------
  describe('request: the rider flags the order (AC-1)', () => {
    it('creates an OPEN request holding the proposal and writes SPLIT_REQUESTED with no status change', async () => {
      const { service, deliveryEventService, tables } = setup()

      const created = await service.request(COURIER_ID, DELIVERY_ID, [large, small])

      expect(created.status).toBe(EnumSplitRequestStatus.OPEN)
      expect(tables().splitRequest).toHaveLength(1)
      expect(tables().splitRequest[0]).toMatchObject({
        deliveryId: DELIVERY_ID,
        courierId: COURIER_ID,
        status: EnumSplitRequestStatus.OPEN,
        proposedLegs: [large, small],
      })
      // The event names the rider and the proposal; the status passed is the delivery's own (no change).
      expect(deliveryEventService.recordSplitEvent).toHaveBeenCalledTimes(1)
      const [event, status] = deliveryEventService.recordSplitEvent.mock.calls[0] as any[]
      expect(event).toMatchObject({
        deliveryId: DELIVERY_ID,
        type: EnumDeliveryEventType.SPLIT_REQUESTED,
        actor: EnumEventActor.COURIER,
        courierId: COURIER_ID,
      })
      expect(event.message).toContain('2 boxes: Large and Small')
      expect(status).toBe(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)
      // A flag never moves the delivery through the state machine.
      expect(deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    it('stores only the sizes, whatever else the phone sent', async () => {
      const { service, tables } = setup()
      await service.request(COURIER_ID, DELIVERY_ID, [{ boxSize: 'LARGE', pay: 99999 }, { boxSize: 'SMALL', courierId: 'x' }])
      expect(tables().splitRequest[0]?.proposedLegs).toEqual([large, small])
    })

    it("answers 404 for a delivery that is another rider's, and writes nothing", async () => {
      const { service, deliveryEventService, tables } = setup()
      await expect(service.request('another-rider', DELIVERY_ID, [large, small])).rejects.toBeInstanceOf(DeliveryNotFoundException)
      expect(tables().splitRequest).toHaveLength(0)
      expect(deliveryEventService.recordSplitEvent).not.toHaveBeenCalled()
    })

    it('answers 404 for a delivery that does not exist', async () => {
      const { service } = setup()
      await expect(service.request(COURIER_ID, 'no-such-delivery', [large, small])).rejects.toBeInstanceOf(DeliveryNotFoundException)
    })

    it.each([
      EnumDeliveryStatus.ACCEPTED,
      EnumDeliveryStatus.DISPATCHED,
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.ON_THE_WAY,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      EnumDeliveryStatus.DROPPED_OFF,
      EnumDeliveryStatus.CANCELED,
    ])('answers 409 from %s: only at the restaurant, before pickup', async (status) => {
      const { service, deliveryEventService, tables } = setup({ delivery: [baseDelivery({ status })] })
      await expect(service.request(COURIER_ID, DELIVERY_ID, [large, small])).rejects.toBeInstanceOf(ConflictException)
      expect(tables().splitRequest).toHaveLength(0)
      expect(deliveryEventService.recordSplitEvent).not.toHaveBeenCalled()
    })

    it('answers 409 when a request is already open for the delivery: no second request, no second event', async () => {
      const { service, deliveryEventService, tables } = setup({ splitRequest: [openRequest()] })

      const second = service.request(COURIER_ID, DELIVERY_ID, [large, medium])

      await expect(second).rejects.toBeInstanceOf(ConflictException)
      await expect(second).rejects.toThrow(SPLIT_SENTENCES.alreadyOpen)
      expect(tables().splitRequest).toHaveLength(1)
      expect(tables().splitRequest[0]?.proposedLegs).toEqual([large, small])
      expect(deliveryEventService.recordSplitEvent).not.toHaveBeenCalled()
    })

    it('lets the rider flag again once the earlier request was answered', async () => {
      const { service, tables } = setup({
        splitRequest: [openRequest({ status: EnumSplitRequestStatus.REFUSED, openFor: null })],
      })
      await service.request(COURIER_ID, DELIVERY_ID, [large, small])
      expect(tables().splitRequest.filter((row) => row.status === EnumSplitRequestStatus.OPEN)).toHaveLength(1)
    })

    it.each([
      ['one box', [large]],
      ['five boxes', [large, small, small, small, small]],
      ['an unknown size', [large, { boxSize: 'GIANT' }]],
      ['no list at all', undefined],
    ])('answers 400 for %s and writes nothing', async (_name, legs) => {
      const { service, deliveryEventService, tables } = setup()
      await expect(service.request(COURIER_ID, DELIVERY_ID, legs)).rejects.toBeInstanceOf(BadRequestException)
      expect(tables().splitRequest).toHaveLength(0)
      expect(deliveryEventService.recordSplitEvent).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------------------------
  describe('leave: no admin answered in time (AC-8)', () => {
    it('answers 409 before the limit has passed, and changes nothing', async () => {
      const { service, deliveryEventService, request } = setup({ splitRequest: [openRequest()] })

      const early = service.leave(COURIER_ID, DELIVERY_ID, new Date(minutesAfterFlag(10).getTime() - 1))

      await expect(early).rejects.toBeInstanceOf(ConflictException)
      expect(request()?.status).toBe(EnumSplitRequestStatus.OPEN)
      expect(deliveryEventService.settleSplitWait).not.toHaveBeenCalled()
      expect(deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      expect(deliveryEventService.recordSplitEvent).not.toHaveBeenCalled()
    })

    it('uses the co-op setting for the limit, not a fixed 10 minutes', async () => {
      const { service, instanceConfig, request } = setup({ splitRequest: [openRequest()] })
      instanceConfig.getSplitAnswerMinutes.mockResolvedValue(3)

      await expect(service.leave(COURIER_ID, DELIVERY_ID, minutesAfterFlag(2))).rejects.toBeInstanceOf(ConflictException)
      await service.leave(COURIER_ID, DELIVERY_ID, minutesAfterFlag(3))

      expect(request()?.status).toBe(EnumSplitRequestStatus.LEFT)
    })

    it('at the limit: closes the request as LEFT, pays the split wait charged to the restaurant, and cancels as the restaurant', async () => {
      const { service, deliveryEventService, request, order } = setup({ splitRequest: [openRequest()] })
      const now = minutesAfterFlag(10)

      await service.leave(COURIER_ID, DELIVERY_ID, now)

      // The request is closed and no longer blocks a new one.
      expect(request()).toMatchObject({ status: EnumSplitRequestStatus.LEFT, openFor: null, answeredAt: now })

      // The close is on the record, naming the rider (binding value 1).
      const [closedEvent, closedStatus] = deliveryEventService.recordSplitEvent.mock.calls[0] as any[]
      expect(closedEvent).toMatchObject({
        deliveryId: DELIVERY_ID,
        type: EnumDeliveryEventType.SPLIT_CLOSED,
        actor: EnumEventActor.COURIER,
        courierId: COURIER_ID,
      })
      expect(closedStatus).toBe(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)

      // AC-3 with AC-8: the wait from the flag to leaving, charged to the restaurant (it picked the size).
      expect(deliveryEventService.settleSplitWait).toHaveBeenCalledTimes(1)
      expect(deliveryEventService.settleSplitWait).toHaveBeenCalledWith(expect.objectContaining({ id: 'split-open-1' }), now, true)

      // Spec 0015's path: an ordinary CANCELED event, cancelled by the restaurant.
      expect(deliveryEventService.processDeliveryEvent).toHaveBeenCalledTimes(1)
      expect(deliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: DELIVERY_ID,
          type: EnumDeliveryEventType.CANCELED,
          cancelledBy: EnumCancelledBy.RESTAURANT,
        })
      )

      // The request is closed and the wait settled BEFORE the cancellation, so the cancellation's own hook
      // (which closes an open request as VOID with no charge) finds nothing left to close.
      expect(order.indexOf('settleSplitWait')).toBeGreaterThan(-1)
      expect(order.indexOf('settleSplitWait')).toBeLessThan(order.indexOf('process:CANCELED'))
    })

    it('answers 409 when there is no open request (already answered by an admin)', async () => {
      const { service, deliveryEventService } = setup({
        splitRequest: [openRequest({ status: EnumSplitRequestStatus.CONFIRMED, openFor: null })],
      })
      await expect(service.leave(COURIER_ID, DELIVERY_ID, minutesAfterFlag(30))).rejects.toBeInstanceOf(ConflictException)
      expect(deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      expect(deliveryEventService.settleSplitWait).not.toHaveBeenCalled()
    })

    it("answers 404 for another rider's delivery", async () => {
      const { service, request } = setup({ splitRequest: [openRequest()] })
      await expect(service.leave('another-rider', DELIVERY_ID, minutesAfterFlag(30))).rejects.toBeInstanceOf(DeliveryNotFoundException)
      expect(request()?.status).toBe(EnumSplitRequestStatus.OPEN)
    })

    it('a leave that loses the race to an admin answer is 409: no cancellation, no wait pay from the leave', async () => {
      const { service, repository, deliveryEventService } = setup({ splitRequest: [openRequest()] })
      // The admin's answer lands between the read and the conditional write.
      jest.spyOn(repository, 'closeIfOpen').mockResolvedValue(false)

      await expect(service.leave(COURIER_ID, DELIVERY_ID, minutesAfterFlag(11))).rejects.toBeInstanceOf(ConflictException)

      expect(deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      expect(deliveryEventService.settleSplitWait).not.toHaveBeenCalled()
      expect(deliveryEventService.recordSplitEvent).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------------------------
  describe('refuseIfSplitOpen (cross check 6: Picked up and leave wait are 409 while OPEN)', () => {
    it('throws 409 with the given sentence while a request is open', async () => {
      const { service } = setup({ splitRequest: [openRequest()] })
      await expect(service.refuseIfSplitOpen(DELIVERY_ID, SPLIT_SENTENCES.pickupBlocked)).rejects.toThrow(
        new ConflictException(SPLIT_SENTENCES.pickupBlocked)
      )
    })

    it('does nothing when the request was answered', async () => {
      const { service } = setup({ splitRequest: [openRequest({ status: EnumSplitRequestStatus.REFUSED, openFor: null })] })
      await expect(service.refuseIfSplitOpen(DELIVERY_ID, SPLIT_SENTENCES.pickupBlocked)).resolves.toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------------------------
  describe('refuse: "It fits" (AC-4, AC-7, cross check 1)', () => {
    const now = minutesAfterFlag(4)

    it('closes the request as REFUSED with the admin and their sentence, and leaves the order as it is', async () => {
      const { service, request, delivery, newLegs, tables } = setup({ splitRequest: [openRequest()] })
      const before = { ...delivery(DELIVERY_ID) }

      await service.refuse(ADMIN, 'split-open-1', '  It fits if you turn the platter  ', now)

      expect(request()).toMatchObject({
        status: EnumSplitRequestStatus.REFUSED,
        openFor: null,
        answeredAt: now,
        answeredByUserId: ADMIN.id,
        adminNote: 'It fits if you turn the platter',
      })
      // The rider carries the order as is: nothing about the delivery changed, no leg, no charge.
      expect(delivery(DELIVERY_ID)).toEqual(before)
      expect(newLegs()).toHaveLength(0)
      expect(tables().partnerCharge).toHaveLength(0)
    })

    it('writes SPLIT_REFUSED naming the admin, with no status change', async () => {
      const { service, deliveryEventService } = setup({ splitRequest: [openRequest()] })

      await service.refuse(ADMIN, 'split-open-1', null, now)

      expect(deliveryEventService.recordSplitEvent).toHaveBeenCalledTimes(1)
      const [event, status] = deliveryEventService.recordSplitEvent.mock.calls[0] as any[]
      expect(event).toMatchObject({
        deliveryId: DELIVERY_ID,
        type: EnumDeliveryEventType.SPLIT_REFUSED,
        actor: EnumEventActor.ADMIN,
        courierId: COURIER_ID,
      })
      expect(event.message).toContain(ADMIN.id)
      expect(status).toBe(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)
      expect(deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    it("never writes the admin's sentence into the record (it goes to the rider only)", async () => {
      const { service, deliveryEventService } = setup({ splitRequest: [openRequest()] })
      await service.refuse(ADMIN, 'split-open-1', 'SECRET-SENTENCE', now)
      const [event] = deliveryEventService.recordSplitEvent.mock.calls[0] as any[]
      expect(event.message).not.toContain('SECRET-SENTENCE')
    })

    it('pays the split wait from the co-op: the restaurant is NOT charged (cross check 1)', async () => {
      const { service, deliveryEventService } = setup({ splitRequest: [openRequest()] })

      await service.refuse(ADMIN, 'split-open-1', null, now)

      expect(deliveryEventService.settleSplitWait).toHaveBeenCalledTimes(1)
      expect(deliveryEventService.settleSplitWait).toHaveBeenCalledWith(expect.objectContaining({ id: 'split-open-1' }), now, false)
    })

    it("tells the rider the answer with the admin's sentence (AC-7)", async () => {
      const { service, deliveryEventService } = setup({ splitRequest: [openRequest()] })
      await service.refuse(ADMIN, 'split-open-1', 'It fits', now)
      expect(deliveryEventService.notifySplitDecided).toHaveBeenCalledWith(
        COURIER_ID,
        expect.objectContaining({ deliveryId: DELIVERY_ID, outcome: 'REFUSED', adminNote: 'It fits' })
      )
    })

    it('an empty sentence is stored and sent as no sentence', async () => {
      const { service, deliveryEventService, request } = setup({ splitRequest: [openRequest()] })
      await service.refuse(ADMIN, 'split-open-1', '   ', now)
      expect(request()?.adminNote).toBeNull()
      expect(deliveryEventService.notifySplitDecided).toHaveBeenCalledWith(COURIER_ID, expect.objectContaining({ adminNote: null }))
    })

    it('keeps at most 300 characters of the sentence (the column is VarChar(300))', async () => {
      const { service, request } = setup({ splitRequest: [openRequest()] })
      await service.refuse(ADMIN, 'split-open-1', 'x'.repeat(400), now)
      expect(request()?.adminNote).toHaveLength(300)
    })

    it.each([
      ['already refused (a second answer)', EnumSplitRequestStatus.REFUSED],
      ['already confirmed', EnumSplitRequestStatus.CONFIRMED],
      ['the rider left', EnumSplitRequestStatus.LEFT],
      ['closed as VOID', EnumSplitRequestStatus.VOID],
    ])('answers 409 when %s: no event, no pay, no message to the rider (AC-9)', async (_name, status) => {
      const { service, deliveryEventService, request } = setup({
        splitRequest: [openRequest({ status, openFor: null, adminNote: null })],
      })

      await expect(service.refuse(ADMIN, 'split-open-1', 'It fits', now)).rejects.toBeInstanceOf(ConflictException)

      expect(request()?.status).toBe(status)
      expect(deliveryEventService.recordSplitEvent).not.toHaveBeenCalled()
      expect(deliveryEventService.settleSplitWait).not.toHaveBeenCalled()
      expect(deliveryEventService.notifySplitDecided).not.toHaveBeenCalled()
    })

    it('answers 404 for a request that does not exist', async () => {
      const { service } = setup()
      await expect(service.refuse(ADMIN, 'no-such-request', null, now)).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  // ---------------------------------------------------------------------------------------------
  describe('confirm: the split itself (AC-5, AC-6, AC-9, AC-11)', () => {
    const now = minutesAfterFlag(2)

    describe('a single delivery split in two, as proposed', () => {
      it('the original becomes leg 1 of 2 with the first box, its own quote id as the order reference', async () => {
        const { service, delivery } = setup({ splitRequest: [openRequest({ proposedLegs: [medium, small] })] })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        expect(delivery(DELIVERY_ID)).toMatchObject({
          legNumber: 1,
          legCount: 2,
          boxSize: 'MEDIUM',
          boxUnits: 60,
          boxSizeAssumed: false,
          orderReference: QUOTE_ID,
          // Still with the same rider at the restaurant: the rider keeps leg 1.
          courierId: COURIER_ID,
          status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        })
      })

      it("keeps the restaurant's own reference in the group reference (spec 0046: typed#quoteId)", async () => {
        const { service, delivery, newLegs } = setup({
          splitRequest: [openRequest()],
          delivery: [baseDelivery({ orderReference: 'ORDER-77' })],
        })
        await service.confirm(ADMIN, 'split-open-1', undefined, now)
        expect(delivery(DELIVERY_ID)?.orderReference).toBe(`ORDER-77#${QUOTE_ID}`)
        expect(newLegs()[0]?.orderReference).toBe(`ORDER-77#${QUOTE_ID}`)
      })

      it('creates one new delivery for the second box, copying pickup, drop off, customer, notes and items', async () => {
        const { service, newLegs } = setup({ splitRequest: [openRequest()] })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        expect(newLegs()).toHaveLength(1)
        const original = baseDelivery()
        expect(newLegs()[0]).toMatchObject({
          status: EnumDeliveryStatus.CREATED,
          courierId: null,
          legNumber: 2,
          legCount: 2,
          orderReference: QUOTE_ID,
          boxSize: 'SMALL',
          boxUnits: 30,
          partnerId: PARTNER_ID,
          currencyCode: 'EUR',
          pickupName: original.pickupName,
          pickupPhoneNumber: original.pickupPhoneNumber,
          pickupBusinessName: original.pickupBusinessName,
          pickupNotes: original.pickupNotes,
          pickupLocationId: original.pickupLocationId,
          dropoffName: original.dropoffName,
          dropoffPhoneNumber: original.dropoffPhoneNumber,
          dropoffNotes: original.dropoffNotes,
          dropoffSellerNotes: original.dropoffSellerNotes,
          dropoffFloor: original.dropoffFloor,
          dropoffDoorbell: original.dropoffDoorbell,
          dropoffLocationId: original.dropoffLocationId,
          orderItems: original.orderItems,
        })
      })

      it('the new leg is ready now, carries no tip and no idempotency key (cross check 10)', async () => {
        const { service, newLegs } = setup({ splitRequest: [openRequest()] })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        const leg = newLegs()[0]
        expect(leg?.foodReadyAt).toEqual(now)
        expect(leg?.promisedReadyAt).toEqual(now)
        expect(leg?.tips).toBe(0)
        expect(leg?.idempotencyKey ?? null).toBeNull()
      })

      it("the new leg's quote is a SPLIT copy: same distance and rider pay, customer price 0, fee 0, fresh expiry", async () => {
        const { service, newLegs, tables } = setup({ splitRequest: [openRequest()] })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        const legQuote = tables().deliveryQuote.find((quote) => quote.id === newLegs()[0]?.deliveryQuoteId)
        expect(legQuote).toBeDefined()
        expect(legQuote?.id).not.toBe(QUOTE_ID)
        expect(legQuote).toMatchObject({
          source: EnumQuoteSource.SPLIT,
          // AC-6: nothing more is billed to the customer.
          quote: 0,
          quoteRangeFrom: 0,
          quoteRangeTo: 0,
          feePercentage: 0,
          // Cross check 4: the rider pay parts are the original's.
          baseFee: 200,
          distanceFee: 156,
          distance: 2600,
          duration: 420,
          currency: 'EUR',
          pickupLocationId: 'loc-pickup',
          dropoffLocationId: 'loc-dropoff',
          partnerId: PARTNER_ID,
        })
        // 15 minutes (the setting) after the confirm, not the original quote's long gone expiry.
        expect(legQuote?.expiresAt).toEqual(new Date(now.getTime() + 15 * 60_000))
        // The original quote is untouched: the customer's price does not change.
        expect(tables().deliveryQuote.find((quote) => quote.id === QUOTE_ID)).toEqual(baseQuote())
      })

      it('charges the restaurant the new leg\'s full rider pay (baseFee + distanceFee) as one SPLIT_LEG charge keyed by the leg', async () => {
        const { service, newLegs, tables } = setup({ splitRequest: [openRequest()] })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        const leg = newLegs()[0]
        expect(tables().partnerCharge).toHaveLength(1)
        expect(tables().partnerCharge[0]).toMatchObject({
          partnerId: PARTNER_ID,
          deliveryId: leg?.id,
          amount: 356, // 200 + 156: the rider's pay in full, never a share of it (binding value 3)
          currencyCode: 'EUR',
          reason: EnumPartnerChargeReason.SPLIT_LEG,
          splitLegOf: leg?.id,
        })
      })

      it('closes the request as CONFIRMED with the admin and the final legs', async () => {
        const { service, request } = setup({ splitRequest: [openRequest()] })
        await service.confirm(ADMIN, 'split-open-1', undefined, now)
        expect(request()).toMatchObject({
          status: EnumSplitRequestStatus.CONFIRMED,
          openFor: null,
          answeredAt: now,
          answeredByUserId: ADMIN.id,
          finalLegs: [large, small],
        })
      })
    })

    describe('AC-11: a confirm cannot create legs without the restaurant charge', () => {
      it.each([
        ['2 boxes', [large, small], 1],
        ['3 boxes', [large, medium, small], 2],
        ['4 boxes', [large, medium, small, small], 3],
      ])('%s: every new leg has exactly one SPLIT_LEG charge of its rider pay', async (_name, legs, newLegCount) => {
        const { service, newLegs, tables } = setup({ splitRequest: [openRequest({ proposedLegs: legs })] })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        expect(newLegs()).toHaveLength(newLegCount)
        expect(tables().partnerCharge).toHaveLength(newLegCount)
        for (const leg of newLegs()) {
          const charges = tables().partnerCharge.filter((charge) => charge.splitLegOf === leg.id)
          expect(charges).toHaveLength(1)
          expect(charges[0]).toMatchObject({
            reason: EnumPartnerChargeReason.SPLIT_LEG,
            amount: 356,
            deliveryId: leg.id,
            partnerId: PARTNER_ID,
          })
        }
      })

      it('the leg and its charge are written inside the same transaction, never outside it', async () => {
        const { service, order } = setup({ splitRequest: [openRequest()] })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        expect(order).toContain('tx:delivery.create')
        expect(order).toContain('tx:partnerCharge.create')
        expect(order).not.toContain('outside:delivery.create')
        expect(order).not.toContain('outside:partnerCharge.create')
        const commit = order.indexOf('transaction:commit')
        expect(order.indexOf('tx:delivery.create')).toBeLessThan(commit)
        expect(order.indexOf('tx:partnerCharge.create')).toBeLessThan(commit)
      })

      it('if the charge cannot be written, nothing happens at all: no leg, the request still OPEN, the delivery unchanged', async () => {
        const { service, fake, newLegs, request, delivery, tables, deliveryEventService } = setup({ splitRequest: [openRequest()] })
        const before = { ...delivery(DELIVERY_ID) }
        fake.failures.partnerChargeCreate = true

        await expect(service.confirm(ADMIN, 'split-open-1', undefined, now)).rejects.toThrow('The database refused the charge')

        expect(newLegs()).toHaveLength(0)
        expect(tables().partnerCharge).toHaveLength(0)
        expect(tables().deliveryQuote).toHaveLength(1)
        expect(request()).toMatchObject({ status: EnumSplitRequestStatus.OPEN, openFor: DELIVERY_ID })
        expect(delivery(DELIVERY_ID)).toEqual(before)
        // Nothing is recorded, paid, matched or sent for a split that did not happen.
        expect(deliveryEventService.recordSplitEvent).not.toHaveBeenCalled()
        expect(deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
        expect(deliveryEventService.settleSplitWait).not.toHaveBeenCalled()
        expect(deliveryEventService.notifySplitDecided).not.toHaveBeenCalled()
      })

      it('if a leg cannot be created, no charge and no half split is left behind', async () => {
        const { service, fake, newLegs, request, tables } = setup({ splitRequest: [openRequest({ proposedLegs: [large, small, small] })] })
        fake.failures.deliveryCreate = true

        await expect(service.confirm(ADMIN, 'split-open-1', undefined, now)).rejects.toThrow()

        expect(newLegs()).toHaveLength(0)
        expect(tables().partnerCharge).toHaveLength(0)
        expect(request()?.status).toBe(EnumSplitRequestStatus.OPEN)
      })

      it('writes a PARTNER_CHARGED_FOR_SPLIT event on each new leg, naming the amount (cross check 5, value 1)', async () => {
        const { service, newLegs, deliveryEventService } = setup({ splitRequest: [openRequest({ proposedLegs: [large, small, small] })] })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        const chargeEvents = deliveryEventService.recordSplitEvent.mock.calls
          .map((call: any[]) => call[0])
          .filter((event: any) => event.type === EnumDeliveryEventType.PARTNER_CHARGED_FOR_SPLIT)
        expect(chargeEvents.map((event: any) => event.deliveryId).sort()).toEqual(newLegs().map((leg) => leg.id).sort())
        for (const event of chargeEvents) expect(event.message).toContain('356')
      })
    })

    describe('a delivery with no restaurant (cross check 13)', () => {
      it('creates the legs with no charge and no charge event, and warns', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn')
        const { service, newLegs, tables, deliveryEventService } = setup({
          splitRequest: [openRequest()],
          delivery: [baseDelivery({ partnerId: null })],
        })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        expect(newLegs()).toHaveLength(1)
        expect(tables().partnerCharge).toHaveLength(0)
        const types = deliveryEventService.recordSplitEvent.mock.calls.map((call: any[]) => call[0].type)
        expect(types).not.toContain(EnumDeliveryEventType.PARTNER_CHARGED_FOR_SPLIT)
        expect(warn).toHaveBeenCalled()
      })
    })

    describe('the admin changes the boxes (AC-4)', () => {
      it("uses the admin's legs, not the rider's proposal, and stores them as the final legs", async () => {
        const { service, newLegs, delivery, request } = setup({ splitRequest: [openRequest({ proposedLegs: [large, small] })] })

        await service.confirm(ADMIN, 'split-open-1', [medium, medium, small], now)

        expect(request()?.finalLegs).toEqual([medium, medium, small])
        expect(request()?.proposedLegs).toEqual([large, small])
        expect(delivery(DELIVERY_ID)).toMatchObject({ boxSize: 'MEDIUM', boxUnits: 60, legNumber: 1, legCount: 3 })
        expect(newLegs().map((leg) => [leg.legNumber, leg.legCount, leg.boxSize, leg.boxUnits])).toEqual([
          [2, 3, 'MEDIUM', 60],
          [3, 3, 'SMALL', 30],
        ])
      })

      it.each([
        ['one box', [large]],
        ['five boxes', [large, small, small, small, small]],
        ['an unknown size', [large, { boxSize: 'GIANT' }]],
      ])('answers 400 for %s and leaves the request open', async (_name, legs) => {
        const { service, request, newLegs } = setup({ splitRequest: [openRequest()] })
        await expect(service.confirm(ADMIN, 'split-open-1', legs, now)).rejects.toBeInstanceOf(BadRequestException)
        expect(request()?.status).toBe(EnumSplitRequestStatus.OPEN)
        expect(newLegs()).toHaveLength(0)
      })
    })

    describe('the record and what follows the commit (AC-4, AC-5, cross checks 7 and 9)', () => {
      it('writes SPLIT_CONFIRMED on the kept delivery, naming the admin and the final legs, with no status change', async () => {
        const { service, deliveryEventService } = setup({ splitRequest: [openRequest()] })

        await service.confirm(ADMIN, 'split-open-1', [large, medium], now)

        const call = deliveryEventService.recordSplitEvent.mock.calls.find(
          (candidate: any[]) => candidate[0].type === EnumDeliveryEventType.SPLIT_CONFIRMED
        ) as any[]
        expect(call).toBeDefined()
        expect(call[0]).toMatchObject({ deliveryId: DELIVERY_ID, actor: EnumEventActor.ADMIN, courierId: COURIER_ID })
        expect(call[0].message).toContain(ADMIN.id)
        expect(call[0].message).toContain('2 boxes: Large and Medium')
        expect(call[1]).toBe(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)
      })

      it('sends each new leg into matching with a CREATED event whose actor is the admin', async () => {
        const { service, newLegs, deliveryEventService } = setup({ splitRequest: [openRequest({ proposedLegs: [large, small, small] })] })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        const created = deliveryEventService.processDeliveryEvent.mock.calls.map((call: any[]) => call[0])
        expect(created).toHaveLength(2)
        expect(created.map((event: any) => event.deliveryId).sort()).toEqual(newLegs().map((leg) => leg.id).sort())
        for (const event of created) {
          expect(event).toMatchObject({ type: EnumDeliveryEventType.CREATED, actor: EnumEventActor.ADMIN })
          expect(event.message).toContain(ADMIN.id)
        }
      })

      it('runs the events, the wait pay and matching only after the transaction committed', async () => {
        const { service, order } = setup({ splitRequest: [openRequest()] })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        const commit = order.indexOf('transaction:commit')
        expect(commit).toBeGreaterThan(-1)
        for (const step of ['event:SPLIT_CONFIRMED', 'event:PARTNER_CHARGED_FOR_SPLIT', 'settleSplitWait', 'process:CREATED', 'notifySplitDecided']) {
          expect(order.indexOf(step)).toBeGreaterThan(commit)
        }
      })

      it('pays the split wait charged to the restaurant (AC-3 on a confirm)', async () => {
        const { service, deliveryEventService } = setup({ splitRequest: [openRequest()] })
        await service.confirm(ADMIN, 'split-open-1', undefined, now)
        expect(deliveryEventService.settleSplitWait).toHaveBeenCalledTimes(1)
        expect(deliveryEventService.settleSplitWait).toHaveBeenCalledWith(expect.objectContaining({ id: 'split-open-1' }), now, true)
      })

      it('writes BOX_SIZE_CHANGED (actor the admin) when the kept leg changes size', async () => {
        const { service, deliveryEventService } = setup({ splitRequest: [openRequest({ proposedLegs: [medium, small] })] })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        expect(deliveryEventService.recordBoxEvent).toHaveBeenCalledTimes(1)
        const [event] = deliveryEventService.recordBoxEvent.mock.calls[0] as any[]
        expect(event).toMatchObject({
          deliveryId: DELIVERY_ID,
          type: EnumDeliveryEventType.BOX_SIZE_CHANGED,
          actor: EnumEventActor.ADMIN,
        })
        expect(event.message).toContain('MEDIUM')
        expect(event.message).toContain('LARGE')
      })

      it('writes no BOX_SIZE_CHANGED when the kept leg keeps its size', async () => {
        const { service, deliveryEventService } = setup({ splitRequest: [openRequest({ proposedLegs: [large, small] })] })
        await service.confirm(ADMIN, 'split-open-1', undefined, now)
        expect(deliveryEventService.recordBoxEvent).not.toHaveBeenCalled()
      })

      it('tells the rider which leg and size they keep', async () => {
        const { service, deliveryEventService } = setup({ splitRequest: [openRequest({ proposedLegs: [medium, small] })] })
        await service.confirm(ADMIN, 'split-open-1', undefined, now)
        expect(deliveryEventService.notifySplitDecided).toHaveBeenCalledWith(COURIER_ID, {
          deliveryId: DELIVERY_ID,
          outcome: 'CONFIRMED',
          adminNote: null,
          legNumber: 1,
          legCount: 2,
          boxSize: 'MEDIUM',
        })
      })

      it('a leg whose start fails does not undo the split or stop the other legs (the sweep finishes it)', async () => {
        const { service, newLegs, deliveryEventService, request } = setup({ splitRequest: [openRequest({ proposedLegs: [large, small, small] })] })
        deliveryEventService.processDeliveryEvent.mockRejectedValueOnce(new Error('matching is down'))

        await expect(service.confirm(ADMIN, 'split-open-1', undefined, now)).resolves.toBeUndefined()

        expect(newLegs()).toHaveLength(2)
        expect(request()?.status).toBe(EnumSplitRequestStatus.CONFIRMED)
        expect(deliveryEventService.processDeliveryEvent).toHaveBeenCalledTimes(2)
      })
    })

    describe('the delivery changed before the confirm: everything rolls back (cross check 9)', () => {
      // The confirm reads the delivery, then writes it conditionally inside the transaction. These tests
      // change the row between the two, the way a real race would.
      const changeDuringTransaction = (ctx: ReturnType<typeof setup>, change: Row) => {
        const original = ctx.fake.prisma.$transaction
        ctx.fake.prisma.$transaction = async (work: any) => {
          Object.assign(ctx.delivery(DELIVERY_ID) as Row, change)
          return original(work)
        }
      }

      it.each([
        ['the rider picked it up', { status: EnumDeliveryStatus.PICKED_UP }],
        ['it was cancelled', { status: EnumDeliveryStatus.CANCELED }],
        ['it went back to waiting', { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId: null }],
        ['another rider holds it now', { courierId: 'another-rider' }],
      ])('%s: 409, no leg, no charge, the request not claimed, nothing recorded', async (_name, change) => {
        const ctx = setup({ splitRequest: [openRequest()] })
        changeDuringTransaction(ctx, change)

        const attempt = ctx.service.confirm(ADMIN, 'split-open-1', undefined, now)

        await expect(attempt).rejects.toBeInstanceOf(ConflictException)
        await expect(attempt).rejects.toThrow(SPLIT_SENTENCES.deliveryChanged)
        expect(ctx.newLegs()).toHaveLength(0)
        expect(ctx.tables().partnerCharge).toHaveLength(0)
        expect(ctx.tables().deliveryQuote).toHaveLength(1)
        // The claim was rolled back with the rest: the request is not left CONFIRMED with no legs.
        expect(ctx.request()).toMatchObject({ status: EnumSplitRequestStatus.OPEN, finalLegs: null, answeredByUserId: null })
        // The delivery got none of the leg labels.
        expect(ctx.delivery(DELIVERY_ID)).toMatchObject({ legNumber: null, legCount: null, orderReference: null, boxSize: 'LARGE' })
        expect(ctx.deliveryEventService.recordSplitEvent).not.toHaveBeenCalled()
        expect(ctx.deliveryEventService.recordBoxEvent).not.toHaveBeenCalled()
        expect(ctx.deliveryEventService.settleSplitWait).not.toHaveBeenCalled()
        expect(ctx.deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
        expect(ctx.deliveryEventService.notifySplitDecided).not.toHaveBeenCalled()
      })

      it("a sibling leg's count is rolled back too when the kept leg changed", async () => {
        const ctx = setup({
          splitRequest: [openRequest()],
          delivery: [
            baseDelivery({ legNumber: 1, legCount: 2, orderReference: 'ORDER-REF' }),
            baseDelivery({ id: 'sibling-2', courierId: 'rider-2', legNumber: 2, legCount: 2, orderReference: 'ORDER-REF', deliveryQuoteId: 'quote-2' }),
          ],
        })
        changeDuringTransaction(ctx, { status: EnumDeliveryStatus.PICKED_UP })

        await expect(ctx.service.confirm(ADMIN, 'split-open-1', undefined, now)).rejects.toBeInstanceOf(ConflictException)

        expect(ctx.delivery('sibling-2')?.legCount).toBe(2)
        expect(ctx.delivery(DELIVERY_ID)?.legCount).toBe(2)
      })
    })

    describe('one answer only (AC-9)', () => {
      it.each([
        ['a second confirm', EnumSplitRequestStatus.CONFIRMED],
        ['a confirm after a refusal', EnumSplitRequestStatus.REFUSED],
        ['a confirm after the rider left', EnumSplitRequestStatus.LEFT],
        ['a confirm after the request was voided', EnumSplitRequestStatus.VOID],
      ])('%s answers 409 and creates nothing', async (_name, status) => {
        const { service, newLegs, tables, deliveryEventService } = setup({ splitRequest: [openRequest({ status, openFor: null })] })

        const attempt = service.confirm(ADMIN, 'split-open-1', undefined, now)

        await expect(attempt).rejects.toBeInstanceOf(ConflictException)
        await expect(attempt).rejects.toThrow(SPLIT_SENTENCES.notOpen)
        expect(newLegs()).toHaveLength(0)
        expect(tables().partnerCharge).toHaveLength(0)
        expect(deliveryEventService.settleSplitWait).not.toHaveBeenCalled()
        expect(deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      })

      it('really confirming twice: the second is 409 and the legs and charges are not doubled', async () => {
        const { service, newLegs, tables } = setup({ splitRequest: [openRequest()] })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)
        await expect(service.confirm({ id: 'admin-user-2' }, 'split-open-1', undefined, now)).rejects.toBeInstanceOf(ConflictException)

        expect(newLegs()).toHaveLength(1)
        expect(tables().partnerCharge).toHaveLength(1)
      })

      it('two admins at once: both read OPEN, one wins, the loser is 409 and creates nothing', async () => {
        const ctx = setup({ splitRequest: [openRequest()] })
        // The other admin's refusal lands after this confirm read the request as OPEN but before its claim.
        const original = ctx.fake.prisma.$transaction
        ctx.fake.prisma.$transaction = async (work: any) => {
          Object.assign(ctx.request() as Row, { status: EnumSplitRequestStatus.REFUSED, openFor: null, answeredByUserId: 'admin-user-2' })
          return original(work)
        }

        await expect(ctx.service.confirm(ADMIN, 'split-open-1', undefined, now)).rejects.toBeInstanceOf(ConflictException)

        expect(ctx.request()).toMatchObject({ status: EnumSplitRequestStatus.REFUSED, answeredByUserId: 'admin-user-2' })
        expect(ctx.newLegs()).toHaveLength(0)
        expect(ctx.tables().partnerCharge).toHaveLength(0)
        expect(ctx.delivery(DELIVERY_ID)).toMatchObject({ legNumber: null, legCount: null })
        expect(ctx.deliveryEventService.settleSplitWait).not.toHaveBeenCalled()
        expect(ctx.deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      })

      it('answers 404 for a request that does not exist', async () => {
        const { service } = setup()
        await expect(service.confirm(ADMIN, 'no-such-request', undefined, now)).rejects.toBeInstanceOf(NotFoundException)
      })
    })

    describe('splitting a delivery that is already a leg (cross check 8)', () => {
      const legOrder = (extra: Row[] = []) => [
        baseDelivery({ legNumber: 1, legCount: 2, orderReference: 'ORDER-REF' }),
        baseDelivery({
          id: 'sibling-2',
          courierId: 'rider-2',
          status: EnumDeliveryStatus.ON_THE_WAY,
          legNumber: 2,
          legCount: 2,
          orderReference: 'ORDER-REF',
          deliveryQuoteId: 'quote-2',
        }),
        ...extra,
      ]

      it('leg 1 of 2 split in two: it stays leg 1, the new leg is 3, and every leg of the order says "of 3"', async () => {
        const { service, delivery, newLegs } = setup({ splitRequest: [openRequest()], delivery: legOrder() })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        expect(delivery(DELIVERY_ID)).toMatchObject({ legNumber: 1, legCount: 3, orderReference: 'ORDER-REF' })
        expect(delivery('sibling-2')).toMatchObject({ legNumber: 2, legCount: 3, orderReference: 'ORDER-REF' })
        expect(newLegs()).toHaveLength(1)
        expect(newLegs()[0]).toMatchObject({ legNumber: 3, legCount: 3, orderReference: 'ORDER-REF' })
      })

      it('leg 1 of 2 split in three: new legs 3 and 4, every leg "of 4", no number used twice', async () => {
        const { service, delivery, newLegs, tables } = setup({
          splitRequest: [openRequest({ proposedLegs: [large, small, small] })],
          delivery: legOrder(),
        })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        expect(newLegs().map((leg) => leg.legNumber)).toEqual([3, 4])
        const order = tables().delivery.filter((row) => row.orderReference === 'ORDER-REF')
        expect(order.map((row) => row.legNumber).sort()).toEqual([1, 2, 3, 4])
        expect(order.every((row) => row.legCount === 4)).toBe(true)
        expect(delivery('sibling-2')?.legCount).toBe(4)
      })

      it('does not touch the leg count of another order of the same restaurant', async () => {
        const other = baseDelivery({ id: 'other-order-leg', legNumber: 1, legCount: 2, orderReference: 'ANOTHER-ORDER', deliveryQuoteId: 'quote-3' })
        const { service, delivery } = setup({ splitRequest: [openRequest()], delivery: legOrder([other]) })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        expect(delivery('other-order-leg')).toMatchObject({ legNumber: 1, legCount: 2 })
      })

      it('refuses past 4 legs in all (409), and creates nothing', async () => {
        const threeLegs = [
          baseDelivery({ legNumber: 1, legCount: 3, orderReference: 'ORDER-REF' }),
          baseDelivery({ id: 'sibling-2', courierId: 'rider-2', legNumber: 2, legCount: 3, orderReference: 'ORDER-REF', deliveryQuoteId: 'quote-2' }),
          baseDelivery({ id: 'sibling-3', courierId: 'rider-3', legNumber: 3, legCount: 3, orderReference: 'ORDER-REF', deliveryQuoteId: 'quote-3' }),
        ]
        const { service, newLegs, tables, request, delivery } = setup({
          splitRequest: [openRequest({ proposedLegs: [large, small, small] })],
          delivery: threeLegs,
        })

        const attempt = service.confirm(ADMIN, 'split-open-1', undefined, now)

        await expect(attempt).rejects.toBeInstanceOf(ConflictException)
        await expect(attempt).rejects.toThrow(SPLIT_SENTENCES.tooManyLegs)
        expect(newLegs()).toHaveLength(0)
        expect(tables().partnerCharge).toHaveLength(0)
        expect(request()?.status).toBe(EnumSplitRequestStatus.OPEN)
        expect(delivery('sibling-2')?.legCount).toBe(3)
      })

      it('a leg of 3 can still be split in two: exactly 4 legs is allowed', async () => {
        const threeLegs = [
          baseDelivery({ legNumber: 2, legCount: 3, orderReference: 'ORDER-REF' }),
          baseDelivery({ id: 'sibling-1', courierId: 'rider-2', legNumber: 1, legCount: 3, orderReference: 'ORDER-REF', deliveryQuoteId: 'quote-2' }),
          baseDelivery({ id: 'sibling-3', courierId: 'rider-3', legNumber: 3, legCount: 3, orderReference: 'ORDER-REF', deliveryQuoteId: 'quote-3' }),
        ]
        const { service, newLegs, delivery } = setup({ splitRequest: [openRequest()], delivery: threeLegs })

        await service.confirm(ADMIN, 'split-open-1', undefined, now)

        expect(delivery(DELIVERY_ID)).toMatchObject({ legNumber: 2, legCount: 4 })
        expect(newLegs()[0]).toMatchObject({ legNumber: 4, legCount: 4 })
      })
    })
  })

  // ---------------------------------------------------------------------------------------------
  describe('the queue (AC-4)', () => {
    it('listOpen and countOpen read only OPEN requests from the repository', async () => {
      const { service, repository } = setup()
      const list = jest.spyOn(repository, 'findOpenForQueue').mockResolvedValue([{ id: 'a' }] as any)
      const count = jest.spyOn(repository, 'countOpen').mockResolvedValue(3)

      await expect(service.listOpen()).resolves.toEqual([{ id: 'a' }])
      await expect(service.countOpen()).resolves.toBe(3)
      expect(list).toHaveBeenCalledTimes(1)
      expect(count).toHaveBeenCalledTimes(1)
    })
  })

  // ---------------------------------------------------------------------------------------------
  describe('startUnstartedLegs: the minute sweep (cross check 7)', () => {
    const now = new Date('2026-11-21T13:00:00.000Z')

    // The sweep reads with its own queries, so it gets a plain mocked Prisma rather than the tables above.
    function sweepSetup(rows: Row[], charge: Row | null, chargeEvent: Row | null) {
      const prisma = {
        delivery: { findMany: jest.fn().mockResolvedValue(rows) },
        partnerCharge: { findUnique: jest.fn().mockResolvedValue(charge) },
        deliveryEvent: { findFirst: jest.fn().mockResolvedValue(chargeEvent) },
      }
      const deliveryEventService = {
        recordSplitEvent: jest.fn().mockResolvedValue(undefined),
        processDeliveryEvent: jest.fn().mockResolvedValue(undefined),
      }
      const service = new SplitRequestService({} as any, {} as any, deliveryEventService as any, { instanceConfig: {} } as any, prisma as any)
      return { service, prisma, deliveryEventService }
    }
    const strandedLeg = { id: 'leg-stranded', legNumber: 2, boxSize: 'SMALL', currencyCode: 'EUR' }

    it('looks only for split legs still in CREATED, older than a minute and younger than a day', async () => {
      const { service, prisma } = sweepSetup([], null, null)

      await service.startUnstartedLegs(now)

      const where = prisma.delivery.findMany.mock.calls[0][0].where
      expect(where.status).toBe(EnumDeliveryStatus.CREATED)
      expect(where.delivery).toEqual({ source: EnumQuoteSource.SPLIT })
      expect(where.createdAt.lt).toEqual(new Date(now.getTime() - 60_000))
      expect(where.createdAt.gt).toEqual(new Date(now.getTime() - 24 * 3600_000))
    })

    it('starts a stranded leg (CREATED into matching) and writes the charge event it never got', async () => {
      const { service, deliveryEventService } = sweepSetup([strandedLeg], { amount: 356, splitLegOf: 'leg-stranded' }, null)

      await expect(service.startUnstartedLegs(now)).resolves.toBe(1)

      expect(deliveryEventService.recordSplitEvent).toHaveBeenCalledTimes(1)
      const [event] = deliveryEventService.recordSplitEvent.mock.calls[0] as any[]
      expect(event).toMatchObject({ deliveryId: 'leg-stranded', type: EnumDeliveryEventType.PARTNER_CHARGED_FOR_SPLIT })
      expect(event.message).toContain('356')
      expect(deliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryId: 'leg-stranded', type: EnumDeliveryEventType.CREATED })
      )
    })

    it('does not write the charge event a second time when it is already on the record', async () => {
      const { service, deliveryEventService } = sweepSetup([strandedLeg], { amount: 356, splitLegOf: 'leg-stranded' }, { id: 'evt-already' })

      await service.startUnstartedLegs(now)

      expect(deliveryEventService.recordSplitEvent).not.toHaveBeenCalled()
      expect(deliveryEventService.processDeliveryEvent).toHaveBeenCalledTimes(1)
    })

    it('writes no charge event for a leg that has no charge (no restaurant)', async () => {
      const { service, deliveryEventService } = sweepSetup([strandedLeg], null, null)
      await service.startUnstartedLegs(now)
      expect(deliveryEventService.recordSplitEvent).not.toHaveBeenCalled()
      expect(deliveryEventService.processDeliveryEvent).toHaveBeenCalledTimes(1)
    })

    it('answers 0 and starts nothing when no leg is stranded', async () => {
      const { service, deliveryEventService } = sweepSetup([], null, null)
      await expect(service.startUnstartedLegs(now)).resolves.toBe(0)
      expect(deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })
  })
})
