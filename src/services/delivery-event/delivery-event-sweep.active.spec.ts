import {
  EnumCourierStatus,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  Prisma,
} from '@prisma/types'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryEventService } from './delivery-event.service'

// Spec 0048, row 172 (single orders swept) and reviews (decision 172.4):
// When a single or paired order is claimed by a rider (courierId set, status ASSIGNING_COURIER)
// but ACCEPTED was never recorded, the minute sweep completes it or returns it to waiting.
//
// Pins:
// 1. Each reason gives the take back with OFFER_EXPIRED, actor SYSTEM, rider's courierId,
//    messageCode ACCEPT_GIVEN_BACK and params { courierId, reason } for STOPPED, FAILING,
//    SOS and DEACTIVATED; reasons are checked in order (dispatch stop wins over SOS);
//    no ACCEPTED; ensureBackstopIfStillWaiting runs; single order does not call settleStackStops.
// 2. A give back that does not land (updateIfMatches false) records nothing.
// 3. The reread: if findById shows another courierId or status other than ASSIGNING_COURIER,
//    no ACCEPTED is recorded and nothing counts as completed.
// 4. An add-on order (offerGroupId null, stopSequence set) is completed with ACCEPTED_ALONE_BY_SWEEP,
//    and given back with stopSequence cleared to DbNull.
// 5. A step that throws (processDeliveryEvent rejects, or findById throws) is logged, not counted,
//    and the loop continues to the next row.
describe('DeliveryEventService - minute sweep of taken unaccepted orders (spec 0048, row 172 & reviews)', () => {
  const courierId = 'courier-r172'
  const partnerId = 'partner-kitchen-1'
  const offeredAt = new Date('2026-11-26T01:00:00.000Z')
  const offerExpiresAt = new Date('2026-11-26T01:01:00.000Z')

  let deliveryEventService: DeliveryEventService

  let mockDeliveryRepo: any
  let mockDeliveryEventRepo: any
  let mockCourierRepo: any
  let mockCacheService: any
  let mockOfferPushService: any
  let mockDispatchStopRepo: any
  let mockCalculationService: any
  let mockConfigService: any
  let mockWebsocketDispatcher: any
  let mockBullMQService: any
  let mockOfferReasonRepo: any
  let mockCompensationRepo: any

  const makeDelivery = (id: string, opts: Partial<DeliveryEntity> = {}): DeliveryEntity =>
    new DeliveryEntity({
      id,
      partnerId,
      pickupLocationId: 'loc-p1',
      dropoffLocationId: `loc-d-${id}`,
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      matchedCourierId: courierId,
      courierId,
      offeredAt,
      offerExpiresAt,
      offerGroupId: null, // Single order by default
      boxUnits: 30,
      totalCompensation: 450,
      currencyCode: 'EUR',
      updatedAt: new Date(),
      ...opts,
    } as any)

  beforeEach(() => {
    mockDeliveryRepo = {
      findById: jest.fn(),
      findByIdOrThrow: jest.fn(),
      findOpenGroupMembers: jest.fn(),
      findTakenGroupMembers: jest.fn(),
      takeOfferGroup: jest.fn(),
      updateIfMatches: jest.fn(),
      claimOfferWithinBox: jest.fn(),
      claimStackWithinBox: jest.fn(),
      findTakenNotAccepted: jest.fn().mockResolvedValue([]),
      settleStopSequence: jest.fn().mockResolvedValue(0),
      releaseOpenGroupPartners: jest.fn().mockResolvedValue(1),
      holdsSiblingLeg: jest.fn().mockResolvedValue(false),
    }

    mockDeliveryEventRepo = {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      findLatestOfTypes: jest.fn(),
    }

    mockCourierRepo = {
      findById: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve({ id, userId: `user-${id}`, status: EnumCourierStatus.ONLINE, deactivatedAt: null })
        ),
      findByIdOrThrow: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve({ id, userId: `user-${id}`, status: EnumCourierStatus.ONLINE, deactivatedAt: null })
        ),
      heldDeliveryCount: jest.fn().mockResolvedValue(0),
      liveDeliveryCount: jest.fn().mockResolvedValue(0),
      heldBoxUnits: jest.fn().mockResolvedValue(0),
      getCurrentLocation: jest.fn().mockResolvedValue({ latitude: 39.36, longitude: 22.94 }),
      isDeactivatedWaitingForLock: jest.fn().mockResolvedValue(false),
      hasActiveSos: jest.fn().mockResolvedValue(false),
      clearLocationIfOfflineAndFree: jest.fn().mockResolvedValue(undefined),
    }

    mockCacheService = {
      get: jest.fn().mockResolvedValue(null),
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    }

    mockOfferPushService = {
      sendOfferPush: jest.fn().mockResolvedValue(undefined),
      newOffer: jest.fn().mockResolvedValue(undefined),
      offerEnded: jest.fn().mockResolvedValue(undefined),
    }

    mockDispatchStopRepo = {
      findOn: jest.fn().mockResolvedValue(null),
    }

    mockCalculationService = {
      calculateDeliveryAmountsForMatchedCourier: jest.fn().mockResolvedValue({
        totalCost: 500,
        totalCompensation: 450,
        fee: 50,
        feePercentage: 10,
      }),
    }

    mockConfigService = {
      instanceConfig: {
        getOfferExpiryEnabled: jest.fn().mockResolvedValue(true),
        getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
        getOfferSkipMinutes: jest.fn().mockResolvedValue(20),
        getStackPairBlockMinutes: jest.fn().mockResolvedValue(20),
        getStackingEnabled: jest.fn().mockResolvedValue(true),
        getBoxDefaultSize: jest.fn().mockResolvedValue('MEDIUM'),
        getBoxUnitsSmall: jest.fn().mockResolvedValue(30),
        getBoxUnitsMedium: jest.fn().mockResolvedValue(50),
        getBoxUnitsLarge: jest.fn().mockResolvedValue(100),
        getReassignmentPayoutPolicies: jest.fn().mockResolvedValue({ FULL_COMPENSATION: 100 }),
        getReassignmentPayoutDefaultPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
      },
    }

    mockWebsocketDispatcher = {
      dispatchDeliveryStatusUpdate: jest.fn(),
      dispatchDeliveryStatusUpdated: jest.fn(),
      sendOfferToCourier: jest.fn().mockResolvedValue(undefined),
      sendOfferEnded: jest.fn().mockResolvedValue(undefined),
    }

    mockBullMQService = {
      addJob: jest.fn().mockResolvedValue(undefined),
      removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue(undefined),
    }

    mockOfferReasonRepo = {
      create: jest.fn().mockResolvedValue({ id: 'reason-1' }),
    }

    mockCompensationRepo = {
      create: jest.fn().mockResolvedValue({ id: 'comp-1' }),
      deleteById: jest.fn().mockResolvedValue(undefined),
    }

    const mockRemovalRequestRepo = {
      closeOpenForDelivery: jest.fn().mockResolvedValue(undefined),
      findApprovedUnsettled: jest.fn().mockResolvedValue([]),
    }

    deliveryEventService = new DeliveryEventService(
      { get: jest.fn() } as any,
      mockWebsocketDispatcher,
      mockCourierRepo,
      mockDeliveryRepo,
      mockDeliveryEventRepo,
      { registerTaskHandler: jest.fn() } as any,
      { registerTaskHandler: jest.fn() } as any,
      { sendWebhookIfSubscribed: jest.fn().mockResolvedValue(undefined) } as any,
      { findCourierForDelivery: jest.fn() } as any,
      mockCalculationService,
      mockBullMQService,
      mockConfigService,
      mockCacheService,
      mockOfferPushService,
      mockDispatchStopRepo,
      { getDurationMatrix: jest.fn() } as any,
      mockCompensationRepo,
      { findById: jest.fn() } as any,
      mockRemovalRequestRepo as any,
      mockOfferReasonRepo,
      undefined,
      undefined
    )
  })

  // =========================================================================
  // Happy Path: Completing single orders
  // =========================================================================
  describe('Completing taken single orders', () => {
    it('completes taken single accept (offerGroupId null) with ACCEPTED_ALONE_BY_SWEEP (row 172)', async () => {
      const delSingleTaken = makeDelivery('del-single-unaccepted', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingleTaken])
      // Reread: fresh before ACCEPTED, then after ACCEPTED
      mockDeliveryRepo.findById
        .mockResolvedValueOnce(new DeliveryEntity({ ...delSingleTaken, status: EnumDeliveryStatus.ASSIGNING_COURIER }))
        .mockResolvedValueOnce(new DeliveryEntity({ ...delSingleTaken, status: EnumDeliveryStatus.ACCEPTED }))
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(1)
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-single-unaccepted',
          type: EnumDeliveryEventType.ACCEPTED,
          actor: EnumEventActor.SYSTEM,
          courierId,
          source: EnumDeliveryEventSource.OPENCOURIER,
          messageCode: 'ACCEPTED_ALONE_BY_SWEEP',
          messageParams: { courierId, deliveryId: 'del-single-unaccepted' },
        })
      )
    })
  })

  // =========================================================================
  // Pin 1: Give backs for STOPPED, FAILING, SOS, and DEACTIVATED, with precedence
  // =========================================================================
  describe('Pin 1: Give back reasons, events, and ordering', () => {
    it('gives single order back to waiting when dispatch is stopped (STOPPED)', async () => {
      const delSingle = makeDelivery('del-single-stopped', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingle])
      mockDispatchStopRepo.findOn.mockResolvedValueOnce({ id: 'stop-active' })
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)
      const rearmSpy = jest
        .spyOn(deliveryEventService as any, 'ensureBackstopIfStillWaiting')
        .mockResolvedValue(undefined)
      const settleSpy = jest.spyOn(deliveryEventService as any, 'settleStackStops')

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-single-stopped',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        expect.objectContaining({
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          offerGroupId: null,
          stopSequence: Prisma.DbNull,
        })
      )
      // Decision 172.4: OFFER_EXPIRED by SYSTEM with ACCEPT_GIVEN_BACK and reason STOPPED
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-single-stopped',
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          actor: EnumEventActor.SYSTEM,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId,
          messageCode: 'ACCEPT_GIVEN_BACK',
          messageParams: { courierId, reason: 'STOPPED' },
        })
      )
      // No ACCEPTED event emitted
      expect(processSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: EnumDeliveryEventType.ACCEPTED }))
      expect(rearmSpy).toHaveBeenCalledWith('del-single-stopped')
      expect(settleSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.settleStopSequence).not.toHaveBeenCalled()
      rearmSpy.mockRestore()
      settleSpy.mockRestore()
    })

    it('gives single order back to waiting when accept has kept failing for > 10 min (FAILING)', async () => {
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000)
      const delSingle = makeDelivery('del-single-giving-up', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: elevenMinutesAgo,
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingle])
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)
      const rearmSpy = jest
        .spyOn(deliveryEventService as any, 'ensureBackstopIfStillWaiting')
        .mockResolvedValue(undefined)
      const settleSpy = jest.spyOn(deliveryEventService as any, 'settleStackStops')

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-single-giving-up',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        expect.objectContaining({
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          offerGroupId: null,
          stopSequence: Prisma.DbNull,
        })
      )
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-single-giving-up',
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          actor: EnumEventActor.SYSTEM,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId,
          messageCode: 'ACCEPT_GIVEN_BACK',
          messageParams: { courierId, reason: 'FAILING' },
        })
      )
      expect(processSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: EnumDeliveryEventType.ACCEPTED }))
      expect(rearmSpy).toHaveBeenCalledWith('del-single-giving-up')
      expect(settleSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.settleStopSequence).not.toHaveBeenCalled()
      rearmSpy.mockRestore()
      settleSpy.mockRestore()
    })

    it('gives single order back to waiting when rider has active SOS (SOS)', async () => {
      const delSingle = makeDelivery('del-single-sos', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingle])
      mockCourierRepo.hasActiveSos.mockResolvedValueOnce(true)
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)
      const rearmSpy = jest
        .spyOn(deliveryEventService as any, 'ensureBackstopIfStillWaiting')
        .mockResolvedValue(undefined)
      const settleSpy = jest.spyOn(deliveryEventService as any, 'settleStackStops')

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(mockCourierRepo.hasActiveSos).toHaveBeenCalledWith(courierId)
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-single-sos',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        expect.objectContaining({
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          offerGroupId: null,
          stopSequence: Prisma.DbNull,
        })
      )
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-single-sos',
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          actor: EnumEventActor.SYSTEM,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId,
          messageCode: 'ACCEPT_GIVEN_BACK',
          messageParams: { courierId, reason: 'SOS' },
        })
      )
      expect(processSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: EnumDeliveryEventType.ACCEPTED }))
      expect(rearmSpy).toHaveBeenCalledWith('del-single-sos')
      expect(settleSpy).not.toHaveBeenCalled()
      rearmSpy.mockRestore()
      settleSpy.mockRestore()
    })

    it('gives single order back to waiting when rider is deactivated (DEACTIVATED)', async () => {
      const delSingle = makeDelivery('del-single-deactivated', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingle])
      mockCourierRepo.isDeactivatedWaitingForLock.mockResolvedValueOnce(true)
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)
      const rearmSpy = jest
        .spyOn(deliveryEventService as any, 'ensureBackstopIfStillWaiting')
        .mockResolvedValue(undefined)
      const settleSpy = jest.spyOn(deliveryEventService as any, 'settleStackStops')

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-single-deactivated',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        expect.objectContaining({
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          offerGroupId: null,
          stopSequence: Prisma.DbNull,
        })
      )
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-single-deactivated',
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          actor: EnumEventActor.SYSTEM,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId,
          messageCode: 'ACCEPT_GIVEN_BACK',
          messageParams: { courierId, reason: 'DEACTIVATED' },
        })
      )
      expect(processSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: EnumDeliveryEventType.ACCEPTED }))
      expect(rearmSpy).toHaveBeenCalledWith('del-single-deactivated')
      expect(settleSpy).not.toHaveBeenCalled()
      rearmSpy.mockRestore()
      settleSpy.mockRestore()
    })

    it('checks reasons in order: dispatch stop wins over active SOS', async () => {
      const delSingle = makeDelivery('del-stopped-vs-sos', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingle])
      // Both dispatch stop AND active SOS are present
      mockDispatchStopRepo.findOn.mockResolvedValueOnce({ id: 'stop-active' })
      mockCourierRepo.hasActiveSos.mockResolvedValueOnce(true)
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)
      const rearmSpy = jest
        .spyOn(deliveryEventService as any, 'ensureBackstopIfStillWaiting')
        .mockResolvedValue(undefined)

      await deliveryEventService.completeTakenAccepts(new Date())

      // Dispatch stop must win over SOS
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-stopped-vs-sos',
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          messageCode: 'ACCEPT_GIVEN_BACK',
          messageParams: { courierId, reason: 'STOPPED' },
        })
      )
      rearmSpy.mockRestore()
    })

    it('checks reasons in order: failing (>10m) wins over active SOS', async () => {
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000)
      const delSingle = makeDelivery('del-failing-vs-sos', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: elevenMinutesAgo,
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingle])
      // No dispatch stop, but both failing AND active SOS are true
      mockDispatchStopRepo.findOn.mockResolvedValueOnce(null)
      mockCourierRepo.hasActiveSos.mockResolvedValueOnce(true)
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)
      const rearmSpy = jest
        .spyOn(deliveryEventService as any, 'ensureBackstopIfStillWaiting')
        .mockResolvedValue(undefined)

      await deliveryEventService.completeTakenAccepts(new Date())

      // FAILING must win over SOS
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-failing-vs-sos',
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          messageCode: 'ACCEPT_GIVEN_BACK',
          messageParams: { courierId, reason: 'FAILING' },
        })
      )
      rearmSpy.mockRestore()
    })

    it('checks reasons in order: active SOS wins over deactivation', async () => {
      const delSingle = makeDelivery('del-sos-vs-deact', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingle])
      // No dispatch stop, not failing, but both SOS and deactivation are true
      mockDispatchStopRepo.findOn.mockResolvedValueOnce(null)
      mockCourierRepo.hasActiveSos.mockResolvedValueOnce(true)
      mockCourierRepo.isDeactivatedWaitingForLock.mockResolvedValueOnce(true)
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)
      const rearmSpy = jest
        .spyOn(deliveryEventService as any, 'ensureBackstopIfStillWaiting')
        .mockResolvedValue(undefined)

      await deliveryEventService.completeTakenAccepts(new Date())

      // SOS must win over DEACTIVATED
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-sos-vs-deact',
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          messageCode: 'ACCEPT_GIVEN_BACK',
          messageParams: { courierId, reason: 'SOS' },
        })
      )
      rearmSpy.mockRestore()
    })
  })

  // =========================================================================
  // Pin 2: Give back that does not land (updateIfMatches false) records nothing
  // =========================================================================
  describe('Pin 2: Unsuccessful give back conditional update', () => {
    it('records nothing and does not rearm backstop when updateIfMatches returns false', async () => {
      const delSingle = makeDelivery('del-single-missed-race', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingle])
      mockDispatchStopRepo.findOn.mockResolvedValueOnce({ id: 'stop-active' })
      // Race lost: another write changed status or courierId meanwhile
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(false)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)
      const rearmSpy = jest
        .spyOn(deliveryEventService as any, 'ensureBackstopIfStillWaiting')
        .mockResolvedValue(undefined)

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(processSpy).not.toHaveBeenCalled()
      expect(rearmSpy).not.toHaveBeenCalled()
      rearmSpy.mockRestore()
    })
  })

  // =========================================================================
  // Pin 3: The reread before ACCEPTED
  // =========================================================================
  describe('Pin 3: Reread verification before ACCEPTED event', () => {
    it('does not record ACCEPTED and does not count as completed when findById shows another courierId', async () => {
      const delSingle = makeDelivery('del-single-courier-changed', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingle])
      // Reread returns a different courierId
      mockDeliveryRepo.findById.mockResolvedValueOnce(
        new DeliveryEntity({ ...delSingle, courierId: 'courier-other-999' })
      )
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(processSpy).not.toHaveBeenCalled()
    })

    it('does not record ACCEPTED and does not count as completed when findById shows status other than ASSIGNING_COURIER', async () => {
      const delSingle = makeDelivery('del-single-status-changed', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingle])
      // Reread shows delivery already moved to ACCEPTED or CANCELLED
      mockDeliveryRepo.findById.mockResolvedValueOnce(
        new DeliveryEntity({ ...delSingle, status: EnumDeliveryStatus.ACCEPTED })
      )
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(processSpy).not.toHaveBeenCalled()
    })

    it('does not record ACCEPTED and does not count as completed when findById returns null', async () => {
      const delSingle = makeDelivery('del-single-disappeared', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingle])
      // Row not found
      mockDeliveryRepo.findById.mockResolvedValueOnce(null)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(processSpy).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // Pin 4: Add-on orders (offerGroupId null, stopSequence set)
  // =========================================================================
  describe('Pin 4: Add-on orders in the sweep', () => {
    it('completes an add on order (offerGroupId null, stopSequence set) with ACCEPTED_ALONE_BY_SWEEP', async () => {
      const sampleStopSequence = [
        { order: 1, type: 'PICKUP', deliveryId: 'del-primary' },
        { order: 2, type: 'PICKUP', deliveryId: 'del-addon-1' },
      ]
      const delAddOn = makeDelivery('del-addon-1', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        stopSequence: sampleStopSequence as any,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delAddOn])
      mockDeliveryRepo.findById
        .mockResolvedValueOnce(new DeliveryEntity({ ...delAddOn, status: EnumDeliveryStatus.ASSIGNING_COURIER }))
        .mockResolvedValueOnce(new DeliveryEntity({ ...delAddOn, status: EnumDeliveryStatus.ACCEPTED }))
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(1)
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-addon-1',
          type: EnumDeliveryEventType.ACCEPTED,
          actor: EnumEventActor.SYSTEM,
          courierId,
          source: EnumDeliveryEventSource.OPENCOURIER,
          messageCode: 'ACCEPTED_ALONE_BY_SWEEP',
          messageParams: { courierId, deliveryId: 'del-addon-1' },
        })
      )
    })

    it('gives an add on order back with stopSequence cleared to DbNull, emitting OFFER_EXPIRED with ACCEPT_GIVEN_BACK', async () => {
      const sampleStopSequence = [
        { order: 1, type: 'PICKUP', deliveryId: 'del-primary' },
        { order: 2, type: 'PICKUP', deliveryId: 'del-addon-giveback' },
      ]
      const delAddOn = makeDelivery('del-addon-giveback', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        stopSequence: sampleStopSequence as any,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delAddOn])
      mockCourierRepo.hasActiveSos.mockResolvedValueOnce(true)
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)
      const rearmSpy = jest
        .spyOn(deliveryEventService as any, 'ensureBackstopIfStillWaiting')
        .mockResolvedValue(undefined)
      const settleSpy = jest.spyOn(deliveryEventService as any, 'settleStackStops')

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      // stopSequence cleared to Prisma.DbNull
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-addon-giveback',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        expect.objectContaining({
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          offerGroupId: null,
          stopSequence: Prisma.DbNull,
        })
      )
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-addon-giveback',
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          actor: EnumEventActor.SYSTEM,
          courierId,
          messageCode: 'ACCEPT_GIVEN_BACK',
          messageParams: { courierId, reason: 'SOS' },
        })
      )
      expect(rearmSpy).toHaveBeenCalledWith('del-addon-giveback')
      // No settleStackStops because offerGroupId is null
      expect(settleSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.settleStopSequence).not.toHaveBeenCalled()
      rearmSpy.mockRestore()
      settleSpy.mockRestore()
    })

    it('skips settleStopSequence when delivery has null offerGroupId (review of row 80)', async () => {
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000)
      const delTaken = makeDelivery('del-no-group', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: elevenMinutesAgo,
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delTaken])
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)
      const settleSpy = jest.spyOn(deliveryEventService as any, 'settleStackStops')

      await deliveryEventService.completeTakenAccepts(new Date())

      expect(settleSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.settleStopSequence).not.toHaveBeenCalled()
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-no-group',
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          messageCode: 'ACCEPT_GIVEN_BACK',
          messageParams: { courierId, reason: 'FAILING' },
        })
      )
      settleSpy.mockRestore()
    })
  })

  // =========================================================================
  // Pin 5: Resilience when a step throws
  // =========================================================================
  describe('Pin 5: Resilient loop when a step throws', () => {
    it('catches findById error on row 1, logs it, and continues to complete row 2', async () => {
      const del1 = makeDelivery('del-error-read', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      const del2 = makeDelivery('del-success-row2', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([del1, del2])

      // Del1 throws on fresh findById
      mockDeliveryRepo.findById
        .mockRejectedValueOnce(new Error('Transient DB error reading del1'))
        // Del2 succeeds fresh and after
        .mockResolvedValueOnce(new DeliveryEntity({ ...del2, status: EnumDeliveryStatus.ASSIGNING_COURIER }))
        .mockResolvedValueOnce(new DeliveryEntity({ ...del2, status: EnumDeliveryStatus.ACCEPTED }))

      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      // Row 1 did not increment, row 2 did
      expect(completed).toBe(1)
      expect(processSpy).toHaveBeenCalledTimes(1)
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-success-row2',
          type: EnumDeliveryEventType.ACCEPTED,
        })
      )
    })

    it('catches processDeliveryEvent error on row 1 during completion, logs it, and continues to row 2', async () => {
      const del1 = makeDelivery('del-reject-process', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      const del2 = makeDelivery('del-success-row2', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([del1, del2])

      // Del1 fresh read succeeds
      mockDeliveryRepo.findById
        .mockResolvedValueOnce(new DeliveryEntity({ ...del1, status: EnumDeliveryStatus.ASSIGNING_COURIER }))
        // Del2 fresh and after succeed
        .mockResolvedValueOnce(new DeliveryEntity({ ...del2, status: EnumDeliveryStatus.ASSIGNING_COURIER }))
        .mockResolvedValueOnce(new DeliveryEntity({ ...del2, status: EnumDeliveryStatus.ACCEPTED }))

      const processSpy = jest
        .spyOn(deliveryEventService, 'processDeliveryEvent')
        .mockRejectedValueOnce(new Error('State machine failed on del1'))
        .mockResolvedValueOnce(undefined)

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(1)
      expect(processSpy).toHaveBeenCalledTimes(2)
    })

    it('catches processDeliveryEvent error on row 1 during give-back, logs it, and continues to row 2', async () => {
      const del1 = makeDelivery('del-giveback-error', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      const del2 = makeDelivery('del-success-row2', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([del1, del2])
      // Del1 triggers give back via dispatch stop
      mockDispatchStopRepo.findOn.mockResolvedValueOnce({ id: 'stop-active' }).mockResolvedValueOnce(null)
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)

      // Del2 fresh and after succeed
      mockDeliveryRepo.findById
        .mockResolvedValueOnce(new DeliveryEntity({ ...del2, status: EnumDeliveryStatus.ASSIGNING_COURIER }))
        .mockResolvedValueOnce(new DeliveryEntity({ ...del2, status: EnumDeliveryStatus.ACCEPTED }))

      const processSpy = jest
        .spyOn(deliveryEventService, 'processDeliveryEvent')
        .mockRejectedValueOnce(new Error('Give back event failed on del1'))
        .mockResolvedValueOnce(undefined)

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(1)
      expect(processSpy).toHaveBeenCalledTimes(2)
      expect(processSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          deliveryId: 'del-giveback-error',
          type: EnumDeliveryEventType.OFFER_EXPIRED,
        })
      )
      expect(processSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          deliveryId: 'del-success-row2',
          type: EnumDeliveryEventType.ACCEPTED,
        })
      )
    })
  })
})
