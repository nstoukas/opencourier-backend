import { ConfigService } from '@nestjs/config'
import {
  DeliveryRemovalRequest,
  EnumCancelledBy,
  EnumCourierCompensationReason,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumFoodOutcome,
  EnumPartnerChargeReason,
  EnumRemovalRequestStatus,
} from '@prisma/types'
import { DeliveryEventService } from './delivery-event.service'
import { WebsocketDispatcher } from '../websocket/models/WebsocketDispatcher'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { TaskBusScheduler } from '../taskBus/models/TaskBusScheduler'
import { TaskBusService } from '../taskBus/taskBus.service'
import { PartnerWebhookService } from '../partner-webhooks/partner-webhooks.service'
import { DeliveryMatchingService } from '../delivery-matching/delivery-matching.service'
import { DeliveryCalculationService } from '../delivery-calculation/delivery-calculation.service'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { CacheService } from '../cache/cache.service'
import { OfferPushService } from '../pushNotification/offer-push.service'
import { DispatchStopRepository } from 'src/persistence/repositories/dispatch-stop.repository'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'
import { PartnerChargeRepository } from 'src/persistence/repositories/partner-charge.repository'
import { RemovalRequestRepository } from 'src/persistence/repositories/removal-request.repository'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DELIVERY_ONGOING_STATUSES, RemovalRequestDecidedMessage } from 'src/shared-types'
import { WAIT_END_EVENTS } from 'src/domains/delivery/wait-pay'
import { roundMoney } from 'src/core/utils/money'

describe('DeliveryEventService - Removal & Payout (Spec 0035 AC-9, AC-10, AC-14, AC-15)', () => {
  let service: DeliveryEventService

  let mockConfigService: jest.Mocked<ConfigService>
  let mockWebsocketDispatcher: jest.Mocked<WebsocketDispatcher>
  let mockCourierRepository: jest.Mocked<CourierRepository>
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>
  let mockDeliveryEventRepository: jest.Mocked<DeliveryEventRepository>
  let mockTaskScheduler: jest.Mocked<TaskBusScheduler>
  let mockTaskBusService: jest.Mocked<TaskBusService>
  let mockPartnerWebhookService: jest.Mocked<PartnerWebhookService>
  let mockDeliveryMatchingService: jest.Mocked<DeliveryMatchingService>
  let mockDeliveryCalculationService: jest.Mocked<DeliveryCalculationService>
  let mockBullMQService: jest.Mocked<BullMQService>
  let mockConfigDomainService: any
  let mockCacheService: jest.Mocked<CacheService>
  let mockOfferPushService: jest.Mocked<OfferPushService>
  let mockDispatchStopRepository: jest.Mocked<DispatchStopRepository>
  let mockCourierCompensationRepository: jest.Mocked<CourierCompensationRepository>
  let mockPartnerChargeRepository: jest.Mocked<PartnerChargeRepository>
  let mockRemovalRequestRepository: jest.Mocked<RemovalRequestRepository>

  const deliveryId = 'del-removal-spec35'
  const courierId = 'courier-rider-1'
  const partnerId = 'partner-store-1'
  const requestId = 'req-removal-1'

  const makeDelivery = (overrides: Partial<any> = {}): DeliveryEntity =>
    new DeliveryEntity({
      id: deliveryId,
      status: EnumDeliveryStatus.ACCEPTED,
      courierId,
      partnerId,
      totalCompensation: 500,
      totalCost: 600,
      currencyCode: 'EUR',
      cancelledFromStatus: null,
      ...overrides,
    } as any)

  const makeRequest = (overrides: Partial<DeliveryRemovalRequest> = {}): DeliveryRemovalRequest => ({
    id: requestId,
    deliveryId,
    courierId,
    reasonId: 'reason-1',
    label: 'Moped breakdown',
    paidToRider: true,
    chargedToRestaurant: false,
    note: 'Flat tire',
    status: EnumRemovalRequestStatus.APPROVED,
    openFor: null,
    createdAt: new Date('2026-11-09T10:00:00.000Z'),
    decidedAt: new Date('2026-11-09T10:01:00.000Z'),
    decidedByUserId: 'admin-1',
    decisionNote: null,
    payAmount: 350,
    payPolicy: 'FULL_COMPENSATION',
    afterPickup: false,
    settledAt: null,
    ...overrides,
  })

  beforeEach(() => {
    mockConfigService = { get: jest.fn() } as unknown as jest.Mocked<ConfigService>
    mockWebsocketDispatcher = {
      sendOfferToCourier: jest.fn().mockResolvedValue(undefined),
      dispatchDeliveryStatusUpdated: jest.fn().mockResolvedValue(undefined),
      sendRemovalRequestDecided: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WebsocketDispatcher>

    mockCourierRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: courierId, userId: 'user-courier-1' } as any),
      findById: jest.fn().mockResolvedValue({ id: courierId, userId: 'user-courier-1' } as any),
      updateById: jest.fn().mockResolvedValue({} as any),
      hasActiveSos: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<CourierRepository>

    mockDeliveryRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue(makeDelivery()),
      findById: jest.fn().mockResolvedValue(makeDelivery()),
      findByIdOrThrowWithQuote: jest.fn().mockResolvedValue({
        delivery: makeDelivery({ foodOutcome: EnumFoodOutcome.RETURNED }),
        quote: { distanceFee: 400 },
      }),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      findWaitPayToSettle: jest.fn().mockResolvedValue([]),
      findCancellationsToSettle: jest.fn().mockResolvedValue([]),
      findIdsWaitingForCourierOldestFirst: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockDeliveryEventRepository = {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' } as any),
      findLatestJobStepOccurredAt: jest.fn().mockResolvedValue(null),
      findMessagesOfType: jest.fn().mockResolvedValue([]),
      findLatestOfTypes: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<DeliveryEventRepository>

    mockTaskScheduler = {
      scheduleTask: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TaskBusScheduler>
    mockTaskBusService = { registerTaskHandler: jest.fn() } as unknown as jest.Mocked<TaskBusService>
    mockPartnerWebhookService = {
      sendDeliveryUpdatePartnerWebhook: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PartnerWebhookService>
    mockDeliveryMatchingService = {
      matchDeliveryToCourier: jest.fn(),
    } as unknown as jest.Mocked<DeliveryMatchingService>
    mockDeliveryCalculationService = {
      calculateDeliveryAmountsForMatchedCourier: jest.fn(),
    } as unknown as jest.Mocked<DeliveryCalculationService>
    mockBullMQService = {
      addJob: jest.fn().mockResolvedValue(undefined),
      removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<BullMQService>

    mockConfigDomainService = {
      instanceConfig: {
        getOfferExpiryEnabled: jest.fn().mockResolvedValue(false),
        getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
        getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
        getNoCourierRetrySeconds: jest.fn().mockResolvedValue(30),
        getWaitPayEnabled: jest.fn().mockResolvedValue(false),
        getWaitPayCentsPerMinute: jest.fn().mockResolvedValue(10),
        getWaitPayFreeMinutes: jest.fn().mockResolvedValue(5),
        getReturnTripPayPercent: jest.fn().mockResolvedValue(100),
        getCancellationPayoutPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
        getReassignmentPayoutPolicies: jest.fn().mockResolvedValue({ FULL_COMPENSATION: 100 }),
      },
    }

    mockCacheService = {
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CacheService>

    mockOfferPushService = {
      newOffer: jest.fn().mockResolvedValue(undefined),
      offerEnded: jest.fn().mockResolvedValue(undefined),
      jobCancelled: jest.fn().mockResolvedValue(undefined),
      removalRequestDecided: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OfferPushService>

    mockDispatchStopRepository = {
      findOn: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<DispatchStopRepository>

    mockCourierCompensationRepository = {
      createRemovalPayOnce: jest.fn().mockImplementation(async (input) => ({ id: 'comp-rem-1', ...input })),
      createCancellationAwardOnce: jest.fn().mockImplementation(async (input) => ({ id: 'comp-canc-1', ...input })),
      createReturnTripPayOnce: jest.fn().mockImplementation(async (input) => ({ id: 'comp-ret-1', ...input })),
      findCancellationAward: jest.fn().mockResolvedValue(null),
      findReturnTripAward: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<CourierCompensationRepository>

    mockPartnerChargeRepository = {
      createRemovalChargeOnce: jest.fn().mockImplementation(async (input) => ({ id: 'charge-rem-1', ...input })),
      createOnce: jest.fn().mockImplementation(async (input) => ({ id: 'charge-canc-1', ...input })),
      findByDeliveryId: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<PartnerChargeRepository>

    mockRemovalRequestRepository = {
      findById: jest.fn().mockResolvedValue(makeRequest()),
      findApprovedAfterPickup: jest.fn().mockResolvedValue(null),
      markSettled: jest.fn().mockResolvedValue(undefined),
      closeOpenForDelivery: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RemovalRequestRepository>

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
      { getRoute: jest.fn() } as any,
      mockCourierCompensationRepository,
      mockPartnerChargeRepository,
      mockRemovalRequestRepository
    )
  })

  describe('AC-9: removeRiderBeforePickup & finishRemovalBeforePickup in DeliveryEventService', () => {
    test('puts rider on skip list first, writes ASSIGNING_COURIER in one conditional updateIfMatches conditioned on { status, courierId } with cleared rider fields and undispatchedAt set', async () => {
      const delivery = makeDelivery({ status: EnumDeliveryStatus.DISPATCHED })
      const saveSpy = jest.spyOn(mockCacheService, 'save')

      const event = await service.removeRiderBeforePickup(delivery, courierId, 'Restaurant closed')

      expect(event).toBeDefined()
      expect(event?.type).toBe(EnumDeliveryEventType.REMOVAL_APPROVED)
      expect(event?.courierId).toBe(courierId)
      expect(event?.message).toBe('Removal approved: Restaurant closed')

      // Skip list updated first
      expect(saveSpy).toHaveBeenCalledWith(`delivery-rejected-couriers:${deliveryId}`, [courierId], 1200)

      // updateIfMatches condition MUST include courierId and status
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.DISPATCHED, courierId },
        expect.objectContaining({
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          acceptedAt: null,
          handBackUntil: null,
          arrivedAtPickupAt: null,
          undispatchedAt: expect.any(Date),
        })
      )

      // REMOVAL_APPROVED saved directly via repository create with transitionSuccessful: true
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.REMOVAL_APPROVED,
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.DISPATCHED,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
        })
      )
    })

    test('missed conditional write undoes the skip list and returns null without saving event', async () => {
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)
      const delivery = makeDelivery({ status: EnumDeliveryStatus.ACCEPTED })
      mockCacheService.getOrDefault.mockResolvedValueOnce([]).mockResolvedValueOnce([courierId])

      const event = await service.removeRiderBeforePickup(delivery, courierId, 'Broken moped')

      expect(event).toBeNull()
      // Skip list entry undone
      expect(mockCacheService.save).toHaveBeenLastCalledWith(`delivery-rejected-couriers:${deliveryId}`, [], 1200)
      // No REMOVAL_APPROVED event saved
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.REMOVAL_APPROVED })
      )
    })

    test('finishRemovalBeforePickup calls offerOrWait after notifying restaurant and rider', async () => {
      const offerOrWaitSpy = jest.spyOn(service, 'offerOrWait').mockResolvedValue(undefined)
      const approvedEvent = {
        id: 'evt-appr-1',
        deliveryId,
        type: EnumDeliveryEventType.REMOVAL_APPROVED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId,
        occurredAt: new Date(),
        message: 'Removal approved',
      }

      await service.finishRemovalBeforePickup(approvedEvent, EnumDeliveryStatus.ACCEPTED)

      expect(mockWebsocketDispatcher.dispatchDeliveryStatusUpdated).toHaveBeenCalled()
      expect(offerOrWaitSpy).toHaveBeenCalledWith(deliveryId)
    })
  })

  describe('AC-10: CANCELED event has cancelledBy COOP, and REMOVAL_APPROVED recorded only after delivery reads CANCELED', () => {
    test('processDeliveryEvent for cancellation carries cancelledBy: COOP', async () => {
      const cancelDeliverySpy = jest.spyOn(service as any, 'cancelDelivery')
      const delivery = makeDelivery({ status: EnumDeliveryStatus.PICKED_UP })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.findById.mockResolvedValue(
        makeDelivery({ status: EnumDeliveryStatus.CANCELED, cancelledFromStatus: EnumDeliveryStatus.PICKED_UP })
      )

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.CANCELED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        cancelledBy: EnumCancelledBy.COOP,
        message: 'Cancelled for removal after pickup',
      })

      expect(cancelDeliverySpy).toHaveBeenCalledWith(
        delivery,
        expect.objectContaining({
          type: EnumDeliveryEventType.CANCELED,
          cancelledBy: EnumCancelledBy.COOP,
        }),
        EnumDeliveryStatus.PICKED_UP
      )
    })

    test('recordRemovalEvent saves REMOVAL_APPROVED with oldStatus and newStatus matching CANCELED', async () => {
      await service.recordRemovalEvent(
        {
          deliveryId,
          type: EnumDeliveryEventType.REMOVAL_APPROVED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId,
          message: 'Removal approved after pickup, order cancelled',
        },
        EnumDeliveryStatus.CANCELED,
        true
      )

      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.REMOVAL_APPROVED,
          courierId,
          oldStatus: EnumDeliveryStatus.CANCELED,
          newStatus: EnumDeliveryStatus.CANCELED,
          transitionSuccessful: true,
        })
      )
    })
  })

  describe('AC-14: Rider compensation and events', () => {
    test('paid reason before pickup: creates one CourierCompensation (reason REMOVAL, removalOf: id) and records COURIER_PAID_FOR_REMOVAL event', async () => {
      const request = makeRequest({
        paidToRider: true,
        payAmount: 350,
        payPolicy: 'FULL_COMPENSATION',
        afterPickup: false,
      })
      mockRemovalRequestRepository.findById.mockResolvedValue(request)

      await service.settleRemoval(requestId)

      expect(mockCourierCompensationRepository.createRemovalPayOnce).toHaveBeenCalledWith({
        amount: 350,
        currencyCode: 'EUR',
        reason: EnumCourierCompensationReason.REMOVAL,
        policy: 'FULL_COMPENSATION',
        message: expect.stringContaining('Paid for coming off a delivery'),
        courierId,
        deliveryId,
        removalOf: requestId,
      })

      // DeliveryEvent emitted and recorded
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.COURIER_PAID_FOR_REMOVAL,
          courierId,
          message: expect.stringContaining(`removal ${requestId}`),
        })
      )

      // Request marked settled once done
      expect(mockRemovalRequestRepository.markSettled).toHaveBeenCalledWith(requestId)
    })

    test('paid reason after pickup: settleCancellation finds request via findApprovedAfterPickup, pays payAmount and payPolicy as cancellation award, NO REMOVAL row', async () => {
      const request = makeRequest({
        paidToRider: true,
        payAmount: 420,
        payPolicy: 'CANCELLATION_HALF',
        afterPickup: true,
      })
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.CANCELED,
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
        cancelledAt: new Date(),
        courierId,
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)
      mockRemovalRequestRepository.findApprovedAfterPickup.mockResolvedValue(request)

      await service.settleCancellation(deliveryId)

      // findApprovedAfterPickup called with deliveryId and courierId
      expect(mockRemovalRequestRepository.findApprovedAfterPickup).toHaveBeenCalledWith(deliveryId, courierId)

      // Cancellation award created with the request's fixed amount and policy
      expect(mockCourierCompensationRepository.createCancellationAwardOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 420,
          policy: 'CANCELLATION_HALF',
          courierId,
          deliveryId,
        })
      )

      // COURIER_PAID_FOR_CANCELLATION event emitted
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION,
          courierId,
          message: expect.stringContaining('420 EUR (cents) under CANCELLATION_HALF'),
        })
      )

      // NO CourierCompensation with reason REMOVAL is created after pickup
      expect(mockCourierCompensationRepository.createRemovalPayOnce).not.toHaveBeenCalled()

      // Request marked settled
      expect(mockRemovalRequestRepository.markSettled).toHaveBeenCalledWith(requestId)
    })

    test('unpaid reason before pickup: creates NO rider pay and emits NO paid event', async () => {
      const request = makeRequest({
        paidToRider: false,
        payAmount: 300,
        afterPickup: false,
      })
      mockRemovalRequestRepository.findById.mockResolvedValue(request)

      await service.settleRemoval(requestId)

      expect(mockCourierCompensationRepository.createRemovalPayOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_REMOVAL })
      )
      // Still marked settled
      expect(mockRemovalRequestRepository.markSettled).toHaveBeenCalledWith(requestId)
    })

    test('unpaid reason after pickup: settleCancellation skips rider pay and emits NO paid event', async () => {
      const request = makeRequest({
        paidToRider: false,
        payAmount: 300,
        afterPickup: true,
      })
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.CANCELED,
        cancelledFromStatus: EnumDeliveryStatus.ON_THE_WAY,
        cancelledAt: new Date(),
        courierId,
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)
      mockRemovalRequestRepository.findApprovedAfterPickup.mockResolvedValue(request)

      await service.settleCancellation(deliveryId)

      // Award is skipped for unpaid reason
      expect(mockCourierCompensationRepository.createCancellationAwardOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION })
      )
      // Request marked settled
      expect(mockRemovalRequestRepository.markSettled).toHaveBeenCalledWith(requestId)
    })

    test('failed compensation write leaves settledAt null (markSettled NOT called)', async () => {
      const request = makeRequest({
        paidToRider: true,
        payAmount: 350,
        afterPickup: false,
      })
      mockRemovalRequestRepository.findById.mockResolvedValue(request)
      mockCourierCompensationRepository.createRemovalPayOnce.mockRejectedValue(new Error('DB failure'))

      await service.settleRemoval(requestId)

      // markSettled was NOT called because pay failed
      expect(mockRemovalRequestRepository.markSettled).not.toHaveBeenCalled()
    })

    test('settleCancellation after pickup with paid reason: createCancellationAwardOnce rejecting leaves settledAt null (markSettled NOT called)', async () => {
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
        courierId,
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)
      const approvedRequest = makeRequest({
        paidToRider: true,
        payAmount: 400,
        payPolicy: 'FULL_COMPENSATION',
        afterPickup: true,
        settledAt: null,
      })
      mockRemovalRequestRepository.findApprovedAfterPickup.mockResolvedValue(approvedRequest)
      mockCourierCompensationRepository.findCancellationAward.mockResolvedValue(null)
      mockCourierCompensationRepository.createCancellationAwardOnce.mockRejectedValue(
        new Error('Failed writing cancellation award')
      )

      await service.settleCancellation(deliveryId)

      // Award failed, so markSettled is NOT called; settledAt stays null for the sweep
      expect(mockRemovalRequestRepository.markSettled).not.toHaveBeenCalled()
    })

    test('settleCancellation: failure in finishRemovalSettlement is caught, does not throw, leaves settledAt null, logs REMOVAL_SETTLE_FAILED, runs restaurant cancellation charge, and later settleRemoval finishes settlement', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
        cancelledBy: EnumCancelledBy.RESTAURANT,
        partnerId: 'partner-99',
        totalCost: 800,
        currencyCode: 'EUR',
        courierId,
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)
      const approvedRequest = makeRequest({
        paidToRider: true,
        chargedToRestaurant: true,
        payAmount: 400,
        payPolicy: 'FULL_COMPENSATION',
        afterPickup: true,
        settledAt: null,
      })
      mockRemovalRequestRepository.findApprovedAfterPickup.mockResolvedValue(approvedRequest)
      mockCourierCompensationRepository.findCancellationAward.mockResolvedValue({ id: 'comp-1', amount: 400 } as any)

      // Make finishRemovalSettlement fail for real: markSettled rejects
      mockRemovalRequestRepository.markSettled.mockRejectedValueOnce(new Error('Database error during markSettled'))

      // settleCancellation does NOT throw
      await expect(service.settleCancellation(deliveryId)).resolves.not.toThrow()

      // REMOVAL_SETTLE_FAILED is logged with deliveryId
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`REMOVAL_SETTLE_FAILED {"deliveryId":"${deliveryId}"}`)
      )

      // chargePartnerForCancellation still runs for restaurant cancellation
      expect(mockPartnerChargeRepository.createOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerId: 'partner-99',
          deliveryId,
          amount: 800,
          reason: EnumPartnerChargeReason.CANCELLATION,
        })
      )

      // settledAt stayed null because markSettled failed
      expect(approvedRequest.settledAt).toBeNull()

      // A later settleRemoval finishes the settlement
      mockRemovalRequestRepository.findById.mockResolvedValue(approvedRequest)
      mockRemovalRequestRepository.markSettled.mockClear()
      mockRemovalRequestRepository.markSettled.mockResolvedValueOnce(undefined)
      await service.settleRemoval(requestId)
      expect(mockRemovalRequestRepository.markSettled).toHaveBeenCalledTimes(1)
      expect(mockRemovalRequestRepository.markSettled).toHaveBeenCalledWith(requestId)
    })

    test('settleCancellation: REMOVAL_LOOKUP_FAILED branch stops award and compensation write, logs error, does not throw', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
        courierId,
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)
      mockRemovalRequestRepository.findApprovedAfterPickup.mockRejectedValueOnce(
        new Error('Database read failure for approved removal')
      )

      await expect(service.settleCancellation(deliveryId)).resolves.not.toThrow()

      // Error logged with REMOVAL_LOOKUP_FAILED and deliveryId
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`REMOVAL_LOOKUP_FAILED {"deliveryId":"${deliveryId}"}`)
      )

      // Award is NOT made, no compensation write
      expect(mockCourierCompensationRepository.createCancellationAwardOnce).not.toHaveBeenCalled()
      expect(mockCourierCompensationRepository.createRemovalPayOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION })
      )
    })

    test('pin repository query: findApprovedAfterPickup filters by status APPROVED, afterPickup true and courierId', async () => {
      const mockPrisma = {
        deliveryRemovalRequest: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      }
      const repo = new RemovalRequestRepository(mockPrisma as any)

      await repo.findApprovedAfterPickup('del-pin-1', 'courier-pin-1')

      expect(mockPrisma.deliveryRemovalRequest.findFirst).toHaveBeenCalledWith({
        where: {
          deliveryId: 'del-pin-1',
          courierId: 'courier-pin-1',
          status: EnumRemovalRequestStatus.APPROVED,
          afterPickup: true,
        },
        orderBy: { decidedAt: 'desc' },
      })
    })
  })

  describe('AC-15: Restaurant charge for removal', () => {
    test('charged reason on before pickup path: creates one PartnerCharge (reason REMOVAL, removalOf: id, amount: payAmount) and records PARTNER_CHARGED_FOR_REMOVAL event', async () => {
      const request = makeRequest({
        chargedToRestaurant: true,
        paidToRider: true,
        payAmount: 350,
        afterPickup: false,
      })
      mockRemovalRequestRepository.findById.mockResolvedValue(request)

      await service.settleRemoval(requestId)

      expect(mockPartnerChargeRepository.createRemovalChargeOnce).toHaveBeenCalledWith({
        partnerId,
        deliveryId,
        amount: 350,
        currencyCode: 'EUR',
        reason: EnumPartnerChargeReason.REMOVAL,
        removalOf: requestId,
      })

      // DeliveryEvent emitted and recorded
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.PARTNER_CHARGED_FOR_REMOVAL,
          message: expect.stringContaining(`Restaurant charged 350 EUR (cents)`),
        })
      )
    })

    test('charged-and-unpaid reason: partner charge amount is still the fixed payAmount even when rider is unpaid', async () => {
      const request = makeRequest({
        chargedToRestaurant: true,
        paidToRider: false,
        payAmount: 350,
        afterPickup: false,
      })
      mockRemovalRequestRepository.findById.mockResolvedValue(request)

      await service.settleRemoval(requestId)

      // Rider is NOT paid
      expect(mockCourierCompensationRepository.createRemovalPayOnce).not.toHaveBeenCalled()
      // Restaurant is STILL charged the fixed payAmount
      expect(mockPartnerChargeRepository.createRemovalChargeOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 350,
          reason: EnumPartnerChargeReason.REMOVAL,
          removalOf: requestId,
        })
      )
      // Event emitted
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.PARTNER_CHARGED_FOR_REMOVAL,
          message: expect.stringContaining(`Restaurant charged 350 EUR (cents)`),
        })
      )
    })

    test('charged reason on after pickup path: COOP cancellation adds no cancellation charge beside the removal charge', async () => {
      const request = makeRequest({
        chargedToRestaurant: true,
        paidToRider: true,
        payAmount: 400,
        afterPickup: true,
      })
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.CANCELED,
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
        cancelledAt: new Date(),
        courierId,
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)
      mockRemovalRequestRepository.findApprovedAfterPickup.mockResolvedValue(request)

      await service.settleCancellation(deliveryId)

      // Creates removal charge for 400 cents
      expect(mockPartnerChargeRepository.createRemovalChargeOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerId,
          deliveryId,
          amount: 400,
          reason: EnumPartnerChargeReason.REMOVAL,
          removalOf: requestId,
        })
      )
      // NO cancellation charge created for COOP cancellation
      expect(mockPartnerChargeRepository.createOnce).not.toHaveBeenCalled()
    })

    test('not charged reason: creates NO PartnerCharge and records NO charge event', async () => {
      const request = makeRequest({
        chargedToRestaurant: false,
        payAmount: 350,
        afterPickup: false,
      })
      mockRemovalRequestRepository.findById.mockResolvedValue(request)

      await service.settleRemoval(requestId)

      expect(mockPartnerChargeRepository.createRemovalChargeOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.PARTNER_CHARGED_FOR_REMOVAL })
      )
    })

    test('delivery without partner (partnerId null): creates NO PartnerCharge', async () => {
      const request = makeRequest({
        chargedToRestaurant: true,
        payAmount: 350,
        afterPickup: false,
      })
      mockRemovalRequestRepository.findById.mockResolvedValue(request)
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery({ partnerId: null }))

      await service.settleRemoval(requestId)

      expect(mockPartnerChargeRepository.createRemovalChargeOnce).not.toHaveBeenCalled()
    })

    test('AC-18: a sweep that runs twice writes each piece once (idempotent removal settlement, event not repeated)', async () => {
      const request = makeRequest({
        paidToRider: true,
        chargedToRestaurant: true,
        payAmount: 350,
        payPolicy: 'FULL_COMPENSATION',
        afterPickup: false,
      })
      mockRemovalRequestRepository.findById.mockResolvedValue(request)

      // First run: no existing messages
      mockDeliveryEventRepository.findMessagesOfType.mockResolvedValue([])
      await service.settleRemoval(requestId)

      expect(mockCourierCompensationRepository.createRemovalPayOnce).toHaveBeenCalledTimes(1)
      expect(mockCourierCompensationRepository.createRemovalPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({ removalOf: requestId })
      )
      expect(mockPartnerChargeRepository.createRemovalChargeOnce).toHaveBeenCalledTimes(1)
      expect(mockPartnerChargeRepository.createRemovalChargeOnce).toHaveBeenCalledWith(
        expect.objectContaining({ removalOf: requestId })
      )
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_REMOVAL })
      )
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.PARTNER_CHARGED_FOR_REMOVAL })
      )

      // Reset mock invocation counts
      mockDeliveryEventRepository.create.mockClear()

      // Second run: existing messages now carry `removal ${requestId}`
      mockDeliveryEventRepository.findMessagesOfType.mockImplementation(async (delId, type) => {
        if (type === EnumDeliveryEventType.COURIER_PAID_FOR_REMOVAL) {
          return [
            `Courier courier-1 paid 350 EUR (cents) under FULL_COMPENSATION: Order not ready; removal ${requestId}`,
          ]
        }
        if (type === EnumDeliveryEventType.PARTNER_CHARGED_FOR_REMOVAL) {
          return [
            `Partner restaurant charged 350 EUR (cents) under FULL_COMPENSATION: Order not ready; removal ${requestId}`,
          ]
        }
        return []
      })

      await service.settleRemoval(requestId)

      // Compensation and charge createRemoval*Once are called again with unique removalOf (idempotent upsert in repository)
      expect(mockCourierCompensationRepository.createRemovalPayOnce).toHaveBeenCalledTimes(2)
      expect(mockPartnerChargeRepository.createRemovalChargeOnce).toHaveBeenCalledTimes(2)

      // Neither event is repeated because findMessagesOfType already contains `removal ${requestId}`
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_REMOVAL })
      )
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.PARTNER_CHARGED_FOR_REMOVAL })
      )
    })

    test('settleRemoval: a settled request (settledAt already set) never pays again (no createRemovalPayOnce, no createRemovalChargeOnce, no event)', async () => {
      const settledRequest = makeRequest({
        status: EnumRemovalRequestStatus.APPROVED,
        paidToRider: true,
        chargedToRestaurant: true,
        payAmount: 350,
        payPolicy: 'FULL_COMPENSATION',
        afterPickup: false,
        settledAt: new Date('2026-11-09T10:15:00.000Z'),
      })
      mockRemovalRequestRepository.findById.mockResolvedValue(settledRequest)

      await service.settleRemoval(requestId)

      expect(mockCourierCompensationRepository.createRemovalPayOnce).not.toHaveBeenCalled()
      expect(mockPartnerChargeRepository.createRemovalChargeOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalled()
    })
  })

  describe('AC-11: notifyRemovalDecided (websocket and push notification)', () => {
    test('sends websocket and push notification with payload; payAmount is null when reason is unpaid', async () => {
      const unpaidMessage: RemovalRequestDecidedMessage = {
        deliveryId,
        outcome: 'DECLINED',
        decisionNote: 'Finish the delivery please',
        paid: false,
        payAmount: null,
        currencyCode: 'EUR',
      }

      await service.notifyRemovalDecided(courierId, unpaidMessage)

      expect(mockCourierRepository.findById).toHaveBeenCalledWith(courierId)
      expect(mockWebsocketDispatcher.sendRemovalRequestDecided).toHaveBeenCalledWith('user-courier-1', unpaidMessage)
      expect(mockOfferPushService.removalRequestDecided).toHaveBeenCalledWith(courierId, unpaidMessage)
    })

    test('carries payAmount when reason is paid', async () => {
      const paidMessage: RemovalRequestDecidedMessage = {
        deliveryId,
        outcome: 'APPROVED',
        decisionNote: null,
        paid: true,
        payAmount: 350,
        currencyCode: 'EUR',
      }

      await service.notifyRemovalDecided(courierId, paidMessage)

      expect(mockWebsocketDispatcher.sendRemovalRequestDecided).toHaveBeenCalledWith('user-courier-1', paidMessage)
      expect(mockOfferPushService.removalRequestDecided).toHaveBeenCalledWith(courierId, paidMessage)
    })

    test('websocket failure is caught and logged, does not throw or prevent push', async () => {
      mockWebsocketDispatcher.sendRemovalRequestDecided.mockRejectedValueOnce(new Error('Socket disconnected'))
      const message: RemovalRequestDecidedMessage = {
        deliveryId,
        outcome: 'APPROVED',
        decisionNote: null,
        paid: true,
        payAmount: 350,
        currencyCode: 'EUR',
      }

      await expect(service.notifyRemovalDecided(courierId, message)).resolves.toBeUndefined()
      // Push notification is still delivered
      expect(mockOfferPushService.removalRequestDecided).toHaveBeenCalledWith(courierId, message)
    })
  })

  describe('AC-12: Close rule in saveDeliveryEvent', () => {
    test.each([
      EnumDeliveryStatus.CANCELED,
      EnumDeliveryStatus.DROPPED_OFF,
      EnumDeliveryStatus.ASSIGNING_COURIER, // Target of REASSIGNED, RETURNED_TO_WAITING, HANDED_BACK, WAIT_UNDISPATCHED
    ])(
      'successful event with newStatus %s outside DELIVERY_ONGOING_STATUSES closes open request',
      async (newStatus) => {
        await (service as any).saveDeliveryEvent(
          {
            deliveryId,
            type: EnumDeliveryEventType.CANCELED,
            actor: EnumEventActor.ADMIN,
            source: EnumDeliveryEventSource.OPENCOURIER,
          },
          {
            transitionSuccessful: true,
            oldStatus: EnumDeliveryStatus.PICKED_UP,
            newStatus,
          }
        )

        expect(mockRemovalRequestRepository.closeOpenForDelivery).toHaveBeenCalledWith(deliveryId)
      }
    )

    test('reassignment (critical case): successful REASSIGNED event landing in ASSIGNING_COURIER closes open request', async () => {
      await (service as any).saveDeliveryEvent(
        {
          deliveryId,
          type: EnumDeliveryEventType.REASSIGNED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId: 'new-courier',
          droppedCourierId: courierId,
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.DISPATCHED,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
        }
      )

      expect(mockRemovalRequestRepository.closeOpenForDelivery).toHaveBeenCalledWith(deliveryId)
    })

    test('failed row (transitionSuccessful: false) does NOT close open request', async () => {
      await (service as any).saveDeliveryEvent(
        {
          deliveryId,
          type: EnumDeliveryEventType.CANCELED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
        },
        {
          transitionSuccessful: false,
          oldStatus: EnumDeliveryStatus.PICKED_UP,
          newStatus: EnumDeliveryStatus.CANCELED,
        }
      )

      expect(mockRemovalRequestRepository.closeOpenForDelivery).not.toHaveBeenCalled()
    })

    test('move between ongoing statuses (e.g. PICKED_UP) does NOT close open request', async () => {
      await (service as any).saveDeliveryEvent(
        {
          deliveryId,
          type: EnumDeliveryEventType.PICKED_UP,
          actor: EnumEventActor.COURIER,
          source: EnumDeliveryEventSource.OPENCOURIER,
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          newStatus: EnumDeliveryStatus.PICKED_UP,
        }
      )

      expect(mockRemovalRequestRepository.closeOpenForDelivery).not.toHaveBeenCalled()
    })

    test('failure of closeOpenForDelivery never breaks the saved event', async () => {
      mockRemovalRequestRepository.closeOpenForDelivery.mockRejectedValueOnce(new Error('DB failure closing request'))

      const saved = await (service as any).saveDeliveryEvent(
        {
          deliveryId,
          type: EnumDeliveryEventType.DROPPED_OFF,
          actor: EnumEventActor.COURIER,
          source: EnumDeliveryEventSource.OPENCOURIER,
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          newStatus: EnumDeliveryStatus.DROPPED_OFF,
        }
      )

      expect(saved).toBeDefined()
      expect(mockDeliveryEventRepository.create).toHaveBeenCalled()
    })

    test('repository query: closeOpenForDelivery where clause targets openFor and status OPEN', async () => {
      const mockPrisma = {
        deliveryRemovalRequest: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      }
      const repo = new RemovalRequestRepository(mockPrisma as any)

      await repo.closeOpenForDelivery('del-close-where-test')

      expect(mockPrisma.deliveryRemovalRequest.updateMany).toHaveBeenCalledWith({
        where: { openFor: 'del-close-where-test', status: EnumRemovalRequestStatus.OPEN },
        data: { status: EnumRemovalRequestStatus.CLOSED, openFor: null },
      })
    })
  })

  describe('AC-14: Rider approved before pickup, offered again, then restaurant cancels', () => {
    test('normal cancellation pay stands when restaurant cancels after a prior before-pickup removal', async () => {
      // Prior removal was before pickup (so afterPickup is false), findApprovedAfterPickup returns null
      mockRemovalRequestRepository.findApprovedAfterPickup.mockResolvedValue(null)
      mockDeliveryRepository.findById.mockResolvedValue(
        makeDelivery({
          status: EnumDeliveryStatus.CANCELED,
          cancelledFromStatus: EnumDeliveryStatus.ACCEPTED,
          cancelledAt: new Date(),
          cancelledBy: EnumCancelledBy.RESTAURANT,
          cancellationPayoutPolicy: 'FULL_COMPENSATION',
          courierId: 'second-courier-rider',
        })
      )

      await service.settleCancellation(deliveryId)

      // The normal cancellation award is awarded to the rider holding it when restaurant cancelled
      expect(mockCourierCompensationRepository.createCancellationAwardOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          courierId: 'second-courier-rider',
          policy: 'FULL_COMPENSATION',
          amount: 500,
        })
      )
      // Normal cancellation event is recorded
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION,
          courierId: 'second-courier-rider',
        })
      )
    })
  })

  describe('AC-16: Settle return trip (settleReturnTrip)', () => {
    test('amount is quote distanceFee x returnTripPayPercent / 100 rounded, creates CourierCompensation with reason RETURN_TRIP, returnOf delivery id, policy RETURN_TRIP, not charged to restaurant', async () => {
      mockConfigDomainService.instanceConfig.getReturnTripPayPercent.mockResolvedValue(75)
      mockDeliveryRepository.findByIdOrThrowWithQuote.mockResolvedValue({
        delivery: makeDelivery({ foodOutcome: EnumFoodOutcome.RETURNED }),
        quote: { distanceFee: 350 }, // 350 * 75% = 262.5 -> rounded 263
      } as any)
      mockCourierCompensationRepository.findReturnTripAward.mockResolvedValue(null)
      mockDeliveryEventRepository.findLatestOfTypes.mockResolvedValue(null)

      await service.settleReturnTrip(deliveryId)

      expect(mockCourierCompensationRepository.createReturnTripPayOnce).toHaveBeenCalledWith({
        amount: roundMoney((350 * 75) / 100),
        currencyCode: 'EUR',
        reason: EnumCourierCompensationReason.RETURN_TRIP,
        policy: 'RETURN_TRIP',
        message: 'The trip back to the restaurant, at 75% of the distance fee',
        courierId,
        deliveryId,
        returnOf: deliveryId,
      })

      // Delivery event COURIER_PAID_FOR_RETURN_TRIP is recorded
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.COURIER_PAID_FOR_RETURN_TRIP,
          courierId,
          message: expect.stringContaining('paid 263 EUR (cents) for the trip back to the restaurant'),
        })
      )

      // Return trip is NOT charged to the restaurant
      expect(mockPartnerChargeRepository.createRemovalChargeOnce).not.toHaveBeenCalled()
      expect(mockPartnerChargeRepository.createOnce).not.toHaveBeenCalled()
    })

    test('zero amount writes nothing (e.g. returnTripPayPercent is 0)', async () => {
      mockConfigDomainService.instanceConfig.getReturnTripPayPercent.mockResolvedValue(0)
      mockDeliveryRepository.findByIdOrThrowWithQuote.mockResolvedValue({
        delivery: makeDelivery({ foodOutcome: EnumFoodOutcome.RETURNED }),
        quote: { distanceFee: 350 },
      } as any)

      await service.settleReturnTrip(deliveryId)

      expect(mockCourierCompensationRepository.createReturnTripPayOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_RETURN_TRIP })
      )
    })

    test.each([EnumFoodOutcome.NOT_RETURNED, null])(
      'foodOutcome not RETURNED writes nothing: %p',
      async (foodOutcome) => {
        mockDeliveryRepository.findByIdOrThrowWithQuote.mockResolvedValue({
          delivery: makeDelivery({ foodOutcome: foodOutcome as any }),
          quote: { distanceFee: 350 },
        } as any)

        await service.settleReturnTrip(deliveryId)

        expect(mockCourierCompensationRepository.createReturnTripPayOnce).not.toHaveBeenCalled()
        expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
          expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_RETURN_TRIP })
        )
      }
    )

    test('AC-18: a return trip sweep that runs twice settles once and repeats write nothing', async () => {
      mockConfigDomainService.instanceConfig.getReturnTripPayPercent.mockResolvedValue(75)
      mockDeliveryRepository.findByIdOrThrowWithQuote.mockResolvedValue({
        delivery: makeDelivery({ foodOutcome: EnumFoodOutcome.RETURNED }),
        quote: { distanceFee: 350 },
      } as any)

      // First run: no award, no paid event
      const mockAward = { id: 'comp-ret-1', courierId, amount: 263, currencyCode: 'EUR' }
      mockCourierCompensationRepository.findReturnTripAward.mockResolvedValueOnce(null)
      mockCourierCompensationRepository.createReturnTripPayOnce.mockResolvedValueOnce(mockAward as any)
      mockDeliveryEventRepository.findLatestOfTypes.mockResolvedValueOnce(null)

      await service.settleReturnTrip(deliveryId)

      expect(mockCourierCompensationRepository.createReturnTripPayOnce).toHaveBeenCalledTimes(1)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_RETURN_TRIP })
      )

      // Second run: findReturnTripAward finds existing award, findLatestOfTypes finds existing event
      mockCourierCompensationRepository.findReturnTripAward.mockResolvedValueOnce(mockAward as any)
      mockDeliveryEventRepository.findLatestOfTypes.mockResolvedValueOnce({ id: 'evt-paid-1' } as any)
      mockCourierCompensationRepository.createReturnTripPayOnce.mockClear()
      mockDeliveryEventRepository.create.mockClear()

      await service.settleReturnTrip(deliveryId)

      expect(mockCourierCompensationRepository.createReturnTripPayOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_RETURN_TRIP })
      )
    })
  })

  describe('AC-19: Wait pay after move (isWaitPayOwedAfterMove)', () => {
    const arrivedAt = new Date('2026-11-09T10:00:00.000Z')
    const promisedReadyAt = new Date('2026-11-09T10:00:00.000Z')

    beforeEach(() => {
      mockConfigDomainService.instanceConfig.getWaitPayEnabled.mockResolvedValue(true)
      mockConfigDomainService.instanceConfig.getWaitPayCentsPerMinute.mockResolvedValue(10)
      mockConfigDomainService.instanceConfig.getWaitPayFreeMinutes.mockResolvedValue(5)
    })

    test('removeRiderBeforePickup: stamps waitPayOwedAt when status is COURIER_ARRIVED_AT_PICKUP_LOCATION', async () => {
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        arrivedAtPickupAt: arrivedAt,
        promisedReadyAt,
        foodReadyAt: null,
      })

      await service.removeRiderBeforePickup(delivery, courierId, 'Restaurant closed')

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, courierId },
        expect.objectContaining({
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          waitPayOwedAt: expect.any(Date),
        })
      )
    })

    test('removeRiderBeforePickup: does NOT stamp waitPayOwedAt from any other status (e.g. DISPATCHED, ACCEPTED)', async () => {
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.DISPATCHED,
        arrivedAtPickupAt: arrivedAt,
        promisedReadyAt,
      })

      await service.removeRiderBeforePickup(delivery, courierId, 'Moped breakdown')

      const updateCall = mockDeliveryRepository.updateIfMatches.mock.calls[0]!
      expect(updateCall[1]).toEqual({ status: EnumDeliveryStatus.DISPATCHED, courierId })
      expect(updateCall[2].status).toBe(EnumDeliveryStatus.ASSIGNING_COURIER)
      expect(updateCall[2].waitPayOwedAt).toBeUndefined()
    })

    test('removeRiderBeforePickup from COURIER_ARRIVED_AT_PICKUP_LOCATION with wait owed runs settleWaitPay inline, from DISPATCHED it does not', async () => {
      const settleWaitPaySpy = jest.spyOn(service, 'settleWaitPay').mockResolvedValue()

      // 1. From COURIER_ARRIVED_AT_PICKUP_LOCATION with wait owed
      const arrivedDelivery = makeDelivery({
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        arrivedAtPickupAt: arrivedAt,
        promisedReadyAt,
        foodReadyAt: null,
      })
      await service.removeRiderBeforePickup(arrivedDelivery, courierId, 'Restaurant closed')

      expect(settleWaitPaySpy).toHaveBeenCalledTimes(1)
      expect(settleWaitPaySpy).toHaveBeenCalledWith(deliveryId)

      settleWaitPaySpy.mockClear()

      // 2. From DISPATCHED (no wait owed)
      const dispatchedDelivery = makeDelivery({
        status: EnumDeliveryStatus.DISPATCHED,
        arrivedAtPickupAt: arrivedAt,
        promisedReadyAt,
      })
      await service.removeRiderBeforePickup(dispatchedDelivery, courierId, 'Moped breakdown')

      expect(settleWaitPaySpy).not.toHaveBeenCalled()
    })

    test('admin reassign (REASSIGNED): stamps waitPayOwedAt when leaving COURIER_ARRIVED_AT_PICKUP_LOCATION', async () => {
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        arrivedAtPickupAt: arrivedAt,
        promisedReadyAt,
      })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryCalculationService.calculateDeliveryAmountsForMatchedCourier.mockResolvedValue({
        deliveryId,
        totalCost: 600,
        totalCompensation: 500,
        fee: 100,
        feePercentage: 20,
      })

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.REASSIGNED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: 'new-courier',
      })

      // The status write in updateDeliveryAndSendNotifications carries waitPayOwedAt
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION },
        expect.objectContaining({
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          waitPayOwedAt: expect.any(Date),
        })
      )
    })

    test('admin reassign (REASSIGNED): does NOT stamp waitPayOwedAt from any other status (e.g. DISPATCHED)', async () => {
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.DISPATCHED,
        arrivedAtPickupAt: arrivedAt,
        promisedReadyAt,
      })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryCalculationService.calculateDeliveryAmountsForMatchedCourier.mockResolvedValue({
        deliveryId,
        totalCost: 600,
        totalCompensation: 500,
        fee: 100,
        feePercentage: 20,
      })

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.REASSIGNED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: 'new-courier',
      })

      // The status write does not carry waitPayOwedAt
      const statusCall = mockDeliveryRepository.updateIfMatches.mock.calls.find(
        (call) =>
          call[1]?.status === EnumDeliveryStatus.DISPATCHED && call[2]?.status === EnumDeliveryStatus.ASSIGNING_COURIER
      )
      expect(statusCall).toBeDefined()
      expect(statusCall![2].waitPayOwedAt).toBeUndefined()
    })

    test('dispatch stop return (returnToWaitingForDispatchStop): stamps waitPayOwedAt from COURIER_ARRIVED_AT_PICKUP_LOCATION and not from DISPATCHED', async () => {
      const arrivedDelivery = makeDelivery({
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        arrivedAtPickupAt: arrivedAt,
        promisedReadyAt,
      })
      mockDeliveryRepository.findById.mockResolvedValueOnce(arrivedDelivery)

      await service.returnToWaitingForDispatchStop(deliveryId, courierId, EnumEventActor.ADMIN, 'Heat wave')

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, courierId },
        expect.objectContaining({
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          waitPayOwedAt: expect.any(Date),
        })
      )

      // From DISPATCHED
      const dispatchedDelivery = makeDelivery({
        status: EnumDeliveryStatus.DISPATCHED,
        arrivedAtPickupAt: arrivedAt,
        promisedReadyAt,
      })
      mockDeliveryRepository.findById.mockResolvedValueOnce(dispatchedDelivery)

      await service.returnToWaitingForDispatchStop(deliveryId, courierId, EnumEventActor.ADMIN, 'Heat wave')

      const dispatchedCall =
        mockDeliveryRepository.updateIfMatches.mock.calls[mockDeliveryRepository.updateIfMatches.mock.calls.length - 1]
      expect(dispatchedCall![1]).toEqual({ status: EnumDeliveryStatus.DISPATCHED, courierId })
      expect(dispatchedCall![2].status).toBe(EnumDeliveryStatus.ASSIGNING_COURIER)
      expect(dispatchedCall![2].waitPayOwedAt).toBeUndefined()
    })

    test('wait pay is owed after move whether or not the removal reason is paid', async () => {
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        arrivedAtPickupAt: arrivedAt,
        promisedReadyAt,
      })

      // Even if reason is unpaid, wait pay from arrival is still stamped
      await service.removeRiderBeforePickup(delivery, courierId, 'Personal emergency')

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, courierId },
        expect.objectContaining({
          waitPayOwedAt: expect.any(Date),
        })
      )
    })
  })

  describe('AC-20: WAIT_END_EVENTS & saved row courierId', () => {
    test('WAIT_END_EVENTS contains REMOVAL_APPROVED, REASSIGNED, and RETURNED_TO_WAITING', () => {
      expect(WAIT_END_EVENTS).toContain(EnumDeliveryEventType.REMOVAL_APPROVED)
      expect(WAIT_END_EVENTS).toContain(EnumDeliveryEventType.REASSIGNED)
      expect(WAIT_END_EVENTS).toContain(EnumDeliveryEventType.RETURNED_TO_WAITING)
    })

    test('saved REASSIGNED row stores the dropped rider in courierId from droppedCourierId while event courierId is the new rider', async () => {
      await (service as any).saveDeliveryEvent(
        {
          deliveryId,
          type: EnumDeliveryEventType.REASSIGNED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId: 'new-courier',
          droppedCourierId: 'dropped-rider-1',
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.DISPATCHED,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
        }
      )

      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.REASSIGNED,
          courierId: 'dropped-rider-1', // Saved column is droppedCourierId!
        })
      )
    })

    test('saved RETURNED_TO_WAITING and REMOVAL_APPROVED store their rider in courierId', async () => {
      await (service as any).saveDeliveryEvent(
        {
          deliveryId,
          type: EnumDeliveryEventType.RETURNED_TO_WAITING,
          actor: EnumEventActor.SYSTEM,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId: 'stop-rider-1',
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.DISPATCHED,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
        }
      )
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.RETURNED_TO_WAITING,
          courierId: 'stop-rider-1',
        })
      )

      await (service as any).saveDeliveryEvent(
        {
          deliveryId,
          type: EnumDeliveryEventType.REMOVAL_APPROVED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId: 'removed-rider-1',
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.DISPATCHED,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
        }
      )
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.REMOVAL_APPROVED,
          courierId: 'removed-rider-1',
        })
      )
    })

    test('a REASSIGNED event given to processDeliveryEvent with no droppedCourierId saves row courierId as current rider before the move (dropped rider), not new rider or undefined', async () => {
      const currentRider = 'dropped-rider-original'
      const newRider = 'new-courier-rider'
      const delivery = makeDelivery({
        id: deliveryId,
        status: EnumDeliveryStatus.DISPATCHED,
        courierId: currentRider,
      })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryCalculationService.calculateDeliveryAmountsForMatchedCourier.mockResolvedValue({
        deliveryId,
        totalCost: 600,
        totalCompensation: 500,
        fee: 100,
        feePercentage: 20,
      })
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

      const reassignEvent = {
        deliveryId,
        type: EnumDeliveryEventType.REASSIGNED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: newRider,
      }

      await service.processDeliveryEvent(reassignEvent)

      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.REASSIGNED,
          courierId: currentRider,
        })
      )

      const reassignCall = mockDeliveryEventRepository.create.mock.calls.find(
        (c) => c[0]?.type === EnumDeliveryEventType.REASSIGNED
      )
      expect(reassignCall).toBeDefined()
      expect(reassignCall![0].courierId).toBe(currentRider)
      expect(reassignCall![0].courierId).not.toBe(newRider)
      expect(reassignCall![0].courierId).not.toBeUndefined()
    })
  })

  describe('AC-21: processDeliveryEvent refuses the seven new removal types', () => {
    const removalTypes = [
      EnumDeliveryEventType.REMOVAL_REQUESTED,
      EnumDeliveryEventType.REMOVAL_WITHDRAWN,
      EnumDeliveryEventType.REMOVAL_DECLINED,
      EnumDeliveryEventType.REMOVAL_APPROVED,
      EnumDeliveryEventType.COURIER_PAID_FOR_REMOVAL,
      EnumDeliveryEventType.PARTNER_CHARGED_FOR_REMOVAL,
      EnumDeliveryEventType.COURIER_PAID_FOR_RETURN_TRIP,
    ]

    test.each(removalTypes)(
      'processDeliveryEvent refuses %s: delivery status unchanged, no status write, failed row saved',
      async (type) => {
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(
          makeDelivery({ status: EnumDeliveryStatus.ACCEPTED, courierId })
        )

        await service.processDeliveryEvent({
          deliveryId,
          type,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId,
        } as any)

        // No status write
        expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()

        // A failed row is what is saved
        expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({
            deliveryId,
            type,
            transitionSuccessful: false,
            oldStatus: EnumDeliveryStatus.ACCEPTED,
            message: `${type} is recorded by a removal request only`,
          })
        )
      }
    )
  })
})
