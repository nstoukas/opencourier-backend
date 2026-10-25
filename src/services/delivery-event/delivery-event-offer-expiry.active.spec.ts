import { ConfigService } from '@nestjs/config'
import {
  EnumCourierStatus,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
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
import {
  DeliveryCreatedEvent,
  DeliveryOfferExpiredEvent,
  DeliveryReassignedEvent,
  DeliveryRejectedEvent,
} from 'src/shared-types'
import { REJECTED_LIST_TTL_SECONDS } from '../cache/rejected-couriers'

describe('DeliveryEventService - Offer Expiry (Spec 0002)', () => {
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

  const defaultCalculationAmounts = {
    totalCost: 1000,
    totalCompensation: 800,
    fee: 200,
    feePercentage: 20,
  }

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
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'courier-1', userId: 'user-courier-1' } as any),
      findById: jest.fn().mockResolvedValue({ id: 'courier-1', userId: 'user-courier-1' } as any),
      updateById: jest.fn().mockResolvedValue({} as any),
      findNamesByIds: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<CourierRepository>

    mockDeliveryRepository = {
      findByIdOrThrow: jest.fn(),
      findById: jest.fn(),
      update: jest.fn().mockImplementation((id, data) => Promise.resolve({ id, ...data })),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      findOpenOffersForCourier: jest.fn().mockResolvedValue([]),
      findIdsWaitingForCourierOldestFirst: jest.fn().mockResolvedValue([]),
      findLatestNoCourierAvailableAt: jest.fn().mockResolvedValue(new Map()),
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
      findCourierForDelivery: jest.fn(),
      matchDeliveryToCourier: jest.fn(),
    } as unknown as jest.Mocked<DeliveryMatchingService>

    mockDeliveryCalculationService = {
      calculateDeliveryAmountsForMatchedCourier: jest.fn().mockResolvedValue(defaultCalculationAmounts),
    } as unknown as jest.Mocked<DeliveryCalculationService>

    mockBullMQService = {
      addJob: jest.fn().mockResolvedValue(undefined),
      removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<BullMQService>

    mockConfigDomainService = {
      instanceConfig: {
        getOfferExpiryEnabled: jest.fn().mockResolvedValue(true),
        getOfferExpirySeconds: jest.fn().mockResolvedValue(20),
        getNoCourierRetrySeconds: jest.fn().mockResolvedValue(30),
      },
    }

    mockCacheService = {
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CacheService>

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
      mockCacheService
    )
  })

  describe('Task registration on startup', () => {
    it('registers handlers for offer-expiry and no-courier-retry tasks', () => {
      expect(mockTaskBusService.registerTaskHandler).toHaveBeenCalledWith('offer-expiry', expect.any(Function))
      expect(mockTaskBusService.registerTaskHandler).toHaveBeenCalledWith('no-courier-retry', expect.any(Function))
    })
  })

  describe('1. Offer step (AC-1, AC-2)', () => {
    it('with expiry ON (20s): calculates amounts, updates delivery in ONE updateIfMatches, saves OFFERED (SYSTEM, courierId), and schedules offer-expiry job', async () => {
      const deliveryId = 'del-offer-1'
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.CREATED,
        matchedCourierId: null,
        courierId: null,
        partnerId: 'partner-1',
      } as any)

      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier: { id: 'courier-1', userId: 'user-courier-1' } as any,
        delivery: {} as any,
      })

      const createdEvent: DeliveryCreatedEvent = {
        deliveryId,
        type: EnumDeliveryEventType.CREATED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
      }

      await service.processDeliveryEvent(createdEvent)

      // 1. Amounts were calculated for matched courier BEFORE offer is written
      expect(mockDeliveryCalculationService.calculateDeliveryAmountsForMatchedCourier).toHaveBeenCalledWith({
        deliveryId,
        courierId: 'courier-1',
      })

      // In the happy path the only write that sets matchedCourierId is the single updateIfMatches call
      // made after calculateDeliveryAmountsForMatchedCourier resolved (mock invocationCallOrder)
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledTimes(1)
      const calcCallOrder =
        mockDeliveryCalculationService.calculateDeliveryAmountsForMatchedCourier.mock.invocationCallOrder[0]
      const updateIfMatchesCallOrder = mockDeliveryRepository.updateIfMatches.mock.invocationCallOrder[0]
      expect(calcCallOrder).toBeDefined()
      expect(updateIfMatchesCallOrder).toBeDefined()
      expect(calcCallOrder!).toBeLessThan(updateIfMatchesCallOrder!)

      // No repository write of any kind via deliveryRepository.update sets matchedCourierId, offeredAt or offerExpiresAt
      expect(mockDeliveryRepository.update).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ matchedCourierId: expect.anything() })
      )
      expect(mockDeliveryRepository.update).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ offeredAt: expect.anything() })
      )
      expect(mockDeliveryRepository.update).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ offerExpiresAt: expect.anything() })
      )
      for (const [, data] of mockDeliveryRepository.update.mock.calls) {
        expect(data).not.toHaveProperty('matchedCourierId')
        expect(data).not.toHaveProperty('offeredAt')
        expect(data).not.toHaveProperty('offerExpiresAt')
      }

      // 2. updateIfMatches is called once with conditional check and offer fields
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: null,
          courierId: null,
        },
        expect.objectContaining({
          matchedCourierId: 'courier-1',
          offeredAt: expect.any(Date),
          offerExpiresAt: expect.any(Date),
          totalCost: 1000,
          totalCompensation: 800,
          fee: 200,
          feePercentage: 20,
        })
      )

      // Verify offerExpiresAt is approximately offeredAt + 20 seconds
      const updateData = mockDeliveryRepository.updateIfMatches.mock.calls[0]![2] as any
      const diffMs = updateData.offerExpiresAt.getTime() - updateData.offeredAt.getTime()
      expect(diffMs).toBe(20 * 1000)

      // 3. OFFERED event is saved with actor SYSTEM, courierId
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.OFFERED,
          actor: EnumEventActor.SYSTEM,
          courierId: 'courier-1',
          eventSource: EnumDeliveryEventSource.OPENCOURIER,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          message: expect.stringContaining('answer by'),
        })
      )

      // 4. Delayed BullMQ job is enqueued with delay (20 + 3) * 1000 = 23000 ms and custom jobId
      const expectedJobId = `offer-expiry-${deliveryId}-${updateData.offeredAt.getTime()}`
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'offer-expiry',
        {
          deliveryId,
          courierId: 'courier-1',
          offeredAt: updateData.offeredAt.toISOString(),
        },
        {
          delay: 23 * 1000,
          jobId: expectedJobId,
        }
      )

      // 5. Backstop retry is removed when offer is made
      expect(mockBullMQService.removeDelayedJobsWithIdPrefix).toHaveBeenCalledWith(`no-courier-retry-${deliveryId}-`)

      // 6. Socket offer is sent to courier
      expect(mockWebsocketDispatcher.sendOfferToCourier).toHaveBeenCalledWith('user-courier-1', expect.any(Object))
    })

    it('with expiry OFF: sets offerExpiresAt to null, saves OFFERED with "no deadline", and schedules NO expiry job', async () => {
      mockConfigDomainService.instanceConfig.getOfferExpiryEnabled.mockResolvedValue(false)
      const deliveryId = 'del-offer-no-expiry'

      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.CREATED,
        matchedCourierId: null,
        courierId: null,
        partnerId: 'partner-1',
      } as any)

      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier: { id: 'courier-2', userId: 'user-courier-2' } as any,
        delivery: {} as any,
      })

      const createdEvent: DeliveryCreatedEvent = {
        deliveryId,
        type: EnumDeliveryEventType.CREATED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
      }

      await service.processDeliveryEvent(createdEvent)

      // In expiry OFF mode, only updateIfMatches writes matchedCourierId; update never sets offer fields
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledTimes(1)
      expect(mockDeliveryRepository.update).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ matchedCourierId: expect.anything() })
      )
      for (const [, data] of mockDeliveryRepository.update.mock.calls) {
        expect(data).not.toHaveProperty('matchedCourierId')
        expect(data).not.toHaveProperty('offeredAt')
        expect(data).not.toHaveProperty('offerExpiresAt')
      }

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        expect.anything(),
        expect.objectContaining({
          matchedCourierId: 'courier-2',
          offeredAt: expect.any(Date),
          offerExpiresAt: null,
        })
      )

      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.OFFERED,
          courierId: 'courier-2',
          message: 'Offered to courier courier-2, no deadline',
        })
      )

      // No offer-expiry job should be scheduled
      expect(mockBullMQService.addJob).not.toHaveBeenCalledWith('offer-expiry', expect.anything(), expect.anything())
    })

    it('does not write offer or schedule expiry job if amounts calculation fails', async () => {
      const deliveryId = 'del-calc-fail'
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.CREATED,
        matchedCourierId: null,
        courierId: null,
      } as any)

      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier: { id: 'courier-1', userId: 'user-courier-1' } as any,
        delivery: {} as any,
      })
      mockDeliveryCalculationService.calculateDeliveryAmountsForMatchedCourier.mockRejectedValueOnce(
        new Error('OSRM routing failure')
      )

      const createdEvent: DeliveryCreatedEvent = {
        deliveryId,
        type: EnumDeliveryEventType.CREATED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
      }

      await service.processDeliveryEvent(createdEvent)

      // Offer fields are NOT updated: NO repository write of any kind sets matchedCourierId, offeredAt or offerExpiresAt
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.update).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ matchedCourierId: expect.anything() })
      )
      expect(mockDeliveryRepository.update).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ offeredAt: expect.anything() })
      )
      expect(mockDeliveryRepository.update).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ offerExpiresAt: expect.anything() })
      )
      for (const [, data] of mockDeliveryRepository.update.mock.calls) {
        expect(data).not.toHaveProperty('matchedCourierId')
        expect(data).not.toHaveProperty('offeredAt')
        expect(data).not.toHaveProperty('offerExpiresAt')
      }
      for (const [, , data] of mockDeliveryRepository.updateIfMatches.mock.calls) {
        expect(data).not.toHaveProperty('matchedCourierId')
        expect(data).not.toHaveProperty('offeredAt')
        expect(data).not.toHaveProperty('offerExpiresAt')
      }

      // Expiry job is NOT enqueued
      expect(mockBullMQService.addJob).not.toHaveBeenCalledWith('offer-expiry', expect.anything(), expect.anything())
      // OFFERED event is NOT saved
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.OFFERED })
      )
      // Retry job is scheduled instead so delivery does not get stuck
      expect(mockBullMQService.addJob).toHaveBeenCalledWith('no-courier-retry', expect.anything(), expect.anything())
    })

    it('does not save OFFERED or schedule expiry job if updateIfMatches returns false (claimed meanwhile)', async () => {
      const deliveryId = 'del-raced-claim'
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.CREATED,
        matchedCourierId: null,
        courierId: null,
      } as any)

      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier: { id: 'courier-1', userId: 'user-courier-1' } as any,
        delivery: {} as any,
      })
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(false)

      const createdEvent: DeliveryCreatedEvent = {
        deliveryId,
        type: EnumDeliveryEventType.CREATED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
      }

      await service.processDeliveryEvent(createdEvent)

      expect(mockBullMQService.addJob).not.toHaveBeenCalledWith('offer-expiry', expect.anything(), expect.anything())
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.OFFERED })
      )
    })
  })

  describe('2. Expiry job (AC-1, AC-5)', () => {
    it('ends the offer when still the same offer: clears offer fields, adds to skip list, sends OFFER_ENDED, emits OFFER_EXPIRED, and matches next courier', async () => {
      const deliveryId = 'del-expiry-run'
      const courierId = 'courier-1'
      const offeredAt = new Date(Date.now() - 25000)
      const offerExpiresAt = new Date(offeredAt.getTime() + 20000) // expired 5s ago

      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt,
        offerExpiresAt,
      } as any)

      // Subsequent lookup for processDeliveryEvent
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      } as any)

      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(true)

      await service.handleOfferExpiryJob({
        deliveryId,
        courierId,
        offeredAt: offeredAt.toISOString(),
      })

      // 1. Conditional update clears offer fields and verifies offerExpiresAt <= now
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: courierId,
          offeredAt,
          courierId: null,
          offerExpiresAt: { lte: expect.any(Date) },
        },
        {
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
        }
      )

      // 2. Rider added to skip list (20 min TTL)
      expect(mockCacheService.save).toHaveBeenCalledWith(
        expect.stringContaining(deliveryId),
        [courierId],
        REJECTED_LIST_TTL_SECONDS
      )

      // 3. Socket OFFER_ENDED sent with reason 'EXPIRED'
      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith('user-courier-1', {
        deliveryId,
        reason: 'EXPIRED',
      })

      // 4. OFFER_EXPIRED event is recorded (SYSTEM actor, courierId, message)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          actor: EnumEventActor.SYSTEM,
          courierId,
          message: 'Offer expired after 20 s',
        })
      )

      // 5. Matching runs again for the next courier
      expect(mockDeliveryMatchingService.findCourierForDelivery).toHaveBeenCalledWith(deliveryId)
    })

    it('stale job does nothing when updateIfMatches returns false (already answered, re-offered, cancelled)', async () => {
      const deliveryId = 'del-expiry-stale'
      const courierId = 'courier-1'
      const offeredAt = new Date(Date.now() - 25000)
      const offerExpiresAt = new Date(offeredAt.getTime() + 20000)

      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-2', // re-offered to someone else!
        offeredAt,
        offerExpiresAt,
      } as any)

      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(false)

      await service.handleOfferExpiryJob({
        deliveryId,
        courierId,
        offeredAt: offeredAt.toISOString(),
      })

      // No skip list add
      expect(mockCacheService.save).not.toHaveBeenCalled()
      // No OFFER_ENDED socket notification
      expect(mockWebsocketDispatcher.sendOfferEnded).not.toHaveBeenCalled()
      // No OFFER_EXPIRED event emitted
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.OFFER_EXPIRED })
      )
      // Matching is not re-triggered
      expect(mockDeliveryMatchingService.findCourierForDelivery).not.toHaveBeenCalled()
    })

    it('returns early and does nothing if offeredAt in payload is invalid', async () => {
      await service.handleOfferExpiryJob({
        deliveryId: 'del-bad-date',
        courierId: 'courier-1',
        offeredAt: 'not-a-valid-date',
      })

      expect(mockDeliveryRepository.findById).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
    })

    it('returns early if delivery has no offerExpiresAt (such as an admin offer)', async () => {
      mockDeliveryRepository.findById.mockResolvedValue({
        id: 'del-no-deadline',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-1',
        offeredAt: new Date(),
        offerExpiresAt: null, // admin offer has null deadline!
      } as any)

      await service.handleOfferExpiryJob({
        deliveryId: 'del-no-deadline',
        courierId: 'courier-1',
        offeredAt: new Date().toISOString(),
      })

      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
    })
  })

  describe('3. Admin offer and REASSIGNED with expiry ON (AC-2, AC-3)', () => {
    it('offerDeliveryToCourierAsAdmin: sets offerExpiresAt null, saves CONFIRMED and OFFERED (actor ADMIN), removes backstop, and never schedules expiry job', async () => {
      const deliveryId = 'del-admin-offer'
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.CREATED,
        partnerId: 'partner-1',
        courierId: null,
        matchedCourierId: null,
      } as any)

      await service.offerDeliveryToCourierAsAdmin(deliveryId, 'courier-1', 'Priority assignment')

      // 1. Delivery update has offerExpiresAt: null
      expect(mockDeliveryRepository.update).toHaveBeenCalledWith(
        deliveryId,
        expect.objectContaining({
          matchedCourierId: 'courier-1',
          offeredAt: expect.any(Date),
          offerExpiresAt: null,
        })
      )

      // 2. CONFIRMED audit event saved
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.CONFIRMED,
          actor: EnumEventActor.ADMIN,
          message: 'Admin offered delivery to courier courier-1: Priority assignment',
        })
      )

      // 3. OFFERED event saved with actor ADMIN, courierId, and no deadline message
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.OFFERED,
          actor: EnumEventActor.ADMIN,
          courierId: 'courier-1',
          message: 'Offered to courier courier-1, no deadline',
        })
      )

      // 4. Backstop retry removed
      expect(mockBullMQService.removeDelayedJobsWithIdPrefix).toHaveBeenCalledWith(`no-courier-retry-${deliveryId}-`)

      // 5. Never schedules an offer-expiry job
      expect(mockBullMQService.addJob).not.toHaveBeenCalledWith('offer-expiry', expect.anything(), expect.anything())
    })

    it('REASSIGNED event: sets offerExpiresAt null, saves OFFERED (actor ADMIN), and never schedules expiry job', async () => {
      const deliveryId = 'del-reassigned'
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.DISPATCHED,
        courierId: 'courier-old',
        partnerId: 'partner-1',
      } as any)

      const reassignedEvent: DeliveryReassignedEvent = {
        deliveryId,
        type: EnumDeliveryEventType.REASSIGNED,
        actor: EnumEventActor.ADMIN,
        courierId: 'courier-new',
        source: EnumDeliveryEventSource.OPENCOURIER,
      }

      await service.processDeliveryEvent(reassignedEvent)

      // 1. Delivery update sets matchedCourierId and offerExpiresAt: null
      expect(mockDeliveryRepository.update).toHaveBeenCalledWith(
        deliveryId,
        expect.objectContaining({
          courierId: null,
          matchedCourierId: 'courier-new',
          offeredAt: expect.any(Date),
          offerExpiresAt: null,
        })
      )

      // 2. Saves OFFERED event with actor ADMIN
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.OFFERED,
          actor: EnumEventActor.ADMIN,
          courierId: 'courier-new',
          message: 'Offered to courier courier-new, no deadline',
        })
      )

      // 3. No offer-expiry job enqueued
      expect(mockBullMQService.addJob).not.toHaveBeenCalledWith('offer-expiry', expect.anything(), expect.anything())
    })
  })

  describe('4. Courier status changes & offline hook (AC-6)', () => {
    it('handleCourierStatusChanged: OFFLINE calls endOpenOffersForCourier; ONLINE calls matchWaitingDeliveries', async () => {
      const courierId = 'courier-status-test'
      const endOpenOffersSpy = jest.spyOn(service, 'endOpenOffersForCourier').mockResolvedValue(undefined)
      const matchWaitingSpy = jest.spyOn(service, 'matchWaitingDeliveries').mockResolvedValue(undefined)

      // OFFLINE status
      await service.handleCourierStatusChanged(courierId, EnumCourierStatus.OFFLINE)
      expect(endOpenOffersSpy).toHaveBeenCalledWith(courierId)
      expect(matchWaitingSpy).not.toHaveBeenCalled()

      endOpenOffersSpy.mockClear()
      matchWaitingSpy.mockClear()

      // ONLINE status
      await service.handleCourierStatusChanged(courierId, EnumCourierStatus.ONLINE)
      expect(matchWaitingSpy).toHaveBeenCalled()
      expect(endOpenOffersSpy).not.toHaveBeenCalled()
    })

    it('endOpenOffersForCourier: ends every open offer (auto or admin) with OFFER_EXPIRED ("Rider went offline") and OFFER_ENDED reason OFFLINE', async () => {
      const courierId = 'courier-offline'
      const openOffers = [
        { id: 'del-open-1', offeredAt: new Date(Date.now() - 5000), offerExpiresAt: new Date(Date.now() + 15000) },
        { id: 'del-open-admin', offeredAt: new Date(Date.now() - 3000), offerExpiresAt: null }, // admin offer!
      ]

      mockDeliveryRepository.findOpenOffersForCourier.mockResolvedValue(openOffers as any)
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      } as any)

      await service.endOpenOffersForCourier(courierId)

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledTimes(2)

      // Verify the where clause for reason OFFLINE does NOT require offerExpiresAt <= now
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-open-admin',
        {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: courierId,
          offeredAt: openOffers[1]!.offeredAt,
          courierId: null,
        },
        {
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
        }
      )

      // Both get OFFER_ENDED with reason 'OFFLINE'
      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith('user-courier-1', {
        deliveryId: 'del-open-1',
        reason: 'OFFLINE',
      })
      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith('user-courier-1', {
        deliveryId: 'del-open-admin',
        reason: 'OFFLINE',
      })

      // Both record OFFER_EXPIRED with message "Rider went offline"
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-open-1',
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          actor: EnumEventActor.SYSTEM,
          courierId,
          message: 'Rider went offline',
        })
      )
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-open-admin',
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          actor: EnumEventActor.SYSTEM,
          courierId,
          message: 'Rider went offline',
        })
      )
    })

    it('ACCEPTED case with courier status LAST_CALL: updates courier to OFFLINE and ends their other open offers', async () => {
      const deliveryId = 'del-accepted-lastcall'
      const courierId = 'courier-last-call'

      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        courierId: null,
      } as any)

      mockCourierRepository.findByIdOrThrow.mockResolvedValue({
        id: courierId,
        status: EnumCourierStatus.LAST_CALL,
      } as any)

      const endOpenOffersSpy = jest.spyOn(service, 'endOpenOffersForCourier').mockResolvedValue(undefined)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
      })

      // Courier status updated to OFFLINE
      expect(mockCourierRepository.updateById).toHaveBeenCalledWith(courierId, {
        status: EnumCourierStatus.OFFLINE,
      })

      // Other open offers ended
      expect(endOpenOffersSpy).toHaveBeenCalledWith(courierId)
    })
  })

  describe('5. Nobody free & Backstop retries (AC-7)', () => {
    it('when matching finds nobody: saves triggering event, writes NO_COURIER_AVAILABLE once, and schedules backstop retry with prefix removal', async () => {
      const deliveryId = 'del-nobody-1'
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      } as any)

      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValue(undefined)
      mockDeliveryEventRepository.findLatestOfTypes.mockResolvedValue(null) // No prior NO_COURIER_AVAILABLE

      const rejectedEvent: DeliveryRejectedEvent = {
        deliveryId,
        type: EnumDeliveryEventType.REJECTED,
        actor: EnumEventActor.COURIER,
        courierId: 'courier-1',
        source: EnumDeliveryEventSource.OPENCOURIER,
      }

      await service.processDeliveryEvent(rejectedEvent)

      // 1. Triggering REJECTED event is saved
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.REJECTED,
        })
      )

      // 2. NO_COURIER_AVAILABLE is saved with actor SYSTEM
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.NO_COURIER_AVAILABLE,
          actor: EnumEventActor.SYSTEM,
          message: 'No rider free; the delivery waits and is matched again when one is',
        })
      )

      // 3. Pending retries with prefix removed before adding new one
      expect(mockBullMQService.removeDelayedJobsWithIdPrefix).toHaveBeenCalledWith(`no-courier-retry-${deliveryId}-`)

      // 4. Backstop retry is enqueued with delay 30s
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'no-courier-retry',
        { deliveryId },
        expect.objectContaining({
          delay: 30 * 1000,
          jobId: expect.stringMatching(new RegExp(`^no-courier-retry-${deliveryId}-\\d+$`)),
        })
      )
    })

    it('does NOT write duplicate NO_COURIER_AVAILABLE if latest event is already NO_COURIER_AVAILABLE', async () => {
      const deliveryId = 'del-nobody-duplicate'
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      } as any)

      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValue(undefined)
      // Latest event of OFFERED / NO_COURIER_AVAILABLE is already NO_COURIER_AVAILABLE
      mockDeliveryEventRepository.findLatestOfTypes.mockResolvedValue({
        type: EnumDeliveryEventType.NO_COURIER_AVAILABLE,
      } as any)

      const expiredEvent: DeliveryOfferExpiredEvent = {
        deliveryId,
        type: EnumDeliveryEventType.OFFER_EXPIRED,
        actor: EnumEventActor.SYSTEM,
        courierId: 'courier-1',
        source: EnumDeliveryEventSource.OPENCOURIER,
      }

      await service.processDeliveryEvent(expiredEvent)

      // Triggering event is saved
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.OFFER_EXPIRED })
      )

      // NO_COURIER_AVAILABLE is NOT saved again
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.NO_COURIER_AVAILABLE })
      )

      // But retry timer IS scheduled
      expect(mockBullMQService.addJob).toHaveBeenCalledWith('no-courier-retry', { deliveryId }, expect.anything())
    })

    it('handleNoCourierRetryJob: acts only when status is ASSIGNING_COURIER with no matched courier; schedules next retry with no new event if still nobody', async () => {
      const deliveryId = 'del-retry-run'
      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      } as any)

      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValue(undefined)

      await service.handleNoCourierRetryJob({ deliveryId })

      // Matching was attempted
      expect(mockDeliveryMatchingService.findCourierForDelivery).toHaveBeenCalledWith(deliveryId)

      // No new event was saved
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalled()

      // Next retry job was scheduled
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'no-courier-retry',
        { deliveryId },
        expect.objectContaining({ delay: 30 * 1000 })
      )
    })

    it('handleNoCourierRetryJob does nothing if delivery has been offered, taken, or ended meanwhile', async () => {
      mockDeliveryRepository.findById.mockResolvedValue({
        id: 'del-retry-stopped',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-1', // offered to someone meanwhile
        courierId: null,
      } as any)

      await service.handleNoCourierRetryJob({ deliveryId: 'del-retry-stopped' })

      expect(mockDeliveryMatchingService.findCourierForDelivery).not.toHaveBeenCalled()
      expect(mockBullMQService.addJob).not.toHaveBeenCalled()
    })

    it('matchWaitingDeliveries: matches waiting deliveries oldest first and stops at the first that finds nobody', async () => {
      mockDeliveryRepository.findIdsWaitingForCourierOldestFirst.mockResolvedValue(['del-oldest', 'del-middle', 'del-newest'])

      // del-oldest finds nobody
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce(undefined)

      await service.matchWaitingDeliveries()

      // Checked del-oldest
      expect(mockDeliveryMatchingService.findCourierForDelivery).toHaveBeenCalledWith('del-oldest')
      // Did NOT continue to del-middle or del-newest because del-oldest found nobody
      expect(mockDeliveryMatchingService.findCourierForDelivery).not.toHaveBeenCalledWith('del-middle')
      expect(mockDeliveryMatchingService.findCourierForDelivery).not.toHaveBeenCalledWith('del-newest')
    })

    it('DROPPED_OFF with courierId calls matchWaitingDeliveries', async () => {
      const matchWaitingSpy = jest.spyOn(service, 'matchWaitingDeliveries').mockResolvedValue(undefined)

      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-dropped-off',
        status: EnumDeliveryStatus.ON_THE_WAY,
        courierId: 'courier-1',
      } as any)

      await service.processDeliveryEvent({
        deliveryId: 'del-dropped-off',
        type: EnumDeliveryEventType.DROPPED_OFF,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        deliveredData: {},
      })

      expect(matchWaitingSpy).toHaveBeenCalled()
    })

    it('CANCELED from ASSIGNING_COURIER: clears offer fields and removes pending backstop retry', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-cancel-wait',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-1',
        courierId: null,
      } as any)

      await service.processDeliveryEvent({
        deliveryId: 'del-cancel-wait',
        type: EnumDeliveryEventType.CANCELED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
      })

      // Updates status to CANCELED and clears offer fields
      expect(mockDeliveryRepository.update).toHaveBeenCalledWith(
        'del-cancel-wait',
        expect.objectContaining({
          status: EnumDeliveryStatus.CANCELED,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
        })
      )

      // Backstop removed
      expect(mockBullMQService.removeDelayedJobsWithIdPrefix).toHaveBeenCalledWith('no-courier-retry-del-cancel-wait-')
    })
  })

  describe('6. AC-8: Server never accepts for a rider', () => {
    it('ensures no automated server code path (expiry, retry, offline) ever emits ACCEPTED with actor SYSTEM', async () => {
      // 1. Expiry job
      mockDeliveryRepository.findById.mockResolvedValue({
        id: 'del-test-ac8',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-1',
        offeredAt: new Date(Date.now() - 30000),
        offerExpiresAt: new Date(Date.now() - 10000),
      } as any)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-test-ac8',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      } as any)

      await service.handleOfferExpiryJob({
        deliveryId: 'del-test-ac8',
        courierId: 'courier-1',
        offeredAt: new Date(Date.now() - 30000).toISOString(),
      })

      // 2. Retry job
      await service.handleNoCourierRetryJob({ deliveryId: 'del-test-ac8' })

      // 3. Offline hook
      await service.handleCourierStatusChanged('courier-1', EnumCourierStatus.OFFLINE)

      // Inspect every create call on mockDeliveryEventRepository
      const createCalls = mockDeliveryEventRepository.create.mock.calls
      for (const [arg] of createCalls) {
        if (arg.type === EnumDeliveryEventType.ACCEPTED) {
          expect(arg.actor).not.toBe(EnumEventActor.SYSTEM)
        }
      }
    })
  })

  describe('7. Matching trigger filtering (Requirement 11)', () => {
    it('processDeliveryEvent drops OFFERED and NO_COURIER_AVAILABLE without triggering matching', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-no-trigger',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      } as any)

      // 1. Send OFFERED through processDeliveryEvent
      await service.processDeliveryEvent({
        deliveryId: 'del-no-trigger',
        type: EnumDeliveryEventType.OFFERED,
        actor: EnumEventActor.SYSTEM,
        courierId: 'courier-1',
        source: EnumDeliveryEventSource.OPENCOURIER,
      })

      // 2. Send NO_COURIER_AVAILABLE through processDeliveryEvent
      await service.processDeliveryEvent({
        deliveryId: 'del-no-trigger',
        type: EnumDeliveryEventType.NO_COURIER_AVAILABLE,
        actor: EnumEventActor.SYSTEM,
        source: EnumDeliveryEventSource.OPENCOURIER,
      })

      // Neither should have started matching
      expect(mockDeliveryMatchingService.findCourierForDelivery).not.toHaveBeenCalled()
      // Neither should have updated the delivery
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
    })
  })
})
