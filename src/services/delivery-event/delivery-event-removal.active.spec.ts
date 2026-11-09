import { ConfigService } from '@nestjs/config'
import {
  DeliveryRemovalRequest,
  EnumCancelledBy,
  EnumCourierCompensationReason,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
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

    mockTaskScheduler = { scheduleTask: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<TaskBusScheduler>
    mockTaskBusService = { registerTaskHandler: jest.fn() } as unknown as jest.Mocked<TaskBusService>
    mockPartnerWebhookService = {
      sendDeliveryUpdatePartnerWebhook: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PartnerWebhookService>
    mockDeliveryMatchingService = { matchDeliveryToCourier: jest.fn() } as unknown as jest.Mocked<DeliveryMatchingService>
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
    } as unknown as jest.Mocked<OfferPushService>

    mockDispatchStopRepository = { findOn: jest.fn().mockResolvedValue(null) } as unknown as jest.Mocked<DispatchStopRepository>

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
      expect(saveSpy).toHaveBeenCalledWith(
        `delivery-rejected-couriers:${deliveryId}`,
        [courierId],
        1200
      )

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
      expect(mockCacheService.save).toHaveBeenLastCalledWith(
        `delivery-rejected-couriers:${deliveryId}`,
        [],
        1200
      )
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
  })
})
