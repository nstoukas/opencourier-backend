import { Logger } from '@nestjs/common'
import {
  EnumCancelledBy,
  EnumCourierCompensationReason,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumPartnerChargeReason,
  EnumSplitRequestStatus,
} from '@prisma/types'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryEventService, SPLIT_EVENT_TYPES } from './delivery-event.service'

// Spec 0047 (row 11): the parts of a split at pickup that live in DeliveryEventService: the split wait's
// pay and charge (AC-3), the split events (no status change, refused on the event route), the close of an
// open request when the delivery ends another way (cross check 6), and a new leg's charge taken back when
// no rider ever took it (cross check 5).
describe('DeliveryEventService - split at pickup (spec 0047)', () => {
  const DELIVERY_ID = 'del-split-1'
  const COURIER_ID = 'rider-1'
  const PARTNER_ID = 'partner-1'
  const REQUEST_ID = 'split-req-1'
  const FLAGGED_AT = new Date('2026-11-21T12:00:00.000Z')
  const minutesAfterFlag = (minutes: number, seconds = 0) => new Date(FLAGGED_AT.getTime() + minutes * 60_000 + seconds * 1000)

  const request = { id: REQUEST_ID, deliveryId: DELIVERY_ID, courierId: COURIER_ID, createdAt: FLAGGED_AT }

  // The split request as the database holds it. Since the row 11 review the wait is settled from this stored
  // row (its status, its close time and its `waitOwedAt` stamp), so the sweep can settle it again.
  let stored: any
  // Closes the stored request `minutes` after the flag, stamped as owing its wait.
  const closeStored = (status: EnumSplitRequestStatus, minutes: number, seconds = 0, overrides: Record<string, unknown> = {}) => {
    const closedAt = minutesAfterFlag(minutes, seconds)
    stored = { ...request, status, answeredAt: closedAt, waitOwedAt: closedAt, ...overrides }
  }
  // A request closed with this answer `minutes` after the flag, then settled.
  const settle = async (status: EnumSplitRequestStatus, minutes: number, seconds = 0) => {
    closeStored(status, minutes, seconds)
    await service.settleSplitWait(REQUEST_ID)
  }

  let service: DeliveryEventService
  let deliveryRepository: any
  let deliveryEventRepository: any
  let courierRepository: any
  let courierCompensationRepository: any
  let partnerChargeRepository: any
  let removalRequestRepository: any
  let splitRequestRepository: any
  let websocketDispatcher: any
  let offerPushService: any
  let instanceConfig: any

  const makeDelivery = (overrides: Record<string, unknown> = {}): DeliveryEntity =>
    new DeliveryEntity({
      id: DELIVERY_ID,
      status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      courierId: COURIER_ID,
      partnerId: PARTNER_ID,
      totalCompensation: 356,
      totalCost: 450,
      currencyCode: 'EUR',
      ...overrides,
    } as any)

  // Every event row the service saved, in order.
  const savedEvents = () => deliveryEventRepository.create.mock.calls.map((call: any[]) => call[0])
  const savedOfType = (type: EnumDeliveryEventType) => savedEvents().filter((event: any) => event.type === type)

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

    deliveryRepository = {
      findById: jest.fn().mockResolvedValue(makeDelivery()),
      findByIdOrThrow: jest.fn().mockResolvedValue(makeDelivery()),
      update: jest.fn().mockImplementation(async (id: string, data: object) => ({ id, ...data })),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      findIdsWaitingForCourierOldestFirst: jest.fn().mockResolvedValue([]),
    }
    deliveryEventRepository = {
      create: jest.fn().mockImplementation(async (data: any) => ({ id: `evt-${data.type}`, ...data })),
      findWaitPaidMessages: jest.fn().mockResolvedValue([]),
      findWaitEvents: jest.fn().mockResolvedValue([]),
      findLatestOfTypes: jest.fn().mockResolvedValue(null),
      hasSuccessfulEvent: jest.fn().mockResolvedValue(false),
    }
    courierRepository = {
      findById: jest.fn().mockResolvedValue({ id: COURIER_ID, userId: 'user-rider-1' }),
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: COURIER_ID, userId: 'user-rider-1' }),
      updateById: jest.fn().mockResolvedValue({}),
      clearLocationIfOfflineAndFree: jest.fn().mockResolvedValue(undefined),
    }
    courierCompensationRepository = {
      // Hands back the row it was asked to write, as the real "once" writer does on a first write.
      createSplitWaitPayOnce: jest.fn().mockImplementation(async (input: any) => ({ id: 'comp-split-wait', ...input })),
      findCancellationAward: jest.fn().mockResolvedValue(null),
      createCancellationAwardOnce: jest.fn().mockImplementation(async (input: any) => ({ id: 'comp-cancel', ...input })),
      findWaitAwards: jest.fn().mockResolvedValue([]),
    }
    partnerChargeRepository = {
      createSplitWaitChargeOnce: jest.fn().mockImplementation(async (input: any) => ({ id: 'charge-split-wait', ...input })),
      deleteUnbilledSplitLegCharge: jest.fn().mockResolvedValue({ removed: null, kept: null }),
      findByDeliveryId: jest.fn().mockResolvedValue(null),
      createOnce: jest.fn().mockImplementation(async (input: any) => ({ id: 'charge-cancel', ...input })),
    }
    removalRequestRepository = {
      closeOpenForDelivery: jest.fn().mockResolvedValue(undefined),
      findApprovedAfterPickup: jest.fn().mockResolvedValue(null),
    }
    stored = null
    splitRequestRepository = {
      findOpenForDelivery: jest.fn().mockResolvedValue(null),
      closeIfOpen: jest.fn().mockResolvedValue(true),
      findById: jest.fn().mockImplementation(async (id: string) => (stored && stored.id === id ? { ...stored } : null)),
      // Like the real one: clears the stamp it was given, and only that one.
      clearWaitOwed: jest.fn().mockImplementation(async (id: string, stamp: Date) => {
        if (stored && stored.id === id && stored.waitOwedAt && stored.waitOwedAt.getTime() === stamp.getTime()) stored.waitOwedAt = null
      }),
      findOwingWait: jest.fn().mockResolvedValue([]),
    }
    websocketDispatcher = {
      sendOfferToCourier: jest.fn().mockResolvedValue(undefined),
      sendOfferEnded: jest.fn().mockResolvedValue(undefined),
      dispatchDeliveryStatusUpdated: jest.fn().mockResolvedValue(undefined),
      sendSplitRequestDecided: jest.fn().mockResolvedValue(undefined),
    }
    offerPushService = {
      newOffer: jest.fn(),
      offerEnded: jest.fn(),
      jobCancelled: jest.fn(),
      splitRequestDecided: jest.fn(),
    }
    instanceConfig = {
      getWaitPayEnabled: jest.fn().mockResolvedValue(true),
      getWaitPayCentsPerMinute: jest.fn().mockResolvedValue(10),
      getWaitPayFreeMinutes: jest.fn().mockResolvedValue(5),
      getWaitLimitMinutes: jest.fn().mockResolvedValue(10),
      getOfferExpiryEnabled: jest.fn().mockResolvedValue(false),
      getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
      getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
      getNoCourierRetrySeconds: jest.fn().mockResolvedValue(30),
      getReassignmentPayoutPolicies: jest.fn().mockResolvedValue({ FULL_COMPENSATION: 100, HALF_COMPENSATION: 50, NO_COMPENSATION: 0 }),
      getCancellationPayoutPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
    }

    // The same argument order as the service's constructor; the last is the new split request repository.
    service = new DeliveryEventService(
      { get: jest.fn() } as any,
      websocketDispatcher,
      courierRepository,
      deliveryRepository,
      deliveryEventRepository,
      { scheduleTask: jest.fn().mockResolvedValue(undefined) } as any,
      { registerTaskHandler: jest.fn() } as any,
      { sendDeliveryUpdatePartnerWebhook: jest.fn().mockResolvedValue(undefined) } as any,
      { matchDeliveryToCourier: jest.fn() } as any,
      { calculateDeliveryAmountsForMatchedCourier: jest.fn() } as any,
      { addJob: jest.fn().mockResolvedValue(undefined), removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue([]) } as any,
      { instanceConfig } as any,
      { getOrDefault: jest.fn().mockResolvedValue([]), save: jest.fn().mockResolvedValue(undefined) } as any,
      offerPushService,
      { findOn: jest.fn().mockResolvedValue(null) } as any,
      { getRoute: jest.fn() } as any,
      courierCompensationRepository,
      partnerChargeRepository,
      removalRequestRepository,
      undefined,
      splitRequestRepository
    )
  })

  afterEach(() => jest.restoreAllMocks())

  // ---------------------------------------------------------------------------------------------
  describe('settleSplitWait (AC-3)', () => {
    it('pays the rider one WAITING award (policy SPLIT_WAIT) at the co-op rate, keyed by the split request', async () => {
      // 7 minutes at 10 cents a minute = 70 cents.
      await settle(EnumSplitRequestStatus.CONFIRMED, 7)

      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledTimes(1)
      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 70,
          currencyCode: 'EUR',
          reason: EnumCourierCompensationReason.WAITING,
          policy: 'SPLIT_WAIT',
          waitMinutes: 7,
          courierId: COURIER_ID,
          deliveryId: DELIVERY_ID,
          splitWaitOf: REQUEST_ID,
        })
      )
    })

    it('has no free minutes: one whole minute already pays, even though the ordinary wait has 5 free', async () => {
      await settle(EnumSplitRequestStatus.CONFIRMED, 1)
      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 10, waitMinutes: 1 })
      )
    })

    it('rounds down to whole minutes: 3 min 59 s pays 3 minutes', async () => {
      await settle(EnumSplitRequestStatus.CONFIRMED, 3, 59)
      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 30, waitMinutes: 3 })
      )
    })

    it('reads the rate from the co-op setting, never a fixed number (binding value 2)', async () => {
      instanceConfig.getWaitPayCentsPerMinute.mockResolvedValue(25)
      await settle(EnumSplitRequestStatus.CONFIRMED, 4)
      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100, waitMinutes: 4 })
      )
    })

    it('writes a COURIER_PAID_FOR_WAIT event naming the rider, the amount and the split request, with no status change', async () => {
      await settle(EnumSplitRequestStatus.CONFIRMED, 7)

      const paid = savedOfType(EnumDeliveryEventType.COURIER_PAID_FOR_WAIT)
      expect(paid).toHaveLength(1)
      expect(paid[0]).toMatchObject({
        deliveryId: DELIVERY_ID,
        courierId: COURIER_ID,
        actor: EnumEventActor.SYSTEM,
        eventSource: EnumDeliveryEventSource.OPENCOURIER,
        transitionSuccessful: true,
        oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        newStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      })
      expect(paid[0].message).toContain('70 EUR')
      expect(paid[0].message).toContain(`split ${REQUEST_ID}`)
    })

    it('charges the restaurant the same amount as one WAITING charge keyed by the split request, when asked to', async () => {
      await settle(EnumSplitRequestStatus.CONFIRMED, 7)

      expect(partnerChargeRepository.createSplitWaitChargeOnce).toHaveBeenCalledTimes(1)
      expect(partnerChargeRepository.createSplitWaitChargeOnce).toHaveBeenCalledWith({
        partnerId: PARTNER_ID,
        deliveryId: DELIVERY_ID,
        amount: 70,
        currencyCode: 'EUR',
        reason: EnumPartnerChargeReason.WAITING,
        waitMinutes: 7,
        splitWaitOf: REQUEST_ID,
      })
    })

    it('the charge equals what the rider was actually paid (the stored award), not a second sum', async () => {
      // A retry: the award already on record is 70, even if the clock now says 9 minutes.
      courierCompensationRepository.createSplitWaitPayOnce.mockResolvedValue({
        id: 'comp-existing',
        amount: 70,
        currencyCode: 'EUR',
        waitMinutes: 7,
        courierId: COURIER_ID,
        message: 'Waited 7 min while dispatch split the order, at 10 cents a minute',
      })

      await settle(EnumSplitRequestStatus.CONFIRMED, 9)

      expect(partnerChargeRepository.createSplitWaitChargeOnce).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 70, waitMinutes: 7, splitWaitOf: REQUEST_ID })
      )
    })

    it('refused split (cross check 1): the rider is paid and the event written, the restaurant is NOT charged', async () => {
      await settle(EnumSplitRequestStatus.REFUSED, 7)

      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 70, splitWaitOf: REQUEST_ID })
      )
      expect(savedOfType(EnumDeliveryEventType.COURIER_PAID_FOR_WAIT)).toHaveLength(1)
      expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
    })

    it('with a rate of 0 at the settle, nothing is paid, charged or recorded', async () => {
      instanceConfig.getWaitPayCentsPerMinute.mockResolvedValue(0)
      await settle(EnumSplitRequestStatus.CONFIRMED, 7)
      expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
      expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
      expect(deliveryEventRepository.create).not.toHaveBeenCalled()
    })

    it('an answer inside the first minute pays nothing and writes no empty rows', async () => {
      await settle(EnumSplitRequestStatus.CONFIRMED, 0, 59)
      expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
      expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
      expect(deliveryEventRepository.create).not.toHaveBeenCalled()
    })

    it('a delivery with no restaurant: the rider is paid, nobody is charged, and a warning is logged (cross check 13)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn')
      deliveryRepository.findByIdOrThrow.mockResolvedValue(makeDelivery({ partnerId: null }))

      await settle(EnumSplitRequestStatus.CONFIRMED, 7)

      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledTimes(1)
      expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalled()
    })

    it('never throws: a failed write is logged, so the split itself is not undone by its wait pay', async () => {
      const error = jest.spyOn(Logger.prototype, 'error')
      courierCompensationRepository.createSplitWaitPayOnce.mockRejectedValue(new Error('database is down'))

      await expect(settle(EnumSplitRequestStatus.CONFIRMED, 7)).resolves.toBeUndefined()

      expect(error).toHaveBeenCalled()
      expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
    })

    // ---- Row 11 review: the wait is settled from the stored request and its stamp ----

    it('pays the minutes from the flag to the stored close time, whenever the settle runs', async () => {
      jest.useFakeTimers()
      try {
        // Closed 7 minutes after the flag; the sweep settles it three hours later.
        closeStored(EnumSplitRequestStatus.REFUSED, 7)
        jest.setSystemTime(minutesAfterFlag(187))

        await service.settleSplitWait(REQUEST_ID)

        expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
          expect.objectContaining({ amount: 70, waitMinutes: 7 })
        )
      } finally {
        jest.useRealTimers()
      }
    })

    it.each([
      [EnumSplitRequestStatus.CONFIRMED, true],
      [EnumSplitRequestStatus.LEFT, true],
      [EnumSplitRequestStatus.REFUSED, false],
      [EnumSplitRequestStatus.VOID, false],
    ])('a %s request: the rider is paid; the restaurant charged = %s (cross check 1, decision 11.1)', async (status, charged) => {
      await settle(status, 7)

      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledTimes(1)
      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(expect.objectContaining({ amount: 70 }))
      expect(savedOfType(EnumDeliveryEventType.COURIER_PAID_FOR_WAIT)).toHaveLength(1)
      expect(partnerChargeRepository.createSplitWaitChargeOnce).toHaveBeenCalledTimes(charged ? 1 : 0)
    })

    describe('the stamp (waitOwedAt)', () => {
      it('with no stamp the settle does nothing at all: no pay, no event, no charge, no read of the delivery', async () => {
        closeStored(EnumSplitRequestStatus.CONFIRMED, 7, 0, { waitOwedAt: null })

        await service.settleSplitWait(REQUEST_ID)

        expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
        expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
        expect(deliveryEventRepository.create).not.toHaveBeenCalled()
        expect(splitRequestRepository.clearWaitOwed).not.toHaveBeenCalled()
      })

      it('a request that does not exist is left alone, and nothing throws', async () => {
        await expect(service.settleSplitWait('no-such-request')).resolves.toBeUndefined()

        expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
        expect(splitRequestRepository.clearWaitOwed).not.toHaveBeenCalled()
      })

      it('is cleared once the pay, its event and the charge exist, and only after all three', async () => {
        const order: string[] = []
        courierCompensationRepository.createSplitWaitPayOnce.mockImplementation(async (input: any) => {
          order.push('pay')
          return { id: 'comp-split-wait', ...input }
        })
        deliveryEventRepository.create.mockImplementation(async (data: any) => {
          order.push(`event:${data.type}`)
          return { id: `evt-${data.type}`, ...data }
        })
        partnerChargeRepository.createSplitWaitChargeOnce.mockImplementation(async (input: any) => {
          order.push('charge')
          return { id: 'charge-split-wait', ...input }
        })
        splitRequestRepository.clearWaitOwed.mockImplementation(async () => {
          order.push('clear')
          stored.waitOwedAt = null
        })

        await settle(EnumSplitRequestStatus.CONFIRMED, 7)

        expect(order).toEqual(['pay', `event:${EnumDeliveryEventType.COURIER_PAID_FOR_WAIT}`, 'charge', 'clear'])
        // The stamp that was read is the one cleared, so a newer stamp is never wiped by an older run.
        expect(splitRequestRepository.clearWaitOwed).toHaveBeenCalledWith(REQUEST_ID, minutesAfterFlag(7))
        expect(stored.waitOwedAt).toBeNull()
      })

      it('a refusal has no charge to wait for: cleared after the pay and its event', async () => {
        await settle(EnumSplitRequestStatus.REFUSED, 7)

        expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
        expect(splitRequestRepository.clearWaitOwed).toHaveBeenCalledTimes(1)
        expect(stored.waitOwedAt).toBeNull()
      })

      it.each([
        ['the pay', () => courierCompensationRepository.createSplitWaitPayOnce.mockRejectedValue(new Error('database is down'))],
        ['the paid event', () => deliveryEventRepository.create.mockRejectedValue(new Error('database is down'))],
        ['the charge', () => partnerChargeRepository.createSplitWaitChargeOnce.mockRejectedValue(new Error('database is down'))],
        ['the read of the delivery', () => deliveryRepository.findByIdOrThrow.mockRejectedValue(new Error('database is down'))],
        ['the read of the rate', () => instanceConfig.getWaitPayCentsPerMinute.mockRejectedValue(new Error('redis is down'))],
      ])('stays set when %s fails, so the sweep tries again, and the failure is logged', async (_name, breakIt) => {
        const error = jest.spyOn(Logger.prototype, 'error')
        breakIt()

        await expect(settle(EnumSplitRequestStatus.CONFIRMED, 7)).resolves.toBeUndefined()

        expect(splitRequestRepository.clearWaitOwed).not.toHaveBeenCalled()
        expect(stored.waitOwedAt).toEqual(minutesAfterFlag(7))
        expect(error).toHaveBeenCalled()
      })
    })

    describe('splitWaitOwedAt: what a closing write stores', () => {
      it('the close time, when wait pay is on, the rate is above 0 and a whole minute passed', async () => {
        expect(await service.splitWaitOwedAt(FLAGGED_AT, minutesAfterFlag(7))).toEqual(minutesAfterFlag(7))
        expect(await service.splitWaitOwedAt(FLAGGED_AT, minutesAfterFlag(1))).toEqual(minutesAfterFlag(1))
      })

      it('nothing with wait pay switched off (spec 0033 AC-1)', async () => {
        instanceConfig.getWaitPayEnabled.mockResolvedValue(false)
        expect(await service.splitWaitOwedAt(FLAGGED_AT, minutesAfterFlag(7))).toBeNull()
      })

      it('nothing with a rate of 0', async () => {
        instanceConfig.getWaitPayCentsPerMinute.mockResolvedValue(0)
        expect(await service.splitWaitOwedAt(FLAGGED_AT, minutesAfterFlag(7))).toBeNull()
      })

      it('nothing for an answer inside the first minute', async () => {
        expect(await service.splitWaitOwedAt(FLAGGED_AT, minutesAfterFlag(0, 59))).toBeNull()
      })

      it('if the settings cannot be read the wait is stamped anyway: an unpaid rider is the worse mistake (value 4)', async () => {
        instanceConfig.getWaitPayEnabled.mockRejectedValue(new Error('redis is down'))
        expect(await service.splitWaitOwedAt(FLAGGED_AT, minutesAfterFlag(7))).toEqual(minutesAfterFlag(7))
      })
    })

    describe('settleOwedSplitWaits: the minute sweep tries again', () => {
      const SINCE = new Date('2026-11-20T12:30:00.000Z')
      const BEFORE = new Date('2026-11-21T12:29:00.000Z')

      it('asks for the requests still owing inside the window it was given, settles each, and says how many', async () => {
        closeStored(EnumSplitRequestStatus.CONFIRMED, 7)
        splitRequestRepository.findOwingWait.mockResolvedValue([{ id: REQUEST_ID }, { id: 'a-request-since-deleted' }])

        const tried = await service.settleOwedSplitWaits(SINCE, BEFORE)

        expect(splitRequestRepository.findOwingWait).toHaveBeenCalledWith(SINCE, BEFORE)
        expect(tried).toBe(2)
        expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledTimes(1)
        expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
          expect.objectContaining({ amount: 70, splitWaitOf: REQUEST_ID })
        )
        expect(stored.waitOwedAt).toBeNull()
      })

      it('with nothing owing it writes nothing', async () => {
        expect(await service.settleOwedSplitWaits(SINCE, BEFORE)).toBe(0)
        expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
      })

      it('one request that fails again does not stop the next one being settled', async () => {
        closeStored(EnumSplitRequestStatus.REFUSED, 7)
        const other = { ...stored, id: 'split-req-2' }
        splitRequestRepository.findById.mockImplementation(async (id: string) => {
          if (id === 'split-req-broken') throw new Error('database hiccup')
          return id === other.id ? other : null
        })
        splitRequestRepository.findOwingWait.mockResolvedValue([{ id: 'split-req-broken' }, { id: other.id }])

        await expect(service.settleOwedSplitWaits(SINCE, BEFORE)).resolves.toBe(2)

        expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
          expect.objectContaining({ splitWaitOf: 'split-req-2' })
        )
      })
    })

    describe('a retry never pays or charges twice', () => {
      // "Once" writers as the database keeps them: one row per split request, the first one wins.
      let awards: Map<string, any>
      let charges: Map<string, any>
      let paidMessages: string[]

      beforeEach(() => {
        awards = new Map()
        charges = new Map()
        paidMessages = []
        courierCompensationRepository.createSplitWaitPayOnce.mockImplementation(async (input: any) => {
          if (!awards.has(input.splitWaitOf)) awards.set(input.splitWaitOf, { id: 'comp-split-wait', ...input })
          return awards.get(input.splitWaitOf)
        })
        partnerChargeRepository.createSplitWaitChargeOnce.mockImplementation(async (input: any) => {
          if (!charges.has(input.splitWaitOf)) charges.set(input.splitWaitOf, { id: 'charge-split-wait', ...input })
          return charges.get(input.splitWaitOf)
        })
        deliveryEventRepository.create.mockImplementation(async (data: any) => {
          if (data.type === EnumDeliveryEventType.COURIER_PAID_FOR_WAIT) paidMessages.push(data.message)
          return { id: `evt-${data.type}`, ...data }
        })
        deliveryEventRepository.findWaitPaidMessages.mockImplementation(async () => [...paidMessages])
      })

      it('the event write fails the first time: the stamp stays, and the sweep finishes it with one award, one event, one charge', async () => {
        deliveryEventRepository.create.mockRejectedValueOnce(new Error('database is down'))

        await settle(EnumSplitRequestStatus.CONFIRMED, 7)
        // The award is written, the event and the charge are not, and the request still owes.
        expect(awards.size).toBe(1)
        expect(paidMessages).toHaveLength(0)
        expect(charges.size).toBe(0)
        expect(stored.waitOwedAt).toEqual(minutesAfterFlag(7))

        // The minute sweep finds it and tries again.
        splitRequestRepository.findOwingWait.mockResolvedValue([{ id: REQUEST_ID }])
        await service.settleOwedSplitWaits(new Date(0), minutesAfterFlag(60))

        expect(awards.size).toBe(1)
        expect(awards.get(REQUEST_ID).amount).toBe(70)
        expect(paidMessages).toHaveLength(1)
        expect(charges.size).toBe(1)
        expect(charges.get(REQUEST_ID).amount).toBe(70)
        expect(stored.waitOwedAt).toBeNull()
      })

      it('a request settled in full and stamped again by hand still has one award, one paid event and one charge', async () => {
        await settle(EnumSplitRequestStatus.LEFT, 10)
        expect(stored.waitOwedAt).toBeNull()

        stored.waitOwedAt = minutesAfterFlag(10)
        await service.settleSplitWait(REQUEST_ID)

        expect(awards.size).toBe(1)
        expect(paidMessages).toHaveLength(1)
        expect(charges.size).toBe(1)
        expect(charges.get(REQUEST_ID).amount).toBe(100)
        expect(stored.waitOwedAt).toBeNull()
      })

      it('once the stamp is cleared, a second sweep pass writes nothing more', async () => {
        await settle(EnumSplitRequestStatus.REFUSED, 7)
        const calls = courierCompensationRepository.createSplitWaitPayOnce.mock.calls.length

        await service.settleSplitWait(REQUEST_ID)

        expect(courierCompensationRepository.createSplitWaitPayOnce.mock.calls.length).toBe(calls)
        expect(paidMessages).toHaveLength(1)
      })
    })

    describe('AC-11: the wait cannot be paid twice', () => {
      it('the award and the charge always go through the "once" writers with the request id as their key', async () => {
        await settle(EnumSplitRequestStatus.CONFIRMED, 7)

        const award = courierCompensationRepository.createSplitWaitPayOnce.mock.calls[0][0]
        const charge = partnerChargeRepository.createSplitWaitChargeOnce.mock.calls[0][0]
        expect(award.splitWaitOf).toBe(REQUEST_ID)
        expect(charge.splitWaitOf).toBe(REQUEST_ID)
      })

      it('settling the same request twice writes the paid event once only', async () => {
        await settle(EnumSplitRequestStatus.CONFIRMED, 7)
        // The second run finds the first run's event on the record.
        const firstMessage = savedOfType(EnumDeliveryEventType.COURIER_PAID_FOR_WAIT)[0].message
        deliveryEventRepository.findWaitPaidMessages.mockResolvedValue([firstMessage])
        // And the "once" writer hands back the row that is already there.
        courierCompensationRepository.createSplitWaitPayOnce.mockResolvedValue({
          id: 'comp-split-wait',
          amount: 70,
          currencyCode: 'EUR',
          waitMinutes: 7,
          courierId: COURIER_ID,
          message: 'Waited 7 min while dispatch split the order, at 10 cents a minute',
        })

        await settle(EnumSplitRequestStatus.CONFIRMED, 8)

        expect(savedOfType(EnumDeliveryEventType.COURIER_PAID_FOR_WAIT)).toHaveLength(1)
        // Both runs asked with the same key, so the database's unique index allows one row each.
        const awardKeys = courierCompensationRepository.createSplitWaitPayOnce.mock.calls.map((call: any[]) => call[0].splitWaitOf)
        const chargeKeys = partnerChargeRepository.createSplitWaitChargeOnce.mock.calls.map((call: any[]) => call[0].splitWaitOf)
        expect(awardKeys).toEqual([REQUEST_ID, REQUEST_ID])
        expect(chargeKeys).toEqual([REQUEST_ID, REQUEST_ID])
      })

      it("another split request's paid event on the same delivery does not hide this one's", async () => {
        deliveryEventRepository.findWaitPaidMessages.mockResolvedValue([
          `Courier ${COURIER_ID} paid 20 EUR (cents): Waited 2 min while dispatch split the order, at 10 cents a minute; split an-earlier-request`,
        ])

        await settle(EnumSplitRequestStatus.REFUSED, 7)

        expect(savedOfType(EnumDeliveryEventType.COURIER_PAID_FOR_WAIT)).toHaveLength(1)
      })
    })
  })

  // ---------------------------------------------------------------------------------------------
  describe('recordSplitEvent: a split event changes no status', () => {
    it('saves the event as successful with the old status equal to the new, naming the rider', async () => {
      await service.recordSplitEvent(
        {
          deliveryId: DELIVERY_ID,
          type: EnumDeliveryEventType.SPLIT_REQUESTED,
          actor: EnumEventActor.COURIER,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId: COURIER_ID,
          message: 'Rider asked to split the order: 2 boxes: Large and Small',
        },
        EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION
      )

      expect(savedEvents()).toEqual([
        expect.objectContaining({
          deliveryId: DELIVERY_ID,
          type: EnumDeliveryEventType.SPLIT_REQUESTED,
          courierId: COURIER_ID,
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          newStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          message: 'Rider asked to split the order: 2 boxes: Large and Small',
        }),
      ])
      // The delivery itself is never written.
      expect(deliveryRepository.update).not.toHaveBeenCalled()
      expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
    })

    it.each([
      EnumDeliveryEventType.SPLIT_REQUESTED,
      EnumDeliveryEventType.SPLIT_CONFIRMED,
      EnumDeliveryEventType.SPLIT_REFUSED,
      EnumDeliveryEventType.SPLIT_CLOSED,
    ])('%s names its rider in the courierId column, so it is on that rider\'s record', async (type) => {
      await service.recordSplitEvent(
        { deliveryId: DELIVERY_ID, type, actor: EnumEventActor.ADMIN, source: EnumDeliveryEventSource.OPENCOURIER, courierId: COURIER_ID } as any,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION
      )
      expect(savedEvents()[0].courierId).toBe(COURIER_ID)
    })
  })

  // ---------------------------------------------------------------------------------------------
  describe('processDeliveryEvent refuses the split events (an admin cannot post one)', () => {
    it('lists the spec\'s four event types, plus the close and the voided charge', () => {
      expect([...SPLIT_EVENT_TYPES].sort()).toEqual(
        [
          EnumDeliveryEventType.SPLIT_REQUESTED,
          EnumDeliveryEventType.SPLIT_CONFIRMED,
          EnumDeliveryEventType.SPLIT_REFUSED,
          EnumDeliveryEventType.PARTNER_CHARGED_FOR_SPLIT,
          EnumDeliveryEventType.SPLIT_CLOSED,
          EnumDeliveryEventType.PARTNER_SPLIT_CHARGE_VOIDED,
        ].sort()
      )
    })

    it.each([
      EnumDeliveryEventType.SPLIT_REQUESTED,
      EnumDeliveryEventType.SPLIT_CONFIRMED,
      EnumDeliveryEventType.SPLIT_REFUSED,
      EnumDeliveryEventType.SPLIT_CLOSED,
      EnumDeliveryEventType.PARTNER_CHARGED_FOR_SPLIT,
      EnumDeliveryEventType.PARTNER_SPLIT_CHARGE_VOIDED,
    ])('%s posted as an ordinary event is saved as a failed row, changes nothing and pays nothing', async (type) => {
      await service.processDeliveryEvent({
        deliveryId: DELIVERY_ID,
        type,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: COURIER_ID,
      } as any)

      expect(savedEvents()).toHaveLength(1)
      expect(savedEvents()[0]).toMatchObject({ type, transitionSuccessful: false })
      expect(savedEvents()[0].message).toContain('is recorded by a split request only')
      expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
      expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
      expect(splitRequestRepository.closeIfOpen).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------------------------
  describe('an open request closes as VOID when the delivery ends or the rider is taken off (cross check 6)', () => {
    const openRequest = { ...request, status: EnumSplitRequestStatus.OPEN, openFor: DELIVERY_ID }

    // Saves a successful event the way processDeliveryEvent does once a status write went through.
    const saveMoved = (type: EnumDeliveryEventType, oldStatus: EnumDeliveryStatus, newStatus: EnumDeliveryStatus) =>
      (service as any).saveDeliveryEvent(
        { deliveryId: DELIVERY_ID, type, actor: EnumEventActor.ADMIN, source: EnumDeliveryEventSource.OPENCOURIER },
        { transitionSuccessful: true, oldStatus, newStatus }
      )

    beforeEach(() => {
      jest.useFakeTimers()
      // Three and a half minutes after the flag: three whole minutes are owed.
      jest.setSystemTime(minutesAfterFlag(3, 30))
      splitRequestRepository.findOpenForDelivery.mockResolvedValue(openRequest)
      // Like the real repository: once closed, the request is no longer found as open. Without this the
      // close's own SPLIT_CLOSED event would find it "open" again, for ever.
      // The closing write is kept (its status, close time and stamp), as the settle reads the stored row.
      splitRequestRepository.closeIfOpen.mockImplementation(async (_id: string, data: object) => {
        splitRequestRepository.findOpenForDelivery.mockResolvedValue(null)
        stored = { ...openRequest, ...data }
        return true
      })
    })
    afterEach(() => jest.useRealTimers())

    it.each([
      ['a cancellation', EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.CANCELED],
      ['a failure', EnumDeliveryEventType.FAILED, EnumDeliveryStatus.FAILED],
      ['a reassignment', EnumDeliveryEventType.REASSIGNED, EnumDeliveryStatus.ASSIGNING_COURIER],
      ['a dispatch stop', EnumDeliveryEventType.RETURNED_TO_WAITING, EnumDeliveryStatus.ASSIGNING_COURIER],
      ['an approved removal', EnumDeliveryEventType.REMOVAL_APPROVED, EnumDeliveryStatus.ASSIGNING_COURIER],
      // Row 11 review: an admin posting the pickup used to leave the request open for ever.
      ["a pickup posted by an admin", EnumDeliveryEventType.PICKED_UP, EnumDeliveryStatus.PICKED_UP],
    ])('%s closes it as VOID, records SPLIT_CLOSED and pays the wait up to that moment', async (_name, type, newStatus) => {
      await saveMoved(type, EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, newStatus)

      expect(splitRequestRepository.closeIfOpen).toHaveBeenCalledWith(
        REQUEST_ID,
        expect.objectContaining({ status: EnumSplitRequestStatus.VOID, answeredAt: minutesAfterFlag(3, 30) })
      )
      // The close is on the record (binding value 1), naming the rider, with no status change of its own.
      const closed = savedOfType(EnumDeliveryEventType.SPLIT_CLOSED)
      expect(closed).toHaveLength(1)
      expect(closed[0]).toMatchObject({
        deliveryId: DELIVERY_ID,
        courierId: COURIER_ID,
        actor: EnumEventActor.SYSTEM,
        transitionSuccessful: true,
        oldStatus: newStatus,
        newStatus,
      })
      expect(closed[0].message).toContain(REQUEST_ID)
      // The rider is paid the 3 whole minutes they waited.
      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledTimes(1)
      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 30, waitMinutes: 3, courierId: COURIER_ID, splitWaitOf: REQUEST_ID, policy: 'SPLIT_WAIT' })
      )
      expect(savedOfType(EnumDeliveryEventType.COURIER_PAID_FOR_WAIT)).toHaveLength(1)
    })

    it('a VOID close does not charge the restaurant: nothing showed it picked the wrong size (decision 11.1)', async () => {
      await saveMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, EnumDeliveryStatus.CANCELED)
      expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
    })

    describe('row 11 review: any move off the restaurant status, and never the split events themselves', () => {
      it('the closing write stores the stamp: the wait is owed from the moment of the close', async () => {
        await saveMoved(EnumDeliveryEventType.PICKED_UP, EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, EnumDeliveryStatus.PICKED_UP)

        expect(splitRequestRepository.closeIfOpen).toHaveBeenCalledWith(REQUEST_ID, {
          status: EnumSplitRequestStatus.VOID,
          answeredAt: minutesAfterFlag(3, 30),
          waitOwedAt: minutesAfterFlag(3, 30),
        })
        // Paid in the same step, so the stamp is cleared again.
        expect(stored.waitOwedAt).toBeNull()
      })

      it('with wait pay switched off the close stores no stamp, and nothing is paid', async () => {
        instanceConfig.getWaitPayEnabled.mockResolvedValue(false)

        await saveMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, EnumDeliveryStatus.CANCELED)

        expect(splitRequestRepository.closeIfOpen).toHaveBeenCalledWith(
          REQUEST_ID,
          expect.objectContaining({ status: EnumSplitRequestStatus.VOID, waitOwedAt: null })
        )
        // The close is still on the record.
        expect(savedOfType(EnumDeliveryEventType.SPLIT_CLOSED)).toHaveLength(1)
        expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
        expect(savedOfType(EnumDeliveryEventType.COURIER_PAID_FOR_WAIT)).toHaveLength(0)
      })

      it('a request closed inside the first minute stores no stamp', async () => {
        jest.setSystemTime(minutesAfterFlag(0, 40))

        await saveMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, EnumDeliveryStatus.CANCELED)

        expect(splitRequestRepository.closeIfOpen).toHaveBeenCalledWith(REQUEST_ID, expect.objectContaining({ waitOwedAt: null }))
        expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
      })

      it('the close cannot re-enter itself: even if the request still reads as open, it is closed and recorded once', async () => {
        // The hard case: the read keeps finding the request open while the close's own events are saved.
        splitRequestRepository.closeIfOpen.mockImplementation(async (_id: string, data: object) => {
          stored = { ...openRequest, ...data }
          return true
        })

        await saveMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, EnumDeliveryStatus.CANCELED)

        expect(splitRequestRepository.closeIfOpen).toHaveBeenCalledTimes(1)
        expect(savedOfType(EnumDeliveryEventType.SPLIT_CLOSED)).toHaveLength(1)
        expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledTimes(1)
      })

      it.each([
        EnumDeliveryEventType.SPLIT_REQUESTED,
        EnumDeliveryEventType.SPLIT_CONFIRMED,
        EnumDeliveryEventType.SPLIT_REFUSED,
        EnumDeliveryEventType.SPLIT_CLOSED,
        EnumDeliveryEventType.PARTNER_CHARGED_FOR_SPLIT,
      ])('recording %s never closes the open request (it keeps the status)', async (type) => {
        await service.recordSplitEvent(
          { deliveryId: DELIVERY_ID, type, actor: EnumEventActor.ADMIN, source: EnumDeliveryEventSource.OPENCOURIER, courierId: COURIER_ID } as any,
          EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION
        )

        expect(splitRequestRepository.findOpenForDelivery).not.toHaveBeenCalled()
        expect(splitRequestRepository.closeIfOpen).not.toHaveBeenCalled()
        expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
      })

      it("the paid event of the rider's wait does not close anything either", async () => {
        // An event saved while the delivery stays at the restaurant.
        await saveMoved(
          EnumDeliveryEventType.COURIER_PAID_FOR_WAIT,
          EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION
        )

        expect(splitRequestRepository.closeIfOpen).not.toHaveBeenCalled()
      })

      it('the wait is still settled when the SPLIT_CLOSED record cannot be written, and the failure is logged', async () => {
        const error = jest.spyOn(Logger.prototype, 'error')
        deliveryEventRepository.create.mockImplementation(async (data: any) => {
          if (data.type === EnumDeliveryEventType.SPLIT_CLOSED) throw new Error('database is down')
          return { id: `evt-${data.type}`, ...data }
        })

        await saveMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, EnumDeliveryStatus.CANCELED)

        expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
          expect.objectContaining({ amount: 30, splitWaitOf: REQUEST_ID })
        )
        expect(savedOfType(EnumDeliveryEventType.COURIER_PAID_FOR_WAIT)).toHaveLength(1)
        expect(error).toHaveBeenCalled()
      })

      it('end to end: an admin posting PICKED_UP through processDeliveryEvent closes the request as VOID and pays the rider, the co-op\'s cost', async () => {
        await service.processDeliveryEvent({
          deliveryId: DELIVERY_ID,
          type: EnumDeliveryEventType.PICKED_UP,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
        })

        expect(splitRequestRepository.closeIfOpen).toHaveBeenCalledTimes(1)
        expect(splitRequestRepository.closeIfOpen).toHaveBeenCalledWith(REQUEST_ID, expect.objectContaining({ status: EnumSplitRequestStatus.VOID }))
        expect(savedOfType(EnumDeliveryEventType.SPLIT_CLOSED)).toHaveLength(1)
        expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
          expect.objectContaining({ amount: 30, splitWaitOf: REQUEST_ID, policy: 'SPLIT_WAIT' })
        )
        expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
      })
    })

    it('a step that keeps the rider on the job (a move between ongoing statuses) leaves the request open', async () => {
      await saveMoved(EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, EnumDeliveryStatus.DISPATCHED, EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)

      expect(splitRequestRepository.closeIfOpen).not.toHaveBeenCalled()
      expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
      expect(savedOfType(EnumDeliveryEventType.SPLIT_CLOSED)).toHaveLength(0)
    })

    it('a failed transition (a step that lost a race) leaves the request open', async () => {
      await (service as any).saveDeliveryEvent(
        { deliveryId: DELIVERY_ID, type: EnumDeliveryEventType.CANCELED, actor: EnumEventActor.ADMIN, source: EnumDeliveryEventSource.OPENCOURIER },
        { transitionSuccessful: false, oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, newStatus: EnumDeliveryStatus.CANCELED }
      )
      expect(splitRequestRepository.closeIfOpen).not.toHaveBeenCalled()
      expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
    })

    it('when the request was closed by someone else first (the conditional write misses), nothing is recorded or paid here', async () => {
      splitRequestRepository.closeIfOpen.mockResolvedValue(false)

      await saveMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, EnumDeliveryStatus.CANCELED)

      expect(savedOfType(EnumDeliveryEventType.SPLIT_CLOSED)).toHaveLength(0)
      expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
    })

    it('with no open request, a cancellation writes no split close and no split wait', async () => {
      splitRequestRepository.findOpenForDelivery.mockResolvedValue(null)

      await saveMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, EnumDeliveryStatus.CANCELED)

      expect(splitRequestRepository.closeIfOpen).not.toHaveBeenCalled()
      expect(savedOfType(EnumDeliveryEventType.SPLIT_CLOSED)).toHaveLength(0)
      expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
    })

    it('a failure while closing never breaks the event that ended the delivery', async () => {
      splitRequestRepository.findOpenForDelivery.mockRejectedValue(new Error('database is down'))

      await expect(
        saveMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, EnumDeliveryStatus.CANCELED)
      ).resolves.toMatchObject({ type: EnumDeliveryEventType.CANCELED })
    })

    it('end to end: a customer cancel through processDeliveryEvent closes the open request as VOID and pays the rider', async () => {
      deliveryRepository.findById.mockResolvedValue(
        makeDelivery({ status: EnumDeliveryStatus.CANCELED, cancelledFromStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION })
      )

      await service.processDeliveryEvent({
        deliveryId: DELIVERY_ID,
        type: EnumDeliveryEventType.CANCELED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
        cancelledBy: EnumCancelledBy.CUSTOMER,
      })

      expect(splitRequestRepository.closeIfOpen).toHaveBeenCalledTimes(1)
      expect(splitRequestRepository.closeIfOpen).toHaveBeenCalledWith(REQUEST_ID, expect.objectContaining({ status: EnumSplitRequestStatus.VOID }))
      expect(savedOfType(EnumDeliveryEventType.SPLIT_CLOSED)).toHaveLength(1)
      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledTimes(1)
      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 30, splitWaitOf: REQUEST_ID })
      )
      expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------------------------
  describe("a new leg that ends before any rider accepted it gives its charge back (cross check 5)", () => {
    const LEG_ID = 'new-leg-2'
    const voidedCharge = { id: 'charge-leg-2', amount: 356, currencyCode: 'EUR', splitLegOf: LEG_ID, billId: null }

    const saveLegMoved = (type: EnumDeliveryEventType, oldStatus: EnumDeliveryStatus, newStatus: EnumDeliveryStatus) =>
      (service as any).saveDeliveryEvent(
        { deliveryId: LEG_ID, type, actor: EnumEventActor.ADMIN, source: EnumDeliveryEventSource.OPENCOURIER },
        { transitionSuccessful: true, oldStatus, newStatus }
      )

    it.each([
      ['cancelled while looking for a rider', EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.ASSIGNING_COURIER, EnumDeliveryStatus.CANCELED],
      ['failed while looking for a rider', EnumDeliveryEventType.FAILED, EnumDeliveryStatus.ASSIGNING_COURIER, EnumDeliveryStatus.FAILED],
      ['cancelled before it was even started', EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.CREATED, EnumDeliveryStatus.CANCELED],
    ])('%s: the SPLIT_LEG charge is deleted and PARTNER_SPLIT_CHARGE_VOIDED recorded with the amount', async (_name, type, oldStatus, newStatus) => {
      partnerChargeRepository.deleteUnbilledSplitLegCharge.mockResolvedValue({ removed: voidedCharge, kept: null })

      await saveLegMoved(type, oldStatus, newStatus)

      expect(deliveryEventRepository.hasSuccessfulEvent).toHaveBeenCalledWith(LEG_ID, EnumDeliveryEventType.ACCEPTED)
      expect(partnerChargeRepository.deleteUnbilledSplitLegCharge).toHaveBeenCalledWith(LEG_ID)
      const voided = savedOfType(EnumDeliveryEventType.PARTNER_SPLIT_CHARGE_VOIDED)
      expect(voided).toHaveLength(1)
      expect(voided[0]).toMatchObject({
        deliveryId: LEG_ID,
        actor: EnumEventActor.SYSTEM,
        transitionSuccessful: true,
        oldStatus: newStatus,
        newStatus,
      })
      expect(voided[0].message).toContain('356 EUR')
    })

    it('a leg a rider accepted keeps its charge when it is cancelled later: the rider went', async () => {
      deliveryEventRepository.hasSuccessfulEvent.mockResolvedValue(true)
      partnerChargeRepository.deleteUnbilledSplitLegCharge.mockResolvedValue({ removed: voidedCharge, kept: null })

      await saveLegMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.ACCEPTED, EnumDeliveryStatus.CANCELED)

      expect(partnerChargeRepository.deleteUnbilledSplitLegCharge).not.toHaveBeenCalled()
      expect(savedOfType(EnumDeliveryEventType.PARTNER_SPLIT_CHARGE_VOIDED)).toHaveLength(0)
    })

    it('a delivery that has no split leg charge (an ordinary order) gets no voided event', async () => {
      partnerChargeRepository.deleteUnbilledSplitLegCharge.mockResolvedValue({ removed: null, kept: null })

      await saveLegMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.ASSIGNING_COURIER, EnumDeliveryStatus.CANCELED)

      expect(savedOfType(EnumDeliveryEventType.PARTNER_SPLIT_CHARGE_VOIDED)).toHaveLength(0)
    })

    // Row 11 review: a charge already on a bill stays. Nothing changed, so no event; it is logged by name.
    it('a charge that is already billed stays: no voided event, and a warning names the charge', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn')
      partnerChargeRepository.deleteUnbilledSplitLegCharge.mockResolvedValue({
        removed: null,
        kept: { ...voidedCharge, id: 'charge-billed-9', billId: 'bill-1' },
      })

      await saveLegMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.ASSIGNING_COURIER, EnumDeliveryStatus.CANCELED)

      expect(savedOfType(EnumDeliveryEventType.PARTNER_SPLIT_CHARGE_VOIDED)).toHaveLength(0)
      const warnings = warn.mock.calls.map((call) => String(call[0]))
      expect(warnings.some((line) => line.includes('charge-billed-9') && line.includes(LEG_ID))).toBe(true)
    })

    it('a leg with no charge at all logs no such warning', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn')

      await saveLegMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.ASSIGNING_COURIER, EnumDeliveryStatus.CANCELED)

      expect(warn.mock.calls.map((call) => String(call[0])).some((line) => line.includes('already billed'))).toBe(false)
    })

    it('a leg that goes back to looking for a rider (not ended) keeps its charge', async () => {
      await saveLegMoved(EnumDeliveryEventType.OFFER_EXPIRED, EnumDeliveryStatus.ASSIGNING_COURIER, EnumDeliveryStatus.ASSIGNING_COURIER)
      await saveLegMoved(EnumDeliveryEventType.CREATED, EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER)

      expect(partnerChargeRepository.deleteUnbilledSplitLegCharge).not.toHaveBeenCalled()
      expect(savedOfType(EnumDeliveryEventType.PARTNER_SPLIT_CHARGE_VOIDED)).toHaveLength(0)
    })

    it('the voided event itself does not void again (it is saved with the old status equal to the new)', async () => {
      partnerChargeRepository.deleteUnbilledSplitLegCharge.mockResolvedValue({ removed: voidedCharge, kept: null })

      await saveLegMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.ASSIGNING_COURIER, EnumDeliveryStatus.CANCELED)

      expect(partnerChargeRepository.deleteUnbilledSplitLegCharge).toHaveBeenCalledTimes(1)
      expect(savedOfType(EnumDeliveryEventType.PARTNER_SPLIT_CHARGE_VOIDED)).toHaveLength(1)
    })

    it('a failure while taking the charge back never breaks the cancellation', async () => {
      partnerChargeRepository.deleteUnbilledSplitLegCharge.mockRejectedValue(new Error('database is down'))
      await expect(
        saveLegMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.ASSIGNING_COURIER, EnumDeliveryStatus.CANCELED)
      ).resolves.toMatchObject({ type: EnumDeliveryEventType.CANCELED })
    })
  })

  // ---------------------------------------------------------------------------------------------
  // Row 11 review: the ordinary wait's stamp (spec 0033's waitPayOwedAt) is decided by isWaitPayOwed before
  // the wait ends. It must leave out the split windows as the settle does, or it stamps a wait the trail
  // cannot show and WAIT_PAY_NOT_ON_TRAIL is logged every minute for a day.
  describe('isWaitPayOwed leaves out the split windows (cross check 2)', () => {
    const at = (minutes: number) => minutesAfterFlag(minutes)
    // Promised for the flag time, the rider there on time, no free minutes: every minute would earn.
    const waiting = () =>
      makeDelivery({ arrivedAtPickupAt: FLAGGED_AT, promisedReadyAt: FLAGGED_AT, foodReadyAt: null })
    const trailEvent = (type: EnumDeliveryEventType, minutes: number) => ({ id: `evt-${type}-${minutes}`, type, occurredAt: at(minutes), courierId: COURIER_ID })
    const owed = (endedAt: Date): Promise<boolean> => (service as any).isWaitPayOwed(waiting(), endedAt)

    beforeEach(() => instanceConfig.getWaitPayFreeMinutes.mockResolvedValue(0))

    it('with no split on the trail a 10 minute wait is owed (unchanged)', async () => {
      expect(await owed(at(10))).toBe(true)
    })

    it('a wait wholly inside a split window that closed is not owed: those minutes are the split wait', async () => {
      deliveryEventRepository.findWaitEvents.mockResolvedValue([
        trailEvent(EnumDeliveryEventType.SPLIT_REQUESTED, 0),
        trailEvent(EnumDeliveryEventType.SPLIT_REFUSED, 10),
      ])

      expect(await owed(at(10))).toBe(false)
      expect(deliveryEventRepository.findWaitEvents).toHaveBeenCalledWith(DELIVERY_ID)
    })

    it('a wait wholly inside a split window that is still open is not owed either', async () => {
      deliveryEventRepository.findWaitEvents.mockResolvedValue([trailEvent(EnumDeliveryEventType.SPLIT_REQUESTED, 0)])

      expect(await owed(at(10))).toBe(false)
    })

    it.each([EnumDeliveryEventType.SPLIT_CONFIRMED, EnumDeliveryEventType.SPLIT_REFUSED, EnumDeliveryEventType.SPLIT_CLOSED])(
      'a window closed by %s is left out up to its close; whole minutes after it are owed',
      async (closeType) => {
        deliveryEventRepository.findWaitEvents.mockResolvedValue([
          trailEvent(EnumDeliveryEventType.SPLIT_REQUESTED, 0),
          trailEvent(closeType, 8),
        ])

        // 8 of 8 minutes are the split's: nothing. 8 of 10: two minutes of ordinary wait.
        expect(await owed(at(8))).toBe(false)
        expect(await owed(at(10))).toBe(true)
      }
    )

    it('less than a whole minute outside the window is not owed', async () => {
      deliveryEventRepository.findWaitEvents.mockResolvedValue([
        trailEvent(EnumDeliveryEventType.SPLIT_REQUESTED, 0),
        trailEvent(EnumDeliveryEventType.SPLIT_REFUSED, 9),
      ])

      expect(await owed(minutesAfterFlag(9, 59))).toBe(false)
    })

    it('if the trail cannot be read the wait is stamped (the settle reads it again), and the failure is logged', async () => {
      const error = jest.spyOn(Logger.prototype, 'error')
      deliveryEventRepository.findWaitEvents.mockRejectedValue(new Error('database is down'))

      expect(await owed(at(10))).toBe(true)
      expect(error).toHaveBeenCalled()
    })

    it('end to end: PICKED_UP after a wait that was all split window stamps no waitPayOwedAt', async () => {
      deliveryRepository.findByIdOrThrow.mockResolvedValue(waiting())
      deliveryRepository.findById.mockResolvedValue(waiting())
      deliveryEventRepository.findWaitEvents.mockResolvedValue([
        trailEvent(EnumDeliveryEventType.SPLIT_REQUESTED, 0),
        trailEvent(EnumDeliveryEventType.SPLIT_REFUSED, 10),
      ])

      await service.processDeliveryEvent({
        deliveryId: DELIVERY_ID,
        type: EnumDeliveryEventType.PICKED_UP,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        occurredAt: at(10),
      })

      expect(deliveryRepository.updateIfMatches).toHaveBeenCalledTimes(1)
      const written = deliveryRepository.updateIfMatches.mock.calls[0][2]
      expect(written.status).toBe(EnumDeliveryStatus.PICKED_UP)
      expect(written.waitPayOwedAt).toBeUndefined()
    })

    it('end to end: the same PICKED_UP with no split on the trail does stamp waitPayOwedAt', async () => {
      deliveryRepository.findByIdOrThrow.mockResolvedValue(waiting())
      deliveryRepository.findById.mockResolvedValue(waiting())

      await service.processDeliveryEvent({
        deliveryId: DELIVERY_ID,
        type: EnumDeliveryEventType.PICKED_UP,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        occurredAt: at(10),
      })

      expect(deliveryRepository.updateIfMatches.mock.calls[0][2].waitPayOwedAt).toBeInstanceOf(Date)
    })
  })

  // ---------------------------------------------------------------------------------------------
  describe('notifySplitDecided: the rider learns the answer (AC-7, cross check 12)', () => {
    const message = { deliveryId: DELIVERY_ID, outcome: 'REFUSED' as const, adminNote: 'It fits', legNumber: null, legCount: null, boxSize: null }

    it("sends the answer to the rider's own live connection and by push", async () => {
      await service.notifySplitDecided(COURIER_ID, message)

      expect(websocketDispatcher.sendSplitRequestDecided).toHaveBeenCalledWith('user-rider-1', message)
      expect(offerPushService.splitRequestDecided).toHaveBeenCalledWith(COURIER_ID, message)
    })

    it('never throws when the live connection fails, and still sends the push', async () => {
      websocketDispatcher.sendSplitRequestDecided.mockRejectedValue(new Error('socket is down'))

      await expect(service.notifySplitDecided(COURIER_ID, message)).resolves.toBeUndefined()

      expect(offerPushService.splitRequestDecided).toHaveBeenCalledWith(COURIER_ID, message)
    })
  })
})
