import { ConfigService } from '@nestjs/config'
import {
  EnumCancelledBy,
  EnumCourierCompensationReason,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumPartnerChargeReason,
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
import { DeliveryCanceledEvent, DELIVERY_ONGOING_STATUSES } from 'src/shared-types'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'

describe('DeliveryEventService - Cancellation & Payout (Spec 0015)', () => {
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
  let mockConfigDomainService: jest.Mocked<ConfigDomainService>
  let mockCacheService: jest.Mocked<CacheService>
  let mockOfferPushService: jest.Mocked<OfferPushService>
  let mockDispatchStopRepository: jest.Mocked<DispatchStopRepository>
  let mockCourierCompensationRepository: jest.Mocked<CourierCompensationRepository>
  let mockPartnerChargeRepository: jest.Mocked<PartnerChargeRepository>

  const deliveryId = 'del-cancel-spec15'
  const courierId = 'courier-rider-1'
  const partnerId = 'partner-store-1'

  const makeDelivery = (overrides?: Partial<any>): DeliveryEntity =>
    new DeliveryEntity({
      id: deliveryId,
      status: EnumDeliveryStatus.ACCEPTED,
      courierId,
      partnerId,
      totalCompensation: 800, // 8.00 EUR
      totalCost: 1200, // 12.00 EUR
      currencyCode: 'EUR',
      cancelledBy: null,
      cancelledFromStatus: null,
      cancelledAt: null,
      foodOutcome: null,
      foodOutcomeAt: null,
      ...overrides,
    } as any)

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>

    mockWebsocketDispatcher = {
      sendOfferToCourier: jest.fn().mockResolvedValue(undefined),
      dispatchDeliveryStatusUpdated: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WebsocketDispatcher>

    mockCourierRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: courierId, userId: 'user-courier-1' } as any),
      findById: jest.fn().mockResolvedValue({ id: courierId, userId: 'user-courier-1' } as any),
      updateById: jest.fn().mockResolvedValue({} as any),
    } as unknown as jest.Mocked<CourierRepository>

    mockDeliveryRepository = {
      findById: jest.fn(),
      findByIdOrThrow: jest.fn(),
      update: jest.fn().mockImplementation((id, data) => Promise.resolve({ id, ...data })),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      findIdsWaitingForCourierOldestFirst: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockDeliveryEventRepository = {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' } as any),
      findLatestOfTypes: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<DeliveryEventRepository>

    mockTaskScheduler = {
      scheduleTask: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TaskBusScheduler>

    mockTaskBusService = {
      registerTaskHandler: jest.fn(),
    } as unknown as jest.Mocked<TaskBusService>

    mockPartnerWebhookService = {
      sendDeliveryUpdatePartnerWebhook: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PartnerWebhookService>

    mockDeliveryMatchingService = {
      matchDeliveryToCourier: jest.fn(),
      matchWaitingDeliveries: jest.fn().mockResolvedValue(undefined),
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
        getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
        getNoCourierRetrySeconds: jest.fn().mockResolvedValue(30),
        getReassignmentPayoutPolicies: jest.fn().mockResolvedValue({
          FULL_COMPENSATION: 100,
          HALF_COMPENSATION: 50,
          NO_COMPENSATION: 0,
        }),
        getCancellationPayoutPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
      },
    } as unknown as jest.Mocked<ConfigDomainService>

    mockCacheService = {
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CacheService>

    mockOfferPushService = {
      newOffer: jest.fn(),
      offerEnded: jest.fn(),
      jobCancelled: jest.fn(),
    } as unknown as jest.Mocked<OfferPushService>

    mockDispatchStopRepository = {
      findOn: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<DispatchStopRepository>

    mockCourierCompensationRepository = {
      findCancellationAward: jest.fn().mockResolvedValue(null),
      createCancellationAwardOnce: jest.fn().mockImplementation((input) =>
        Promise.resolve({
          id: 'comp-1',
          ...input,
        })
      ),
    } as unknown as jest.Mocked<CourierCompensationRepository>

    mockPartnerChargeRepository = {
      findByDeliveryId: jest.fn().mockResolvedValue(null),
      createOnce: jest.fn().mockImplementation((input) =>
        Promise.resolve({
          id: 'charge-1',
          ...input,
        })
      ),
    } as unknown as jest.Mocked<PartnerChargeRepository>

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
      mockCourierCompensationRepository,
      mockPartnerChargeRepository
    )
  })

  describe('AC-14: Conditional CANCELED status write and race protection', () => {
    it('writes CANCELED via updateIfMatches conditioned on { status: oldStatus, courierId }', async () => {
      const delivery = makeDelivery({ status: EnumDeliveryStatus.PICKED_UP })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.findById.mockResolvedValue({
        ...delivery,
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
      } as any)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.CANCELED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
        cancelledBy: EnumCancelledBy.RESTAURANT,
      })

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.PICKED_UP, courierId },
        expect.objectContaining({
          status: EnumDeliveryStatus.CANCELED,
          cancelledBy: EnumCancelledBy.RESTAURANT,
          cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
          cancelledAt: expect.any(Date),
        })
      )
    })

    it('when updateIfMatches misses (returns false), records a failed transition and writes NO award, charge, or paid event', async () => {
      const delivery = makeDelivery({ status: EnumDeliveryStatus.ACCEPTED })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false) // lost race

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.CANCELED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
      })

      // Failed transition saved
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.CANCELED,
          transitionSuccessful: false,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          newStatus: EnumDeliveryStatus.CANCELED,
        })
      )

      // NO settlement attempted
      expect(mockCourierCompensationRepository.createCancellationAwardOnce).not.toHaveBeenCalled()
      expect(mockPartnerChargeRepository.createOnce).not.toHaveBeenCalled()
      expect(mockOfferPushService.jobCancelled).not.toHaveBeenCalled()
    })
  })

  describe('AC-1, AC-2, AC-9: Cancellation award and event for all ongoing statuses', () => {
    // Test each ongoing status with courier
    DELIVERY_ONGOING_STATUSES.forEach((status) => {
      it(`awards pay and records paid event when cancelled from ${status}`, async () => {
        const delivery = makeDelivery({ status, totalCompensation: 800 })
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
        mockDeliveryRepository.findById.mockResolvedValue({
          ...delivery,
          status: EnumDeliveryStatus.CANCELED,
          cancelledAt: new Date(),
          cancelledFromStatus: status,
          cancelledBy: EnumCancelledBy.CUSTOMER,
        } as any)

        await service.processDeliveryEvent({
          deliveryId,
          type: EnumDeliveryEventType.CANCELED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
          cancelledBy: EnumCancelledBy.CUSTOMER,
        })

        // 1. One CourierCompensation row created
        expect(mockCourierCompensationRepository.createCancellationAwardOnce).toHaveBeenCalledWith({
          deliveryId,
          courierId,
          cancellationOf: deliveryId,
          amount: 800, // 800 * 100%
          currencyCode: 'EUR',
          reason: EnumCourierCompensationReason.CANCELLATION,
          policy: 'FULL_COMPENSATION',
          message: 'Paid for a job cancelled by CUSTOMER',
        })

        // 2. One COURIER_PAID_FOR_CANCELLATION event recorded directly (actor SYSTEM, courierId set, oldStatus = newStatus = CANCELED)
        expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({
            deliveryId,
            type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION,
            actor: EnumEventActor.SYSTEM,
            eventSource: EnumDeliveryEventSource.OPENCOURIER,
            courierId,
            oldStatus: EnumDeliveryStatus.CANCELED,
            newStatus: EnumDeliveryStatus.CANCELED,
            transitionSuccessful: true,
          })
        )

        // 3. Alert pushed to rider's phone
        expect(mockOfferPushService.jobCancelled).toHaveBeenCalledWith(courierId, deliveryId)
      })
    })

    it('settleCancellation called twice writes nothing more (idempotent)', async () => {
      const cancelledDelivery = makeDelivery({
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.ACCEPTED,
        cancelledBy: EnumCancelledBy.RESTAURANT,
      })
      mockDeliveryRepository.findById.mockResolvedValue(cancelledDelivery)

      // First run: writes award and event and charge
      await service.settleCancellation(deliveryId)
      expect(mockCourierCompensationRepository.createCancellationAwardOnce).toHaveBeenCalledTimes(1)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledTimes(1)
      expect(mockPartnerChargeRepository.createOnce).toHaveBeenCalledTimes(1)

      // Now mock that award, event, and charge already exist
      mockCourierCompensationRepository.findCancellationAward.mockResolvedValue({
        id: 'comp-1',
        amount: 800,
        policy: 'FULL_COMPENSATION',
        courierId,
      } as any)
      mockDeliveryEventRepository.findLatestOfTypes.mockResolvedValue({
        id: 'evt-paid-1',
        type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION,
      } as any)
      mockPartnerChargeRepository.findByDeliveryId.mockResolvedValue({ id: 'charge-1' } as any)

      // Second run: writes nothing more
      await service.settleCancellation(deliveryId)
      expect(mockCourierCompensationRepository.createCancellationAwardOnce).toHaveBeenCalledTimes(1)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledTimes(1)
      expect(mockPartnerChargeRepository.createOnce).toHaveBeenCalledTimes(1)
    })

    it('when award row exists but paid event is missing: writes only the event with row amount and policy', async () => {
      const cancelledDelivery = makeDelivery({
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.ACCEPTED,
      })
      mockDeliveryRepository.findById.mockResolvedValue(cancelledDelivery)

      // Award row exists with 400 cents under HALF_COMPENSATION
      mockCourierCompensationRepository.findCancellationAward.mockResolvedValue({
        id: 'comp-existing',
        amount: 400,
        policy: 'HALF_COMPENSATION',
        courierId,
        currencyCode: 'EUR',
      } as any)
      // Paid event missing
      mockDeliveryEventRepository.findLatestOfTypes.mockResolvedValue(null)

      await service.settleCancellation(deliveryId)

      // Award row was not created again
      expect(mockCourierCompensationRepository.createCancellationAwardOnce).not.toHaveBeenCalled()

      // Paid event created with the row's amount and policy
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION,
          actor: EnumEventActor.SYSTEM,
          courierId,
          message: expect.stringContaining('Courier courier-rider-1 paid 400 EUR (cents) under HALF_COMPENSATION'),
        })
      )
    })
  })

  describe('AC-3: Cancellation before rider accepted pays nobody and charges nobody', () => {
    it('settleCancellation returns early and awards nothing and charges nothing when cancelledFromStatus is not ongoing', async () => {
      const nonOngoingDelivery = makeDelivery({
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.CREATED,
        cancelledBy: EnumCancelledBy.RESTAURANT,
        courierId, // Even if courierId is set
      })
      mockDeliveryRepository.findById.mockResolvedValue(nonOngoingDelivery)

      await service.settleCancellation(deliveryId)

      expect(mockCourierCompensationRepository.createCancellationAwardOnce).not.toHaveBeenCalled()
      expect(mockPartnerChargeRepository.createOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalled()
    })

    it('cancel from CREATED: no award, no charge, no paid event', async () => {
      const delivery = makeDelivery({ status: EnumDeliveryStatus.CREATED, courierId: null })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.findById.mockResolvedValue({
        ...delivery,
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.CREATED,
        cancelledBy: EnumCancelledBy.RESTAURANT,
      } as any)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.CANCELED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
        cancelledBy: EnumCancelledBy.RESTAURANT,
      })

      expect(mockCourierCompensationRepository.createCancellationAwardOnce).not.toHaveBeenCalled()
      expect(mockPartnerChargeRepository.createOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION })
      )
      expect(mockOfferPushService.jobCancelled).not.toHaveBeenCalled()
    })

    it('cancel from ASSIGNING_COURIER (even with open offer): no award, no charge, no paid event', async () => {
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        matchedCourierId: 'some-offered-rider',
      })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.findById.mockResolvedValue({
        ...delivery,
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
        cancelledBy: EnumCancelledBy.RESTAURANT,
      } as any)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.CANCELED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
        cancelledBy: EnumCancelledBy.RESTAURANT,
      })

      expect(mockCourierCompensationRepository.createCancellationAwardOnce).not.toHaveBeenCalled()
      expect(mockPartnerChargeRepository.createOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION })
      )
      expect(mockOfferPushService.jobCancelled).not.toHaveBeenCalled()
    })
  })

  describe('AC-6: Restaurant charge for cancellation after accept', () => {
    it('creates PartnerCharge of totalCost for RESTAURANT cancellation after accept', async () => {
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
        cancelledBy: EnumCancelledBy.RESTAURANT,
        totalCost: 1550,
        currencyCode: 'EUR',
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)

      await service.settleCancellation(deliveryId)

      expect(mockPartnerChargeRepository.createOnce).toHaveBeenCalledWith({
        partnerId,
        deliveryId,
        amount: 1550,
        currencyCode: 'EUR',
        reason: EnumPartnerChargeReason.CANCELLATION,
      })
    })

    it('creates NO PartnerCharge for CUSTOMER cancellation', async () => {
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
        cancelledBy: EnumCancelledBy.CUSTOMER,
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)

      await service.settleCancellation(deliveryId)

      expect(mockPartnerChargeRepository.createOnce).not.toHaveBeenCalled()
    })

    it('creates NO PartnerCharge for COOP cancellation', async () => {
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
        cancelledBy: EnumCancelledBy.COOP,
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)

      await service.settleCancellation(deliveryId)

      expect(mockPartnerChargeRepository.createOnce).not.toHaveBeenCalled()
    })

    it('creates NO PartnerCharge and logs warning when delivery has no partnerId', async () => {
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
        cancelledBy: EnumCancelledBy.RESTAURANT,
        partnerId: null,
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)

      await service.settleCancellation(deliveryId)

      expect(mockPartnerChargeRepository.createOnce).not.toHaveBeenCalled()
    })

    it('creates PartnerCharge with amount 0 and logs warning when totalCost is null', async () => {
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
        cancelledBy: EnumCancelledBy.RESTAURANT,
        totalCost: null,
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)

      await service.settleCancellation(deliveryId)

      expect(mockPartnerChargeRepository.createOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 0,
        })
      )
    })
  })

  describe('saveDeliveryEvent courierId allow list', () => {
    it('sets courierId for COURIER_PAID_FOR_CANCELLATION, FOOD_RETURNED, and FOOD_NOT_RETURNED', async () => {
      // 1. COURIER_PAID_FOR_CANCELLATION
      await service.recordCancellationEvent(
        {
          deliveryId,
          type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION,
          actor: EnumEventActor.SYSTEM,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId: 'rider-123',
          message: 'Paid',
        },
        EnumDeliveryStatus.CANCELED
      )

      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION,
          courierId: 'rider-123',
        })
      )

      // 2. FOOD_RETURNED
      await service.recordCancellationEvent(
        {
          deliveryId,
          type: EnumDeliveryEventType.FOOD_RETURNED,
          actor: EnumEventActor.COURIER,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId: 'rider-456',
        },
        EnumDeliveryStatus.CANCELED
      )

      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.FOOD_RETURNED,
          courierId: 'rider-456',
        })
      )

      // 3. FOOD_NOT_RETURNED
      await service.recordCancellationEvent(
        {
          deliveryId,
          type: EnumDeliveryEventType.FOOD_NOT_RETURNED,
          actor: EnumEventActor.COURIER,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId: 'rider-789',
          message: 'Restaurant closed',
        },
        EnumDeliveryStatus.CANCELED
      )

      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.FOOD_NOT_RETURNED,
          courierId: 'rider-789',
        })
      )
    })
  })
})
