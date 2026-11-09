import { DeliveryEventService } from './delivery-event.service'
import {
  ConfigKey,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumDeliveryEventSource,
  EnumCourierStatus,
} from 'src/shared-types'
import { clock } from 'src/domains/dispatch-stop/dispatch-stop-time'

describe('DeliveryEventService - Offers Timed to Food Readiness (Spec 0031: AC-1 to AC-9)', () => {
  let service: DeliveryEventService
  let mockConfigService: any
  let mockWebsocketDispatcher: any
  let mockCourierRepository: any
  let mockDeliveryRepository: any
  let mockDeliveryEventRepository: any
  let mockTaskScheduler: any
  let mockTaskBusService: any
  let mockPartnerWebhookService: any
  let mockDeliveryMatchingService: any
  let mockDeliveryCalculationService: any
  let mockBullMQService: any
  let mockConfigDomainService: any
  let mockCacheService: any
  let mockOfferPushService: any
  let mockDispatchStopRepository: any
  let mockOsrmRoutingService: any
  let mockCourierCompensationRepository: any
  let mockPartnerChargeRepository: any
  let mockInstanceConfig: any

  const NOW_MS = 1794142800000 // A fixed time point for repeatable testing
  const NOW = new Date(NOW_MS)

  const pickupLocation = { latitude: 39.3621, longitude: 22.9421 }
  const riderLocation = { latitude: 39.3650, longitude: 22.9450 }

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)

    mockConfigService = {
      get: jest.fn().mockReturnValue(null),
    }

    mockWebsocketDispatcher = {
      sendOfferToCourier: jest.fn().mockResolvedValue(undefined),
      dispatchDeliveryStatusUpdated: jest.fn().mockResolvedValue(undefined),
    }

    mockCourierRepository = {
      findById: jest.fn(),
      findByIdOrThrow: jest.fn(),
      getCurrentLocation: jest.fn().mockResolvedValue(riderLocation),
      hasActiveSos: jest.fn().mockResolvedValue(false),
    }

    mockDeliveryRepository = {
      findById: jest.fn(),
      findByIdOrThrow: jest.fn(),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      findOngoingDeliveriesForCourier: jest.fn().mockResolvedValue([]),
      findDeliveriesWaitingToBeOffered: jest.fn().mockResolvedValue([]),
      findIdsWaitingForCourierOldestFirst: jest.fn().mockResolvedValue([]),
    }

    mockDeliveryEventRepository = {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      findLatestOfTypes: jest.fn().mockResolvedValue(null),
    }

    mockTaskScheduler = {
      scheduleTask: jest.fn().mockResolvedValue(undefined),
    }

    mockTaskBusService = {
      registerTaskHandler: jest.fn(),
    }

    mockPartnerWebhookService = {
      sendDeliveryUpdatePartnerWebhook: jest.fn().mockResolvedValue(undefined),
    }

    mockDeliveryMatchingService = {
      findCourierForDelivery: jest.fn(),
    }

    mockDeliveryCalculationService = {
      calculateDeliveryAmountsForMatchedCourier: jest.fn().mockResolvedValue({
        totalCost: 500,
        totalCompensation: 400,
        fee: 100,
        feePercentage: 10,
      }),
    }

    mockBullMQService = {
      addJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
      removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue([]),
    }

    mockInstanceConfig = {
      getOfferExpiryEnabled: jest.fn().mockResolvedValue(true),
      getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
      getNoCourierRetrySeconds: jest.fn().mockResolvedValue(30),
      getOfferTimingEnabled: jest.fn().mockResolvedValue(true),
      getOfferLeadMinutes: jest.fn().mockResolvedValue(3),
      getOfferTimingCandidates: jest.fn().mockResolvedValue(5),
    }

    mockConfigDomainService = {
      instanceConfig: mockInstanceConfig,
    }

    mockCacheService = {
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    }

    mockOfferPushService = {
      newOffer: jest.fn().mockResolvedValue(undefined),
      offerEnded: jest.fn().mockResolvedValue(undefined),
    }

    mockDispatchStopRepository = {
      findOn: jest.fn().mockResolvedValue(null),
    }

    mockOsrmRoutingService = {
      getRoute: jest.fn().mockResolvedValue({ durationSeconds: 360 }), // 6 minutes travel
    }

    mockCourierCompensationRepository = {}
    mockPartnerChargeRepository = {}

    service = new DeliveryEventService(
      mockConfigService,
      mockWebsocketDispatcher,
      mockCourierRepository,
      mockDeliveryRepository,
      mockDeliveryEventRepository,
      mockTaskScheduler,
      mockTaskBusService,
      mockPartnerWebhookService,
      mockDeliveryMatchingService,
      mockDeliveryCalculationService,
      mockBullMQService,
      mockConfigDomainService,
      mockCacheService,
      mockOfferPushService,
      mockDispatchStopRepository,
      mockOsrmRoutingService,
      mockCourierCompensationRepository,
      mockPartnerChargeRepository
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // Helper to construct sample waiting delivery
  function createWaitingDelivery(id: string, overrides: Record<string, any> = {}) {
    return {
      id,
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      matchedCourierId: null,
      courierId: null,
      partnerId: 'partner-1',
      readyAt: new Date(NOW_MS + 20 * 60_000), // Default: ready in 20 minutes
      foodReadyAt: null,
      pickupLocation,
      dropoffLocation: { latitude: 39.37, longitude: 22.95 },
      ...overrides,
    }
  }

  // Helper for matched courier
  function createMatchedCourier(id = 'courier-1', userId = 'user-courier-1') {
    return { id, userId, status: EnumCourierStatus.ONLINE }
  }

  describe('AC-1: Timing off (offerTimingEnabled = false)', () => {
    it('does not hold the delivery even when readyAt is in the future, does not call OSRM, and saves standard message', async () => {
      mockInstanceConfig.getOfferTimingEnabled.mockResolvedValue(false)

      const delivery = createWaitingDelivery('del-timing-off', {
        readyAt: new Date(NOW_MS + 25 * 60_000), // 25 min in future
      })
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(delivery) // initial read
        .mockResolvedValueOnce(delivery)

      const courier = createMatchedCourier()
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier,
        delivery,
        pickupLocation,
        travelSeconds: null,
      })
      mockCourierRepository.findByIdOrThrow.mockResolvedValue(courier)

      await (service as any).offerToNextCourier('del-timing-off')

      // OSRM routing should NOT be called to compute roadSecondsToPickup
      expect(mockOsrmRoutingService.getRoute).not.toHaveBeenCalled()

      // The offer must be written (NOT held as NOT_DUE)
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-timing-off',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: null, courierId: null },
        expect.objectContaining({ matchedCourierId: 'courier-1' })
      )

      // Event message must be today's standard message without timing note (no ", ready ...")
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.OFFERED,
          message: expect.stringMatching(/^Offered to courier courier-1, answer by [^,]+$/),
        })
      )
      const eventCall = mockDeliveryEventRepository.create.mock.calls[0][0]
      expect(eventCall.message).not.toContain(', ready')
    })
  })

  describe('AC-2 & AC-3: Timed Hold (offerTimingEnabled = true)', () => {
    it('holds an offer when due moment is in future (now < dueAt): returns NOT_DUE, writes no event, nobody offered, schedules backstop retry', async () => {
      // readyAt is in 20 min (1200s).
      // Travel time is 6 min (360s).
      // Lead time is 3 min (180s).
      // dueAt = readyAt - 6m - 3m = readyAt - 9m = 11 minutes in future (660,000 ms).
      const delivery = createWaitingDelivery('del-held', {
        readyAt: new Date(NOW_MS + 20 * 60_000),
      })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)

      const courier = createMatchedCourier()
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier,
        delivery,
        pickupLocation,
        travelSeconds: 360, // Matcher provided travelSeconds
      })
      mockCourierRepository.findByIdOrThrow.mockResolvedValue(courier)

      const result = await (service as any).offerToNextCourier('del-held')

      // 1. Result is NOT_DUE
      expect(result).toBe('NOT_DUE')

      // 2. Delivery stays in ASSIGNING_COURIER with nobody offered
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(mockWebsocketDispatcher.sendOfferToCourier).not.toHaveBeenCalled()

      // 3. AC-3: No event is recorded for holding it
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalled()

      // 4. AC-3: Backstop job is scheduled with delay = min(dueInMs, retrySeconds * 1000)
      // dueInMs is 11 min (660,000 ms). retrySeconds is 30s (30,000 ms).
      // min(660_000, 30_000) = 30_000 ms
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'no-courier-retry',
        { deliveryId: 'del-held' },
        expect.objectContaining({ delay: 30_000 })
      )
    })

    it('schedules backstop retry after dueInMs when dueInMs is shorter than retry period', async () => {
      // readyAt is in 9 min 10 sec (550s).
      // Travel time: 6 min (360s).
      // Lead: 3 min (180s).
      // dueAt = readyAt - 9 min = 10 seconds from now (10,000 ms).
      // retrySeconds is 30s (30,000 ms).
      // min(10_000, 30_000) = 10_000 ms!
      const delivery = createWaitingDelivery('del-soon-due', {
        readyAt: new Date(NOW_MS + (9 * 60 + 10) * 1000),
      })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)

      const courier = createMatchedCourier()
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier,
        delivery,
        pickupLocation,
        travelSeconds: 360,
      })
      mockCourierRepository.findByIdOrThrow.mockResolvedValue(courier)

      const result = await (service as any).offerToNextCourier('del-soon-due')

      expect(result).toBe('NOT_DUE')
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'no-courier-retry',
        { deliveryId: 'del-soon-due' },
        expect.objectContaining({ delay: 10_000 })
      )
    })

    it('offers now when the due moment has passed (now >= dueAt), including timing note in OFFERED event message', async () => {
      // readyAt is in 5 min (300s).
      // Travel is 6 min (360s). Lead is 3 min (180s).
      // dueAt = readyAt - 9 min = 4 minutes in the past! (dueInMs <= 0)
      const delivery = createWaitingDelivery('del-due-now', {
        readyAt: new Date(NOW_MS + 5 * 60_000),
      })
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(delivery)
        .mockResolvedValueOnce({ ...delivery, matchedCourierId: 'courier-1' })

      const courier = createMatchedCourier()
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier,
        delivery,
        pickupLocation,
        travelSeconds: 360,
      })
      mockCourierRepository.findByIdOrThrow.mockResolvedValue(courier)

      const result = await (service as any).offerToNextCourier('del-due-now')

      // Offers now!
      expect(result).toBe('OFFERED')

      // Delivery is offered
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-due-now',
        expect.anything(),
        expect.objectContaining({ matchedCourierId: 'courier-1' })
      )

      // AC-6: OFFERED event message includes ready clock, travel ~6 min, lead 3 min
      const expectedReadyClock = clock(delivery.readyAt!)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.OFFERED,
          message: expect.stringContaining(
            `, ready ${expectedReadyClock}, travel ~6 min, lead 3 min`
          ),
        })
      )
    })

    it('foodReadyAt beats readyAt for computing due moment and message clock', async () => {
      // readyAt was originally set to 30 min in future (would hold for a long time).
      // But foodReadyAt is set to 8 min in future!
      // Travel: 6 min. Lead: 3 min.
      // With foodReadyAt, dueAt = foodReadyAt - 9 min = 1 min in past!
      // Therefore offers NOW, and message names foodReadyAt's clock.
      const delivery = createWaitingDelivery('del-food-ready', {
        readyAt: new Date(NOW_MS + 30 * 60_000),
        foodReadyAt: new Date(NOW_MS + 8 * 60_000),
      })
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(delivery)
        .mockResolvedValueOnce({ ...delivery, matchedCourierId: 'courier-1' })

      const courier = createMatchedCourier()
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier,
        delivery,
        pickupLocation,
        travelSeconds: 360,
      })
      mockCourierRepository.findByIdOrThrow.mockResolvedValue(courier)

      const result = await (service as any).offerToNextCourier('del-food-ready')

      expect(result).toBe('OFFERED')

      const foodReadyClock = clock(delivery.foodReadyAt!)
      const readyAtClock = clock(delivery.readyAt!)
      expect(foodReadyClock).not.toEqual(readyAtClock)

      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.OFFERED,
          message: expect.stringContaining(`, ready ${foodReadyClock}, travel ~6 min, lead 3 min`),
        })
      )
    })
  })

  describe('AC-5: OSRM Failure, Unknown Location, or Missing readyAt', () => {
    it('offers now with travel unknown when OSRM fails for the chosen rider', async () => {
      const delivery = createWaitingDelivery('del-osrm-fail', {
        readyAt: new Date(NOW_MS + 25 * 60_000),
      })
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(delivery)
        .mockResolvedValueOnce({ ...delivery, matchedCourierId: 'courier-1' })

      const courier = createMatchedCourier()
      // Matcher did not provide travelSeconds (e.g. Seniority or Static matcher, or OSRM failed)
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier,
        delivery,
        pickupLocation,
        travelSeconds: null,
      })
      mockCourierRepository.findByIdOrThrow.mockResolvedValue(courier)

      // OSRM routing throws an error
      mockOsrmRoutingService.getRoute.mockRejectedValueOnce(new Error('OSRM 500 error'))

      const result = await (service as any).offerToNextCourier('del-osrm-fail')

      // Must offer now, never held!
      expect(result).toBe('OFFERED')
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalled()

      // Event message says travel unknown
      const readyClock = clock(delivery.readyAt!)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.OFFERED,
          message: expect.stringContaining(`, ready ${readyClock}, travel unknown`),
        })
      )
    })

    it('offers now with travel unknown when rider has no known current location', async () => {
      const delivery = createWaitingDelivery('del-no-loc', {
        readyAt: new Date(NOW_MS + 25 * 60_000),
      })
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(delivery)
        .mockResolvedValueOnce({ ...delivery, matchedCourierId: 'courier-1' })

      const courier = createMatchedCourier()
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier,
        delivery,
        pickupLocation,
        travelSeconds: null,
      })
      mockCourierRepository.findByIdOrThrow.mockResolvedValue(courier)

      // Rider has no current location
      mockCourierRepository.getCurrentLocation.mockResolvedValueOnce(null)

      const result = await (service as any).offerToNextCourier('del-no-loc')

      expect(result).toBe('OFFERED')
      const readyClock = clock(delivery.readyAt!)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.OFFERED,
          message: expect.stringContaining(`, ready ${readyClock}, travel unknown`),
        })
      )
    })

    it('offers now with standard message when delivery has no readyAt and no foodReadyAt', async () => {
      const delivery = createWaitingDelivery('del-no-ready', {
        readyAt: null,
        foodReadyAt: null,
      })
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(delivery)
        .mockResolvedValueOnce({ ...delivery, matchedCourierId: 'courier-1' })

      const courier = createMatchedCourier()
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier,
        delivery,
        pickupLocation,
        travelSeconds: 300,
      })
      mockCourierRepository.findByIdOrThrow.mockResolvedValue(courier)

      const result = await (service as any).offerToNextCourier('del-no-ready')

      expect(result).toBe('OFFERED')
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalled()

      // Standard message without timing note
      const eventCall = mockDeliveryEventRepository.create.mock.calls[0][0]
      expect(eventCall.message).not.toContain(', ready')
    })
  })

  describe('AC-6: OFFERED event message & Value 5 coordinate privacy', () => {
    it('never contains coordinates in OFFERED event message or note', async () => {
      const delivery = createWaitingDelivery('del-privacy-check', {
        readyAt: new Date(NOW_MS + 2 * 60_000),
      })
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(delivery)
        .mockResolvedValueOnce({ ...delivery, matchedCourierId: 'courier-1' })

      const courier = createMatchedCourier()
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier,
        delivery,
        pickupLocation,
        travelSeconds: 360,
      })
      mockCourierRepository.findByIdOrThrow.mockResolvedValue(courier)

      await (service as any).offerToNextCourier('del-privacy-check')

      const eventCall = mockDeliveryEventRepository.create.mock.calls[0][0]
      expect(eventCall.message).not.toContain('39.')
      expect(eventCall.message).not.toContain('22.')
      expect(eventCall.message).not.toContain('latitude')
      expect(eventCall.message).not.toContain('longitude')
    })
  })

  describe('AC-8: matchWaitingDeliveries on NOT_DUE and nobody free', () => {
    it('continues matching the next waiting delivery when the first one is held (NOT_DUE), and records no NO_COURIER_AVAILABLE', async () => {
      // 2 deliveries waiting to be offered
      const deliveryHeld = createWaitingDelivery('del-waiting-1', {
        readyAt: new Date(NOW_MS + 25 * 60_000), // in future: will be NOT_DUE
      })
      const deliveryDue = createWaitingDelivery('del-waiting-2', {
        readyAt: new Date(NOW_MS + 2 * 60_000), // due now: will be OFFERED
      })

      mockDeliveryRepository.findIdsWaitingForCourierOldestFirst.mockResolvedValueOnce([
        'del-waiting-1',
        'del-waiting-2',
      ])

      const courier1 = createMatchedCourier('courier-1', 'user-1')
      const courier2 = createMatchedCourier('courier-2', 'user-2')

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(deliveryHeld) // for deliveryHeld
        .mockResolvedValueOnce(deliveryDue)  // for deliveryDue initial read
        .mockResolvedValueOnce(deliveryDue)  // for deliveryDue after claim

      mockDeliveryMatchingService.findCourierForDelivery
        .mockResolvedValueOnce({
          courier: courier1,
          delivery: deliveryHeld,
          pickupLocation,
          travelSeconds: 360,
        })
        .mockResolvedValueOnce({
          courier: courier2,
          delivery: deliveryDue,
          pickupLocation,
          travelSeconds: 360,
        })

      mockCourierRepository.findByIdOrThrow
        .mockResolvedValueOnce(courier1)
        .mockResolvedValueOnce(courier2)

      await service.matchWaitingDeliveries()

      // Both deliveries must have been examined:
      expect(mockDeliveryMatchingService.findCourierForDelivery).toHaveBeenCalledTimes(2)

      // Delivery 1 was held (NOT_DUE): no offer written for it
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalledWith(
        'del-waiting-1',
        expect.anything(),
        expect.anything()
      )

      // Delivery 2 was offered!
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-waiting-2',
        expect.anything(),
        expect.objectContaining({ matchedCourierId: 'courier-2' })
      )

      // AC-8: NOT_DUE records NO NO_COURIER_AVAILABLE event
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-waiting-1',
          type: EnumDeliveryEventType.NO_COURIER_AVAILABLE,
        })
      )
    })

    it('records NO_COURIER_AVAILABLE when no courier is available for a delivery', async () => {
      const delivery = createWaitingDelivery('del-nobody-free')
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce(undefined)

      await (service as any).offerOrWait('del-nobody-free')

      // When nobody is free, NO_COURIER_AVAILABLE is recorded
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-nobody-free',
          type: EnumDeliveryEventType.NO_COURIER_AVAILABLE,
          actor: EnumEventActor.SYSTEM,
          eventSource: EnumDeliveryEventSource.OPENCOURIER,
        })
      )
    })
  })

  describe('AC-9: offerWaitingDeliveryNow (admin test route)', () => {
    it('skips timing hold with ignoreTiming: true and offers immediately even if due in the future', async () => {
      // readyAt is in 25 min in future (would be NOT_DUE in automatic flow)
      const delivery = createWaitingDelivery('del-admin-test', {
        readyAt: new Date(NOW_MS + 25 * 60_000),
      })
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(delivery)
        .mockResolvedValueOnce({ ...delivery, matchedCourierId: 'courier-1' })

      const courier = createMatchedCourier()
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier,
        delivery,
        pickupLocation,
        travelSeconds: 360,
      })
      mockCourierRepository.findByIdOrThrow.mockResolvedValue(courier)

      const result = await service.offerWaitingDeliveryNow('del-admin-test')

      // Should offer immediately!
      expect(result).toBeDefined()
      expect(result?.courier).toEqual(courier)
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-admin-test',
        expect.anything(),
        expect.objectContaining({ matchedCourierId: 'courier-1' })
      )
    })
  })
})
