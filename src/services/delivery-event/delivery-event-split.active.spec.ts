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
      deleteUnbilledSplitLegCharge: jest.fn().mockResolvedValue(null),
      findByDeliveryId: jest.fn().mockResolvedValue(null),
      createOnce: jest.fn().mockImplementation(async (input: any) => ({ id: 'charge-cancel', ...input })),
    }
    removalRequestRepository = {
      closeOpenForDelivery: jest.fn().mockResolvedValue(undefined),
      findApprovedAfterPickup: jest.fn().mockResolvedValue(null),
    }
    splitRequestRepository = {
      findOpenForDelivery: jest.fn().mockResolvedValue(null),
      closeIfOpen: jest.fn().mockResolvedValue(true),
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
      await service.settleSplitWait(request, minutesAfterFlag(7), true)

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
      await service.settleSplitWait(request, minutesAfterFlag(1), true)
      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 10, waitMinutes: 1 })
      )
    })

    it('rounds down to whole minutes: 3 min 59 s pays 3 minutes', async () => {
      await service.settleSplitWait(request, minutesAfterFlag(3, 59), true)
      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 30, waitMinutes: 3 })
      )
    })

    it('reads the rate from the co-op setting, never a fixed number (binding value 2)', async () => {
      instanceConfig.getWaitPayCentsPerMinute.mockResolvedValue(25)
      await service.settleSplitWait(request, minutesAfterFlag(4), true)
      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100, waitMinutes: 4 })
      )
    })

    it('writes a COURIER_PAID_FOR_WAIT event naming the rider, the amount and the split request, with no status change', async () => {
      await service.settleSplitWait(request, minutesAfterFlag(7), true)

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
      await service.settleSplitWait(request, minutesAfterFlag(7), true)

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

      await service.settleSplitWait(request, minutesAfterFlag(9), true)

      expect(partnerChargeRepository.createSplitWaitChargeOnce).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 70, waitMinutes: 7, splitWaitOf: REQUEST_ID })
      )
    })

    it('refused split (cross check 1): the rider is paid and the event written, the restaurant is NOT charged', async () => {
      await service.settleSplitWait(request, minutesAfterFlag(7), false)

      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 70, splitWaitOf: REQUEST_ID })
      )
      expect(savedOfType(EnumDeliveryEventType.COURIER_PAID_FOR_WAIT)).toHaveLength(1)
      expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
    })

    it('with wait pay switched off, nothing is paid, charged or recorded (spec 0033 AC-1)', async () => {
      instanceConfig.getWaitPayEnabled.mockResolvedValue(false)

      await service.settleSplitWait(request, minutesAfterFlag(7), true)

      expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
      expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
      expect(deliveryEventRepository.create).not.toHaveBeenCalled()
    })

    it('with a rate of 0, nothing is paid, charged or recorded', async () => {
      instanceConfig.getWaitPayCentsPerMinute.mockResolvedValue(0)
      await service.settleSplitWait(request, minutesAfterFlag(7), true)
      expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
      expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
      expect(deliveryEventRepository.create).not.toHaveBeenCalled()
    })

    it('an answer inside the first minute pays nothing and writes no empty rows', async () => {
      await service.settleSplitWait(request, minutesAfterFlag(0, 59), true)
      expect(courierCompensationRepository.createSplitWaitPayOnce).not.toHaveBeenCalled()
      expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
      expect(deliveryEventRepository.create).not.toHaveBeenCalled()
    })

    it('a delivery with no restaurant: the rider is paid, nobody is charged, and a warning is logged (cross check 13)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn')
      deliveryRepository.findByIdOrThrow.mockResolvedValue(makeDelivery({ partnerId: null }))

      await service.settleSplitWait(request, minutesAfterFlag(7), true)

      expect(courierCompensationRepository.createSplitWaitPayOnce).toHaveBeenCalledTimes(1)
      expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalled()
    })

    it('never throws: a failed write is logged, so the split itself is not undone by its wait pay', async () => {
      const error = jest.spyOn(Logger.prototype, 'error')
      courierCompensationRepository.createSplitWaitPayOnce.mockRejectedValue(new Error('database is down'))

      await expect(service.settleSplitWait(request, minutesAfterFlag(7), true)).resolves.toBeUndefined()

      expect(error).toHaveBeenCalled()
      expect(partnerChargeRepository.createSplitWaitChargeOnce).not.toHaveBeenCalled()
    })

    describe('AC-11: the wait cannot be paid twice', () => {
      it('the award and the charge always go through the "once" writers with the request id as their key', async () => {
        await service.settleSplitWait(request, minutesAfterFlag(7), true)

        const award = courierCompensationRepository.createSplitWaitPayOnce.mock.calls[0][0]
        const charge = partnerChargeRepository.createSplitWaitChargeOnce.mock.calls[0][0]
        expect(award.splitWaitOf).toBe(REQUEST_ID)
        expect(charge.splitWaitOf).toBe(REQUEST_ID)
      })

      it('settling the same request twice writes the paid event once only', async () => {
        await service.settleSplitWait(request, minutesAfterFlag(7), true)
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

        await service.settleSplitWait(request, minutesAfterFlag(8), true)

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

        await service.settleSplitWait(request, minutesAfterFlag(7), false)

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
      splitRequestRepository.closeIfOpen.mockImplementation(async () => {
        splitRequestRepository.findOpenForDelivery.mockResolvedValue(null)
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
      partnerChargeRepository.deleteUnbilledSplitLegCharge.mockResolvedValue(voidedCharge)

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
      partnerChargeRepository.deleteUnbilledSplitLegCharge.mockResolvedValue(voidedCharge)

      await saveLegMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.ACCEPTED, EnumDeliveryStatus.CANCELED)

      expect(partnerChargeRepository.deleteUnbilledSplitLegCharge).not.toHaveBeenCalled()
      expect(savedOfType(EnumDeliveryEventType.PARTNER_SPLIT_CHARGE_VOIDED)).toHaveLength(0)
    })

    it('a delivery that has no split leg charge (an ordinary order) gets no voided event', async () => {
      partnerChargeRepository.deleteUnbilledSplitLegCharge.mockResolvedValue(null)

      await saveLegMoved(EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.ASSIGNING_COURIER, EnumDeliveryStatus.CANCELED)

      expect(savedOfType(EnumDeliveryEventType.PARTNER_SPLIT_CHARGE_VOIDED)).toHaveLength(0)
    })

    it('a leg that goes back to looking for a rider (not ended) keeps its charge', async () => {
      await saveLegMoved(EnumDeliveryEventType.OFFER_EXPIRED, EnumDeliveryStatus.ASSIGNING_COURIER, EnumDeliveryStatus.ASSIGNING_COURIER)
      await saveLegMoved(EnumDeliveryEventType.CREATED, EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER)

      expect(partnerChargeRepository.deleteUnbilledSplitLegCharge).not.toHaveBeenCalled()
      expect(savedOfType(EnumDeliveryEventType.PARTNER_SPLIT_CHARGE_VOIDED)).toHaveLength(0)
    })

    it('the voided event itself does not void again (it is saved with the old status equal to the new)', async () => {
      partnerChargeRepository.deleteUnbilledSplitLegCharge.mockResolvedValue(voidedCharge)

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
