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
  let mockConfigDomainService: any
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
      cancellationPayoutPolicy: null,
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
      sendOfferEnded: jest.fn().mockResolvedValue(undefined),
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
          cancellationPayoutPolicy: 'FULL_COMPENSATION',
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

    it('Decision 32.17: when DROPPED_OFF updateIfMatches misses (e.g. status moved to CANCELED under it), saves a failed transition, sends NO notifications, does NOT call matchWaitingDeliveries, and leaves no successful DROPPED_OFF event', async () => {
      // Step was read as COURIER_ARRIVED_AT_DROPOFF_LOCATION
      const delivery = makeDelivery({ status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      // Status moved to CANCELED under it: updateIfMatches fails
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)

      const matchWaitingSpy = jest.spyOn(service, 'matchWaitingDeliveries')

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.DROPPED_OFF,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        deliveredData: {},
      })

      // 1. updateIfMatches was attempted conditionally on { status: COURIER_ARRIVED_AT_DROPOFF_LOCATION }
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION },
        expect.objectContaining({ status: EnumDeliveryStatus.DROPPED_OFF })
      )

      // 2. Old unconditional deliveryRepository.update was NOT called
      expect(mockDeliveryRepository.update).not.toHaveBeenCalledWith(
        deliveryId,
        expect.objectContaining({ status: EnumDeliveryStatus.DROPPED_OFF })
      )

      // 3. Failed transition is saved with transitionSuccessful: false
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.DROPPED_OFF,
          transitionSuccessful: false,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
          newStatus: EnumDeliveryStatus.DROPPED_OFF,
        })
      )
      // 4. NO successful event row written
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          transitionSuccessful: true,
        })
      )

      // 5. NO notifications sent
      expect(mockWebsocketDispatcher.dispatchDeliveryStatusUpdated).not.toHaveBeenCalled()
      expect(mockPartnerWebhookService.sendDeliveryUpdatePartnerWebhook).not.toHaveBeenCalled()

      // 6. matchWaitingDeliveries was NOT called (rider does not get new orders for a failed drop-off)
      expect(matchWaitingSpy).not.toHaveBeenCalled()
    })

    it('Decision 32.17: when PICKED_UP updateIfMatches misses (e.g. status moved to CANCELED under it), saves a failed transition, writes no successful row, and sends no notification', async () => {
      const delivery = makeDelivery({ status: EnumDeliveryStatus.DISPATCHED })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.PICKED_UP,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
      })

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.DISPATCHED },
        expect.objectContaining({ status: EnumDeliveryStatus.PICKED_UP })
      )

      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.PICKED_UP,
          transitionSuccessful: false,
          oldStatus: EnumDeliveryStatus.DISPATCHED,
          newStatus: EnumDeliveryStatus.PICKED_UP,
        })
      )

      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          transitionSuccessful: true,
        })
      )
      expect(mockWebsocketDispatcher.dispatchDeliveryStatusUpdated).not.toHaveBeenCalled()
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

  describe('Decision 32.17: ACCEPTED, DISPATCHED, ON_THE_WAY write courierId inside the conditional write', () => {
    it('ACCEPTED writes courierId and offerExpiresAt: null inside updateIfMatches with NO prior unconditional update', async () => {
      const delivery = makeDelivery({ status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId: null, matchedCourierId: courierId })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId,
      })

      // Written in updateIfMatches
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        expect.objectContaining({
          status: EnumDeliveryStatus.ACCEPTED,
          courierId,
          offerExpiresAt: null,
        })
      )

      // NO unconditional repository update before or during
      expect(mockDeliveryRepository.update).not.toHaveBeenCalled()
    })

    it('an ACCEPTED whose conditional write misses leaves NO courierId written', async () => {
      const delivery = makeDelivery({ status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId: null, matchedCourierId: courierId })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false) // lost race (e.g. cancelled)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId,
      })

      // NO courierId written to repository via update
      expect(mockDeliveryRepository.update).not.toHaveBeenCalled()
      // Failed transition recorded
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.ACCEPTED,
          transitionSuccessful: false,
        })
      )
    })

    it('DISPATCHED writes courierId inside updateIfMatches with NO unconditional update', async () => {
      const delivery = makeDelivery({ status: EnumDeliveryStatus.ACCEPTED, courierId })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.DISPATCHED,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId,
      })

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.ACCEPTED },
        expect.objectContaining({
          status: EnumDeliveryStatus.DISPATCHED,
          courierId,
        })
      )
      expect(mockDeliveryRepository.update).not.toHaveBeenCalled()
    })

    it('ON_THE_WAY writes courierId inside updateIfMatches with NO unconditional update', async () => {
      const delivery = makeDelivery({ status: EnumDeliveryStatus.PICKED_UP, courierId })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.ON_THE_WAY,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId,
      })

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.PICKED_UP },
        expect.objectContaining({
          status: EnumDeliveryStatus.ON_THE_WAY,
          courierId,
        })
      )
      expect(mockDeliveryRepository.update).not.toHaveBeenCalled()
    })
  })

  describe('Cancel from ASSIGNING_COURIER with open offer sends OFFER_ENDED with reason MOVED (row 32 review)', () => {
    it('sends OFFER_ENDED with reason MOVED to the offered rider when cancelled from ASSIGNING_COURIER with matchedCourierId', async () => {
      const offeredCourierId = 'courier-offered-1'
      const offeredCourier = { id: offeredCourierId, userId: 'user-offered-1' }
      mockCourierRepository.findById.mockResolvedValueOnce(offeredCourier as any)

      const delivery = makeDelivery({
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        matchedCourierId: offeredCourierId,
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

      expect(mockCourierRepository.findById).toHaveBeenCalledWith(offeredCourierId)
      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith('user-offered-1', {
        deliveryId,
        reason: 'MOVED',
      })
      expect(mockOfferPushService.offerEnded).toHaveBeenCalledWith(offeredCourierId, {
        deliveryId,
        reason: 'MOVED',
      })
    })

    it('a failure sending OFFER_ENDED is logged and NEVER undoes the cancel', async () => {
      const offeredCourierId = 'courier-offered-fail'
      mockCourierRepository.findById.mockRejectedValueOnce(new Error('DB disconnect'))

      const delivery = makeDelivery({
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        matchedCourierId: offeredCourierId,
      })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.findById.mockResolvedValue({
        ...delivery,
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
        cancelledBy: EnumCancelledBy.RESTAURANT,
      } as any)

      // Must not throw:
      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.CANCELED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
        cancelledBy: EnumCancelledBy.RESTAURANT,
      })

      // Cancel was successful and recorded
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.CANCELED,
          transitionSuccessful: true,
        })
      )
    })

    it('does NOT send OFFER_ENDED when matchedCourierId is null', async () => {
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        matchedCourierId: null,
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

      expect(mockWebsocketDispatcher.sendOfferEnded).not.toHaveBeenCalled()
      expect(mockOfferPushService.offerEnded).not.toHaveBeenCalled()
    })

    it('does NOT send OFFER_ENDED when cancel came from another status (e.g. ACCEPTED)', async () => {
      const delivery = makeDelivery({
        status: EnumDeliveryStatus.ACCEPTED,
        courierId,
        matchedCourierId: null,
      })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.findById.mockResolvedValue({
        ...delivery,
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.ACCEPTED,
        cancelledBy: EnumCancelledBy.RESTAURANT,
      } as any)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.CANCELED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
        cancelledBy: EnumCancelledBy.RESTAURANT,
      })

      expect(mockWebsocketDispatcher.sendOfferEnded).not.toHaveBeenCalled()
      expect(mockOfferPushService.offerEnded).not.toHaveBeenCalled()
    })
  })

  describe('settleCancellation when ongoing status has no courierId (row 32 review)', () => {
    it('logs a warning naming the delivery when cancelledFromStatus is ongoing and courierId is null, and awards nothing', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'warn')
      const delivery = makeDelivery({
        id: 'del-no-rider-ongoing',
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.ACCEPTED,
        courierId: null, // ongoing status but no courier!
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)

      await service.settleCancellation('del-no-rider-ongoing')

      // 1. Logs warning naming delivery and cancelledFromStatus
      expect(loggerSpy).toHaveBeenCalledWith(
        'Delivery del-no-rider-ongoing was cancelled from ACCEPTED with no rider: no cancellation pay'
      )

      // 2. Awards nothing
      expect(mockCourierCompensationRepository.createCancellationAwardOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION })
      )
    })
  })

  describe('Decision 32.18: Cancellation payout rule recorded at cancel and used at award (AC-4)', () => {
    it('records the cancellation payout policy in force in updateIfMatches at cancel time', async () => {
      mockConfigDomainService.instanceConfig.getCancellationPayoutPolicy.mockResolvedValue('HALF_COMPENSATION')
      const delivery = makeDelivery({ status: EnumDeliveryStatus.ACCEPTED })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.findById.mockResolvedValue({
        ...delivery,
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.ACCEPTED,
        cancellationPayoutPolicy: 'HALF_COMPENSATION',
      } as any)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.CANCELED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
        cancelledBy: EnumCancelledBy.RESTAURANT,
      })

      // The CANCELED conditional write records cancellationPayoutPolicy equal to the rule read at cancel time
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.ACCEPTED, courierId },
        expect.objectContaining({
          status: EnumDeliveryStatus.CANCELED,
          cancelledBy: EnumCancelledBy.RESTAURANT,
          cancelledFromStatus: EnumDeliveryStatus.ACCEPTED,
          cancellationPayoutPolicy: 'HALF_COMPENSATION',
        })
      )
    })

    it('writes CANCELED with cancellationPayoutPolicy null and logs a warning if getCancellationPayoutPolicy rejects during cancel', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'warn')
      mockConfigDomainService.instanceConfig.getCancellationPayoutPolicy.mockRejectedValue(
        new Error('Failed to read config from database')
      )
      const delivery = makeDelivery({ status: EnumDeliveryStatus.ACCEPTED })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.findById.mockResolvedValue({
        ...delivery,
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.ACCEPTED,
        cancellationPayoutPolicy: null,
      } as any)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.CANCELED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
        cancelledBy: EnumCancelledBy.RESTAURANT,
      })

      // 1. The conditional write still executes CANCELED with cancellationPayoutPolicy null
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.ACCEPTED, courierId },
        expect.objectContaining({
          status: EnumDeliveryStatus.CANCELED,
          cancellationPayoutPolicy: null,
        })
      )

      // 2. The cancellation event is marked successful (not thrown / aborted)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.CANCELED,
          transitionSuccessful: true,
        })
      )

      // 3. A warning naming delivery and error is logged
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not read cancellationPayoutPolicy while cancelling ${deliveryId}`)
      )
    })

    it('awardCancellationPay pays under the recorded key even when the current rule differs, without calling getCancellationPayoutPolicy', async () => {
      // Current rule in instance config is QUARTER_COMPENSATION (25%)
      mockConfigDomainService.instanceConfig.getReassignmentPayoutPolicies.mockResolvedValue({
        FULL_COMPENSATION: 100,
        QUARTER_COMPENSATION: 25,
      })
      mockConfigDomainService.instanceConfig.getCancellationPayoutPolicy.mockResolvedValue('QUARTER_COMPENSATION')

      // Delivery was cancelled when rule was FULL_COMPENSATION (recorded on delivery row)
      const delivery = makeDelivery({
        id: deliveryId,
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.ACCEPTED,
        cancelledBy: EnumCancelledBy.RESTAURANT,
        courierId,
        totalCompensation: 277,
        cancellationPayoutPolicy: 'FULL_COMPENSATION',
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)

      await service.settleCancellation(deliveryId)

      // 1. Must NOT call getCancellationPayoutPolicy because the policy is already recorded
      expect(mockConfigDomainService.instanceConfig.getCancellationPayoutPolicy).not.toHaveBeenCalled()

      // 2. Pays under the recorded key FULL_COMPENSATION: amount 277 (not 277 * 0.25 = 69)
      expect(mockCourierCompensationRepository.createCancellationAwardOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 277,
          policy: 'FULL_COMPENSATION',
          reason: EnumCourierCompensationReason.CANCELLATION,
          courierId,
          deliveryId,
          cancellationOf: deliveryId,
        })
      )

      // 3. COURIER_PAID_FOR_CANCELLATION event records the pay under FULL_COMPENSATION
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION,
          actor: EnumEventActor.SYSTEM,
          courierId,
          message: expect.stringContaining('FULL_COMPENSATION'),
        })
      )
    })

    it('uses the current rule when delivery has cancellationPayoutPolicy null (277 under QUARTER -> 69)', async () => {
      // Menu with FULL (100%) and QUARTER (25%)
      mockConfigDomainService.instanceConfig.getReassignmentPayoutPolicies.mockResolvedValue({
        FULL_COMPENSATION: 100,
        QUARTER_COMPENSATION: 25,
      })
      // Current rule in instance config is QUARTER_COMPENSATION
      mockConfigDomainService.instanceConfig.getCancellationPayoutPolicy.mockResolvedValue('QUARTER_COMPENSATION')

      // Delivery cancelled before column existed or when read failed (cancellationPayoutPolicy is null)
      const delivery = makeDelivery({
        id: deliveryId,
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.ACCEPTED,
        cancelledBy: EnumCancelledBy.RESTAURANT,
        courierId,
        totalCompensation: 277,
        cancellationPayoutPolicy: null,
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)

      await service.settleCancellation(deliveryId)

      // 1. Reads current rule from getCancellationPayoutPolicy
      expect(mockConfigDomainService.instanceConfig.getCancellationPayoutPolicy).toHaveBeenCalledTimes(1)

      // 2. Pays under QUARTER_COMPENSATION: round(277 * 25 / 100) = 69
      expect(mockCourierCompensationRepository.createCancellationAwardOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 69,
          policy: 'QUARTER_COMPENSATION',
          reason: EnumCourierCompensationReason.CANCELLATION,
          courierId,
          deliveryId,
        })
      )

      // 3. Paid event message contains QUARTER_COMPENSATION and 69
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION,
          courierId,
          message: expect.stringMatching(/QUARTER_COMPENSATION.*69|69.*QUARTER_COMPENSATION/),
        })
      )
    })

    it('degrades to FULL_COMPENSATION with a warning when recorded policy key is no longer on the menu', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'warn')

      // Current menu no longer has OBSOLETE_POLICY
      mockConfigDomainService.instanceConfig.getReassignmentPayoutPolicies.mockResolvedValue({
        FULL_COMPENSATION: 100,
        QUARTER_COMPENSATION: 25,
      })

      // Delivery recorded OBSOLETE_POLICY at cancel time
      const delivery = makeDelivery({
        id: deliveryId,
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.ACCEPTED,
        cancelledBy: EnumCancelledBy.RESTAURANT,
        courierId,
        totalCompensation: 277,
        cancellationPayoutPolicy: 'OBSOLETE_POLICY',
      })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)

      await service.settleCancellation(deliveryId)

      // 1. Logs warning naming the off-menu policy fallback to FULL_COMPENSATION
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Cancellation pay for delivery del-cancel-spec15: cancellationPayoutPolicy 'OBSOLETE_POLICY' is not a usable key of reassignmentPayoutPolicies; paid under 'FULL_COMPENSATION' instead"
        )
      )

      // 2. Pays under fallback FULL_COMPENSATION (amount 277)
      expect(mockCourierCompensationRepository.createCancellationAwardOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 277,
          policy: 'FULL_COMPENSATION',
          courierId,
          deliveryId,
        })
      )

      // 3. Event recorded with fallback policy
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION,
          courierId,
          message: expect.stringContaining('FULL_COMPENSATION'),
        })
      )
    })
  })
})
