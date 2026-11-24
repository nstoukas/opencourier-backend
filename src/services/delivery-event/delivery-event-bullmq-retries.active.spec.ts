import { ConfigService } from '@nestjs/config'
import {
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumDispatchStopReason,
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
import { CacheService } from '../cache/cache.service'
import { OfferPushService } from '../pushNotification/offer-push.service'
import { eventText } from 'src/domains/delivery-event/event-text'

describe('DeliveryEventService - BullMQ Retries & Idempotence (Row 141)', () => {
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

  beforeEach(() => {
    mockConfigService = { get: jest.fn() } as unknown as jest.Mocked<ConfigService>
    mockWebsocketDispatcher = {
      sendOfferToCourier: jest.fn().mockResolvedValue(undefined),
      sendOfferEnded: jest.fn().mockResolvedValue(undefined),
      dispatchDeliveryStatusUpdated: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WebsocketDispatcher>
    mockCourierRepository = {
      findById: jest.fn().mockResolvedValue({ id: 'courier-1', userId: 'user-c-1' } as any),
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'courier-1', userId: 'user-c-1' } as any),
      updateById: jest.fn().mockResolvedValue({} as any),
      findOpenOffersForCourier: jest.fn().mockResolvedValue([]),
      hasActiveSos: jest.fn().mockResolvedValue(false),
      clearLocationIfOfflineAndFree: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CourierRepository>
    mockDeliveryRepository = {
      findById: jest.fn(),
      findByIdOrThrow: jest.fn().mockImplementation(async (id: string) => mockDeliveryRepository.findById(id)),
      update: jest.fn(),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      claimOfferWithinBox: jest.fn().mockResolvedValue('CLAIMED'),
      claimForRiderWithinBox: jest.fn().mockResolvedValue({ outcome: 'CLAIMED', heldUnits: 0, deliveryUnits: 50 }),
      findIdsWaitingForCourierOldestFirst: jest.fn().mockResolvedValue([]),
      findOpenGroupMembers: jest.fn().mockResolvedValue([]),
      findAllOpenOffers: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<DeliveryRepository>
    mockDeliveryEventRepository = {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' } as any),
      findLatestOfTypes: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<DeliveryEventRepository>
    mockTaskScheduler = { scheduleTask: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<TaskBusScheduler>
    mockTaskBusService = { registerTaskHandler: jest.fn() } as unknown as jest.Mocked<TaskBusService>
    mockPartnerWebhookService = {
      sendDeliveryUpdatePartnerWebhook: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PartnerWebhookService>
    mockDeliveryMatchingService = {
      findCourierForDelivery: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeliveryMatchingService>
    mockDeliveryCalculationService = {
      calculateDeliveryAmountsForMatchedCourier: jest.fn().mockResolvedValue({
        totalCost: 1000,
        totalCompensation: 800,
        fee: 200,
        feePercentage: 20,
      } as any),
    } as unknown as jest.Mocked<DeliveryCalculationService>
    mockBullMQService = {
      addJob: jest.fn().mockResolvedValue({ id: 'job-1' } as any),
      removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<BullMQService>
    mockConfigDomainService = {
      instanceConfig: {
        getOfferExpiryEnabled: jest.fn().mockResolvedValue(true),
        getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
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
      mockCacheService,
      { newOffer: jest.fn(), offerEnded: jest.fn() } as unknown as OfferPushService,
      { findOn: jest.fn().mockResolvedValue(null) } as any,
      { getRoute: jest.fn() } as any,
      {} as any,
      {} as any,
      { closeOpenForDelivery: jest.fn().mockResolvedValue(undefined) } as any
    )
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('handleOfferExpiryJob run twice for the same payload (Row 141)', () => {
    it('ends the offer once: one conditional write succeeds and one OFFER_EXPIRED event is recorded', async () => {
      const deliveryId = 'del-single-expiry'
      const courierId = 'courier-1'
      const offeredAt = new Date('2026-11-24T00:00:00.000Z')
      const offerExpiresAt = new Date('2026-11-24T00:00:20.000Z')

      const payload = {
        deliveryId,
        courierId,
        offeredAt: offeredAt.toISOString(),
      }

      const deliveryState: any = {
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        courierId: null,
        offeredAt,
        offerExpiresAt,
        offerGroupId: null,
      }

      mockDeliveryRepository.findById.mockImplementation(async (id: string) => {
        if (id === deliveryId) return deliveryState
        return null
      })

      mockDeliveryRepository.updateIfMatches.mockImplementation(async (id: string, where: any, data: any) => {
        if (id === deliveryId) {
          if (where.matchedCourierId === courierId && deliveryState.matchedCourierId === courierId) {
            Object.assign(deliveryState, data)
            return true
          }
          if (where.status && deliveryState.status === where.status) {
            Object.assign(deliveryState, data)
            return true
          }
        }
        return false
      })

      // Run 1: first attempt ends the offer
      await service.handleOfferExpiryJob(payload)

      // The offer-clearing conditional update was called once and OFFER_EXPIRED event created once
      const offerClearCallsRun1 = mockDeliveryRepository.updateIfMatches.mock.calls.filter(
        (call) => call[0] === deliveryId && call[2]?.matchedCourierId === null
      )
      expect(offerClearCallsRun1).toHaveLength(1)

      const expiredEventsRun1 = mockDeliveryEventRepository.create.mock.calls.filter(
        (call) => call[0].deliveryId === deliveryId && call[0].type === EnumDeliveryEventType.OFFER_EXPIRED
      )
      expect(expiredEventsRun1).toHaveLength(1)
      expect(expiredEventsRun1[0]![0]).toEqual(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          actor: EnumEventActor.SYSTEM,
          courierId,
        })
      )

      // Run 2: same payload re-executed (e.g. BullMQ retry after client disconnect)
      await service.handleOfferExpiryJob(payload)

      // Across both runs: the offer was cleared only once, and only one OFFER_EXPIRED event exists
      const offerClearCallsTotal = mockDeliveryRepository.updateIfMatches.mock.calls.filter(
        (call) => call[0] === deliveryId && call[2]?.matchedCourierId === null
      )
      expect(offerClearCallsTotal).toHaveLength(1)

      const expiredEventsTotal = mockDeliveryEventRepository.create.mock.calls.filter(
        (call) => call[0].deliveryId === deliveryId && call[0].type === EnumDeliveryEventType.OFFER_EXPIRED
      )
      expect(expiredEventsTotal).toHaveLength(1)
    })
  })

  describe('handleNoCourierRetryJob run twice (Row 141)', () => {
    it('after the delivery was offered, running retry again does nothing', async () => {
      const deliveryId = 'del-retry-test'

      const deliveryState: any = {
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      }

      mockDeliveryRepository.findById.mockImplementation(async (id: string) => {
        if (id === deliveryId) return deliveryState
        return null
      })

      // First run: delivery is not yet matched; nobody is free, so matching returns undefined
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce(undefined)

      // Run 1
      await service.handleNoCourierRetryJob({ deliveryId })

      expect(mockDeliveryMatchingService.findCourierForDelivery).toHaveBeenCalledTimes(1)
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'no-courier-retry',
        { deliveryId },
        expect.anything()
      )

      // Simulate that the delivery was subsequently offered to a courier
      deliveryState.matchedCourierId = 'courier-new-1'

      // Run 2: running retry again after delivery was offered does nothing
      mockDeliveryMatchingService.findCourierForDelivery.mockClear()
      mockBullMQService.addJob.mockClear()

      await service.handleNoCourierRetryJob({ deliveryId })

      // Second run did nothing because matchedCourierId is already set
      expect(mockDeliveryMatchingService.findCourierForDelivery).not.toHaveBeenCalled()
      expect(mockBullMQService.addJob).not.toHaveBeenCalled()
    })
  })

  describe('endOffer stack partial failure, total failure and retries (Row 141 review, Minor 2)', () => {
    it('partial stack failure: when first write succeeds and second throws, payload1 job resolves, del1 followed up once, del2 untouched, error logged, and del2 own job ends del2', async () => {
      const del1Id = 'del-stack-1'
      const del2Id = 'del-stack-2'
      const courierId = 'courier-stack'
      const offeredAt = new Date('2026-11-24T00:00:00.000Z')
      const offerExpiresAt = new Date('2026-11-24T00:00:20.000Z')

      const stackDel1: any = {
        id: del1Id,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        courierId: null,
        offeredAt,
        offerExpiresAt,
        offerGroupId: 'grp-stack-1',
      }
      const stackDel2: any = {
        id: del2Id,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        courierId: null,
        offeredAt,
        offerExpiresAt,
        offerGroupId: 'grp-stack-1',
      }

      mockDeliveryRepository.findById.mockImplementation(async (id: string) => {
        if (id === del1Id) return stackDel1
        if (id === del2Id) return stackDel2
        return null
      })

      mockDeliveryRepository.findOpenGroupMembers.mockImplementation(async (groupId: string, cid: string) => {
        return [stackDel1, stackDel2].filter((d) => d.offerGroupId === groupId && d.matchedCourierId === cid) as any
      })

      // In the first run, del1 update succeeds, del2 update throws transient error
      const transientDbError = new Error('Database connection failed on del-stack-2 write')
      let shouldDel2Throw = true
      mockDeliveryRepository.updateIfMatches.mockImplementation(async (id: string, where: any, data: any) => {
        if (id === del1Id) {
          Object.assign(stackDel1, data)
          return true
        }
        if (id === del2Id) {
          if (shouldDel2Throw) {
            throw transientDbError
          }
          Object.assign(stackDel2, data)
          return true
        }
        return false
      })

      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const payload1 = {
        deliveryId: del1Id,
        courierId,
        offeredAt: offeredAt.toISOString(),
      }

      // First run: ends del1, del2 throws. Because del1 ended (ended.length > 0), handleOfferExpiryJob RESOLVES
      await expect(service.handleOfferExpiryJob(payload1)).resolves.toBeUndefined()

      // 1. del1 was followed up once:
      // OFFER_EXPIRED event was created for del1Id
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: del1Id,
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          actor: EnumEventActor.SYSTEM,
          courierId,
        })
      )
      // Rider was told offer ended for del1Id
      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ deliveryId: del1Id, reason: 'EXPIRED' })
      )
      // Backstop retry was armed for del1Id
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'no-courier-retry',
        { deliveryId: del1Id },
        expect.anything()
      )

      // 2. del2 was untouched in run 1: still matched to courier, no OFFER_EXPIRED event
      expect(stackDel2.matchedCourierId).toBe(courierId)
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ deliveryId: del2Id })
      )

      // 3. Error was logged describing the partial stack clear failure
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Ended 1 of the 2 offers of delivery ${del1Id}'s stack; the rest are left to their own expiry: Error: Database connection failed on del-stack-2 write`)
      )

      // 4. del2's OWN job runs on its own timer (payload2) and ends del2 with one event
      shouldDel2Throw = false
      const payload2 = {
        deliveryId: del2Id,
        courierId,
        offeredAt: offeredAt.toISOString(),
      }

      await expect(service.handleOfferExpiryJob(payload2)).resolves.toBeUndefined()

      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: del2Id,
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          actor: EnumEventActor.SYSTEM,
          courierId,
        })
      )

      // Exactly 1 OFFER_EXPIRED event for each delivery across both jobs
      const del1Events = mockDeliveryEventRepository.create.mock.calls.filter(
        (call) => call[0].deliveryId === del1Id && call[0].type === EnumDeliveryEventType.OFFER_EXPIRED
      )
      const del2Events = mockDeliveryEventRepository.create.mock.calls.filter(
        (call) => call[0].deliveryId === del2Id && call[0].type === EnumDeliveryEventType.OFFER_EXPIRED
      )
      expect(del1Events).toHaveLength(1)
      expect(del2Events).toHaveLength(1)
    })

    it('total failure: when no write succeeds, handleOfferExpiryJob rejects so BullMQ retries, and retry with the SAME payload ends it once write succeeds', async () => {
      const deliveryId = 'del-total-fail'
      const courierId = 'courier-total'
      const offeredAt = new Date('2026-11-24T00:00:00.000Z')
      const offerExpiresAt = new Date('2026-11-24T00:00:20.000Z')

      const deliveryState: any = {
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        courierId: null,
        offeredAt,
        offerExpiresAt,
        offerGroupId: null,
      }

      mockDeliveryRepository.findById.mockImplementation(async (id: string) => {
        if (id === deliveryId) return deliveryState
        return null
      })

      const transientDbError = new Error('Database write failed on single offer clear')
      let shouldThrow = true
      mockDeliveryRepository.updateIfMatches.mockImplementation(async (id: string, where: any, data: any) => {
        if (id === deliveryId) {
          if (shouldThrow) {
            throw transientDbError
          }
          Object.assign(deliveryState, data)
          return true
        }
        return false
      })

      const payload = {
        deliveryId,
        courierId,
        offeredAt: offeredAt.toISOString(),
      }

      // Run 1: single write throws -> ended.length === 0, so endOffer rethrows failedWrite.error
      // handleOfferExpiryJob rejects so BullMQ will retry this job
      await expect(service.handleOfferExpiryJob(payload)).rejects.toThrow(transientDbError)

      // No event recorded on failure
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ deliveryId, type: EnumDeliveryEventType.OFFER_EXPIRED })
      )

      // Run 2: BullMQ retries with the SAME payload; DB connection recovered
      shouldThrow = false
      await expect(service.handleOfferExpiryJob(payload)).resolves.toBeUndefined()

      // Exactly 1 OFFER_EXPIRED event was created across both runs
      const expiredEvents = mockDeliveryEventRepository.create.mock.calls.filter(
        (call) => call[0].deliveryId === deliveryId && call[0].type === EnumDeliveryEventType.OFFER_EXPIRED
      )
      expect(expiredEvents).toHaveLength(1)
      expect(expiredEvents[0]![0]).toEqual(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          actor: EnumEventActor.SYSTEM,
          courierId,
        })
      )
    })

    it('dispatch stop: endAllOpenOffersForDispatchStop counts the ended delivery of a half failed stack instead of losing it', async () => {
      const del1Id = 'del-stop-stack-1'
      const del2Id = 'del-stop-stack-2'
      const courierId = 'courier-stop-stack'
      const offeredAt = new Date('2026-11-24T00:00:00.000Z')

      const stackDel1: any = {
        id: del1Id,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt,
        offerGroupId: 'grp-stop-stack',
      }
      const stackDel2: any = {
        id: del2Id,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt,
        offerGroupId: 'grp-stop-stack',
      }

      mockDeliveryRepository.findAllOpenOffers.mockResolvedValue([stackDel1])
      mockDeliveryRepository.findOpenGroupMembers.mockImplementation(async (groupId: string, cid: string) => {
        return [stackDel1, stackDel2].filter((d) => d.offerGroupId === groupId && d.matchedCourierId === cid) as any
      })

      mockDeliveryRepository.findById.mockImplementation(async (id: string) => {
        if (id === del1Id) return stackDel1
        if (id === del2Id) return stackDel2
        return null
      })

      const transientError = new Error('Database error on del2 write')
      mockDeliveryRepository.updateIfMatches.mockImplementation(async (id: string, where: any, data: any) => {
        if (id === del1Id) {
          Object.assign(stackDel1, data)
          return true
        }
        if (id === del2Id) {
          throw transientError
        }
        return false
      })

      // In endAllOpenOffersForDispatchStop, endOffer resolves with 1 (does not throw), so ended count is 1
      const count = await service.endAllOpenOffersForDispatchStop(
        eventText('DISPATCH_STOP_OFFER_ENDED', { reason: EnumDispatchStopReason.HEAT })
      )

      expect(count).toBe(1)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: del1Id,
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          actor: EnumEventActor.SYSTEM,
          courierId,
        })
      )
    })
  })
})
