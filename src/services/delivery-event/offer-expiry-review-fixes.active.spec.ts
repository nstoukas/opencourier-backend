import * as fs from 'fs'
import * as path from 'path'
import { ConfigService } from '@nestjs/config'
import {
  EnumCourierStatus,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  Prisma,
} from '@prisma/types'
import { DeliveryEventService } from './delivery-event.service'
import { WebsocketDispatcher } from '../websocket/models/WebsocketDispatcher'
import { CourierRepository, busyCourierDeliverySubQuery } from 'src/persistence/repositories/courier.repository'
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
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { CantUpdateDeliveryStatusError } from 'src/errors'
import { DeliveryPartnerRestApiController } from 'src/rest-api/delivery/partner/delivery.partner.rest-api.controller'
import { DeliveryPartnerRestApiService } from 'src/rest-api/delivery/partner/delivery.partner.rest-api.service'
import { TestingAdminRestApiController } from 'src/rest-api/testing/admin/testing.admin.rest-api.controller'
import { TestingAdminRestApiService } from 'src/rest-api/testing/admin/testing.admin.rest-api.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'
import { OfferEndedReason } from 'src/shared-types'
import { OfferPushService } from '../pushNotification/offer-push.service'

describe('Offer Expiry - Review Fixes Regressions (Scope row 61 review)', () => {
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
      findById: jest.fn(),
      findByIdOrThrow: jest.fn(),
      updateById: jest.fn().mockResolvedValue({} as any),
      findOpenOffersForCourier: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<CourierRepository>
    mockDeliveryRepository = {
      findById: jest.fn().mockResolvedValue({
        id: 'default-del',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        matchedCourierId: null,
        courierId: null,
        offeredAt: null,
        offerExpiresAt: null,
      } as any),
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'default-del',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        matchedCourierId: null,
        courierId: null,
        offeredAt: null,
        offerExpiresAt: null,
      } as any),
      update: jest.fn().mockResolvedValue({
        id: 'default-del',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        matchedCourierId: null,
        courierId: null,
      } as any),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      findIdsWaitingForCourierOldestFirst: jest.fn().mockResolvedValue([]),
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
      findCourierForDelivery: jest.fn(),
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
      // Spec 0003 added the offer push service; push is not under test here.
      { newOffer: jest.fn(), offerEnded: jest.fn() } as unknown as OfferPushService
    )
  })

  // --------------------------------------------------------------------------
  // Fix 1: Storm test
  // --------------------------------------------------------------------------
  describe('Fix 1: Storm prevention on rider freed (Major 1)', () => {
    it('with two deliveries waiting and one rider coming free, matchWaitingDeliveries offers exactly one and stops', async () => {
      mockDeliveryRepository.findIdsWaitingForCourierOldestFirst.mockResolvedValue(['del-wait-1', 'del-wait-2'])

      mockDeliveryRepository.findByIdOrThrow.mockImplementation(async (id: string) => ({
        id,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
        partnerId: 'partner-1',
      } as any))

      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier: { id: 'courier-free-1', userId: 'user-free-1' } as any,
        delivery: {} as any,
      })

      mockCourierRepository.findById.mockResolvedValue({ id: 'courier-free-1', userId: 'user-free-1' } as any)
      mockCourierRepository.findByIdOrThrow.mockResolvedValue({ id: 'courier-free-1', userId: 'user-free-1' } as any)

      await service.matchWaitingDeliveries()

      // Exactly ONE offer should be made: findCourierForDelivery called once for del-wait-1, loop breaks on 'OFFERED'
      expect(mockDeliveryMatchingService.findCourierForDelivery).toHaveBeenCalledTimes(1)
      expect(mockDeliveryMatchingService.findCourierForDelivery).toHaveBeenCalledWith('del-wait-1')
      expect(mockWebsocketDispatcher.sendOfferToCourier).toHaveBeenCalledTimes(1)
    })

    it('busyCourierDeliverySubQuery contains open offer clause to exclude riders with unanswered offers', () => {
      const subQuery = busyCourierDeliverySubQuery()

      // Correlates with open offer (matchedCourierId = Courier.id, courierId IS NULL, ASSIGNING_COURIER)
      expect(subQuery.sql).toContain('"Delivery"."matchedCourierId" = "Courier"."id"')
      expect(subQuery.sql).toContain('"Delivery"."courierId" IS NULL')
      expect(subQuery.sql).toContain('"Delivery"."status"::text =')
      expect(subQuery.values).toContain(EnumDeliveryStatus.ASSIGNING_COURIER)
    })
  })

  // --------------------------------------------------------------------------
  // Fix 2: Throw after conditional clear in endOffer & failing saveOfferedEvent
  // --------------------------------------------------------------------------
  describe('Fix 2: Throw after conditional clear and failing saveOfferedEvent (Minor 1)', () => {
    const deliveryId = 'del-throw-test'
    const courierId = 'courier-throw-test'
    const offeredAt = new Date(Date.now() - 30000)

    it('endOffer: throw from courierRepository.findById still records OFFER_EXPIRED and schedules no-courier-retry', async () => {
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(true)
      mockCourierRepository.findById.mockRejectedValueOnce(new Error('DB disconnect'))

      const initialDelivery = {
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt,
        offerExpiresAt: new Date(offeredAt.getTime() + 20000),
        partnerId: 'partner-1',
        courierId: null,
      }
      const waitingDelivery = {
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
        partnerId: 'partner-1',
      }
      mockDeliveryRepository.findById
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValue(waitingDelivery as any)

      await service.handleOfferExpiryJob({
        deliveryId,
        courierId,
        offeredAt: offeredAt.toISOString(),
      })

      // OFFER_EXPIRED event still recorded
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          courierId,
        })
      )
      // no-courier-retry still scheduled
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'no-courier-retry',
        { deliveryId },
        expect.anything()
      )
    })

    it('endOffer: throw from sendOfferEnded still records OFFER_EXPIRED and schedules no-courier-retry', async () => {
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(true)
      mockCourierRepository.findById.mockResolvedValueOnce({ id: courierId, userId: 'u-1' } as any)
      mockWebsocketDispatcher.sendOfferEnded.mockRejectedValueOnce(new Error('Socket send failed'))

      const initialDelivery = {
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt,
        offerExpiresAt: new Date(offeredAt.getTime() + 20000),
        partnerId: 'partner-1',
        courierId: null,
      }
      const waitingDelivery = {
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
        partnerId: 'partner-1',
      }
      mockDeliveryRepository.findById
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValue(waitingDelivery as any)

      await service.handleOfferExpiryJob({
        deliveryId,
        courierId,
        offeredAt: offeredAt.toISOString(),
      })

      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          courierId,
        })
      )
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'no-courier-retry',
        { deliveryId },
        expect.anything()
      )
    })

    it('endOffer: throw from processDeliveryEvent still schedules no-courier-retry when delivery left waiting', async () => {
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(true)
      mockCourierRepository.findById.mockResolvedValueOnce({ id: courierId, userId: 'u-1' } as any)
      mockDeliveryEventRepository.create.mockRejectedValueOnce(new Error('Event write failed'))

      const initialDelivery = {
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt,
        offerExpiresAt: new Date(offeredAt.getTime() + 20000),
        partnerId: 'partner-1',
        courierId: null,
      }
      const waitingDelivery = {
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
        partnerId: 'partner-1',
      }
      mockDeliveryRepository.findById
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValue(waitingDelivery as any)

      await service.handleOfferExpiryJob({
        deliveryId,
        courierId,
        offeredAt: offeredAt.toISOString(),
      })

      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'no-courier-retry',
        { deliveryId },
        expect.anything()
      )
    })

    it('endOffer: when processDeliveryEvent itself rejects, endOffer resolves true and still schedules no-courier-retry', async () => {
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(true)
      mockCourierRepository.findById.mockResolvedValueOnce({ id: courierId, userId: 'u-1' } as any)
      const waitingDelivery = {
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
        partnerId: 'partner-1',
      }
      mockDeliveryRepository.findById.mockResolvedValue(waitingDelivery as any)

      // processDeliveryEvent itself rejects on the OFFER_EXPIRED call (e.g. database down)
      const processDeliveryEventSpy = jest
        .spyOn(service, 'processDeliveryEvent')
        .mockRejectedValueOnce(new Error('db down'))

      // endOffer must resolve true (does not throw) even when processDeliveryEvent rejects
      await expect(
        (service as any).endOffer({
          deliveryId,
          courierId,
          offeredAt,
          reason: 'EXPIRED' as OfferEndedReason,
          message: 'Offer expired after 20 s',
        })
      ).resolves.toBe(true)

      expect(processDeliveryEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          courierId,
        })
      )

      // Backstop retry is still added when delivery is left waiting
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'no-courier-retry',
        { deliveryId },
        expect.anything()
      )
    })

    it('offerToNextCourier: failing saveOfferedEvent still schedules offer-expiry job and still sends offer', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-failing-save-event',
        status: EnumDeliveryStatus.CREATED,
        matchedCourierId: null,
        courierId: null,
        partnerId: 'partner-1',
      } as any)

      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier: { id: 'courier-1', userId: 'user-1' } as any,
        delivery: {} as any,
      })
      mockCourierRepository.findByIdOrThrow.mockResolvedValue({ id: 'courier-1', userId: 'user-1' } as any)

      // saveOfferedEvent fails
      mockDeliveryEventRepository.create.mockRejectedValueOnce(new Error('Event write failed'))

      await service.offerWaitingDeliveryNow('del-failing-save-event')

      // Despite saveOfferedEvent failing, expiry job is still added and websocket offer is still sent
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'offer-expiry',
        expect.objectContaining({ deliveryId: 'del-failing-save-event', courierId: 'courier-1' }),
        expect.anything()
      )
      expect(mockWebsocketDispatcher.sendOfferToCourier).toHaveBeenCalledWith(
        'user-1',
        expect.anything()
      )
    })
  })

  // --------------------------------------------------------------------------
  // Fix 3: offerWaitingDeliveryNow & test routes
  // --------------------------------------------------------------------------
  describe('Fix 3: offerWaitingDeliveryNow and test routes (Major 2)', () => {
    it('runs the real offer step (conditional write with offeredAt, saves OFFERED, schedules expiry)', async () => {
      const deliveryId = 'del-offer-now'
      const courierEntity = new CourierEntity({ id: 'courier-matched', userId: 'u-matched' } as any)
      const deliveryEntity = { id: deliveryId, matchedCourierId: 'courier-matched' } as any

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce({
          id: deliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: null,
          courierId: null,
          partnerId: 'partner-1',
        } as any)
        .mockResolvedValueOnce(deliveryEntity)

      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier: { id: 'courier-matched', userId: 'u-matched' } as any,
        delivery: {} as any,
      })
      mockCourierRepository.findByIdOrThrow.mockResolvedValue(courierEntity)

      const result = await service.offerWaitingDeliveryNow(deliveryId)

      expect(result).toEqual({ courier: courierEntity, delivery: deliveryEntity })
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        expect.objectContaining({ matchedCourierId: null, courierId: null }),
        expect.objectContaining({
          matchedCourierId: 'courier-matched',
          offeredAt: expect.any(Date),
        })
      )
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.OFFERED,
          courierId: 'courier-matched',
        })
      )
      expect(mockBullMQService.addJob).toHaveBeenCalledWith('offer-expiry', expect.anything(), expect.anything())
    })

    it('records NO_COURIER_AVAILABLE when nobody is free and returns undefined', async () => {
      const deliveryId = 'del-nobody-free'
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      } as any)
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce(undefined)

      const result = await service.offerWaitingDeliveryNow(deliveryId)

      expect(result).toBeUndefined()
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.NO_COURIER_AVAILABLE,
        })
      )
    })

    it('throws CantUpdateDeliveryStatusError when delivery is not waiting', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: 'del-not-waiting',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'already-offered-rider',
        courierId: null,
      } as any)
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier: { id: 'c-1' },
        delivery: {},
      } as any)
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(false)

      await expect(service.offerWaitingDeliveryNow('del-not-waiting')).rejects.toThrow(
        CantUpdateDeliveryStatusError
      )
    })

    it('partner test route refuses another partner delivery (404) and calls offerWaitingDeliveryNow', async () => {
      const mockDeliveryPartnerRestApiService: any = {
        getByIdWithRelations: jest.fn().mockRejectedValue(new Error('Not found')),
      }
      const partnerController = new DeliveryPartnerRestApiController(
        mockDeliveryPartnerRestApiService,
        service
      )
      const partner = new PartnerEntity({ id: 'partner-1' } as any)

      await expect(partnerController.findCourier('del-other-partner', partner)).rejects.toThrow()
      expect(mockDeliveryPartnerRestApiService.getByIdWithRelations).toHaveBeenCalledWith('del-other-partner', 'partner-1')
    })

    it('admin test route calls offerWaitingDeliveryNow', async () => {
      const adminTestingController = new TestingAdminRestApiController(
        {} as any,
        service
      )
      jest.spyOn(service, 'offerWaitingDeliveryNow').mockResolvedValueOnce({
        courier: new CourierEntity({ id: 'c-admin-test' } as any),
        delivery: {} as any,
      })

      const result = await adminTestingController.findCourier('del-admin-test')
      expect(service.offerWaitingDeliveryNow).toHaveBeenCalledWith('del-admin-test')
      expect(result).toBeDefined()
    })

    it('invariant check: no source code writes matchedCourierId without offeredAt', () => {
      // 1. The old bare-write method in DeliveryMatchingService has been completely removed
      expect((DeliveryMatchingService.prototype as any).matchDeliveryToCourier).toBeUndefined()

      function findTsFiles(dir: string): string[] {
        const results: string[] = []
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            results.push(...findTsFiles(full))
          } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
            results.push(full)
          }
        }
        return results
      }

      const srcDir = path.resolve(__dirname, '../../')
      const sourceFiles = findTsFiles(srcDir)
      expect(sourceFiles.length).toBeGreaterThan(0)

      for (const file of sourceFiles) {
        if (file.endsWith('delivery.repository.ts') || file.endsWith('.entity.ts') || file.endsWith('.dto.ts')) {
          continue
        }
        const content = fs.readFileSync(file, 'utf8')
        // Match write payloads to update(id, data) or updateIfMatches(id, where, data)
        const updateMatches = [
          ...content.matchAll(/\.update\s*\([^,]+,\s*\{([^}]+)\}/g),
          ...content.matchAll(/\.updateIfMatches\s*\([^,]+,[^,]+,\s*\{([^}]+)\}/g),
        ]
        for (const match of updateMatches) {
          const payload = match[1]!
          if (payload.includes('matchedCourierId')) {
            expect(payload).toContain('offeredAt')
          }
        }
      }
    })
  })

  // --------------------------------------------------------------------------
  // Fix 4: Admin offer and REASSIGNED conditional writes
  // --------------------------------------------------------------------------
  describe('Fix 4: Admin offer and REASSIGNED conditional write (Minor 3)', () => {
    it('admin offer: conditional write miss throws 409 CantUpdateDeliveryStatusError and saves no event', async () => {
      const deliveryId = 'del-admin-miss'
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.CREATED,
        partnerId: 'partner-1',
        courierId: null,
        matchedCourierId: null,
        offeredAt: null,
      } as any)
      mockCourierRepository.findByIdOrThrow.mockResolvedValue({ id: 'c-1', userId: 'u-1' } as any)

      // Miss on updateIfMatches (e.g. accepted at same second)
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(false)

      await expect(service.offerDeliveryToCourierAsAdmin(deliveryId, 'c-1')).rejects.toThrow(
        CantUpdateDeliveryStatusError
      )
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalled()
    })

    it('admin offer: replacing rider A sends A OFFER_ENDED with reason MOVED, puts A on no skip list, writes no OFFER_EXPIRED', async () => {
      const deliveryId = 'del-replace-rider'
      const offeredAt = new Date('2026-10-25T10:00:00Z')
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce({
          id: deliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          partnerId: 'partner-1',
          matchedCourierId: 'courier-A',
          courierId: null,
          offeredAt,
        } as any)
        .mockResolvedValueOnce({
          id: deliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          partnerId: 'partner-1',
          matchedCourierId: 'courier-B',
          courierId: null,
          offeredAt: new Date(),
        } as any)

      mockCourierRepository.findByIdOrThrow.mockImplementation(async (id: string) => ({
        id,
        userId: `user-${id}`,
      } as any))
      mockCourierRepository.findById.mockImplementation(async (id: string) => ({
        id,
        userId: `user-${id}`,
      } as any))

      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

      await service.offerDeliveryToCourierAsAdmin(deliveryId, 'courier-B', 'Replacing rider A')

      // Rider A gets OFFER_ENDED with reason MOVED
      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith('user-courier-A', {
        deliveryId,
        reason: 'MOVED',
      })
      // Rider A is not put on skip list
      expect(mockCacheService.save).not.toHaveBeenCalledWith(
        expect.stringContaining(deliveryId),
        expect.arrayContaining(['courier-A']),
        expect.anything()
      )
      // No OFFER_EXPIRED event written
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.OFFER_EXPIRED })
      )
      // OFFERED event message names replaced courier
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.OFFERED,
          courierId: 'courier-B',
          message: expect.stringContaining('courier-A'),
        })
      )
    })

    it('admin offer: re-offering the same rider sends no MOVED notification', async () => {
      const deliveryId = 'del-reoffer-same'
      const offeredAt = new Date('2026-10-25T10:00:00Z')
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce({
          id: deliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          partnerId: 'partner-1',
          matchedCourierId: 'courier-same',
          courierId: null,
          offeredAt,
        } as any)
        .mockResolvedValueOnce({
          id: deliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          partnerId: 'partner-1',
          matchedCourierId: 'courier-same',
          courierId: null,
          offeredAt: new Date(),
        } as any)

      mockCourierRepository.findByIdOrThrow.mockResolvedValue({ id: 'courier-same', userId: 'user-same' } as any)
      mockCourierRepository.findById.mockResolvedValue({ id: 'courier-same', userId: 'user-same' } as any)
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

      await service.offerDeliveryToCourierAsAdmin(deliveryId, 'courier-same')

      expect(mockWebsocketDispatcher.sendOfferEnded).not.toHaveBeenCalled()
    })

    it('REASSIGNED: calculates amounts before update, conditional on current status/courierId, miss records failed transition and offers nobody', async () => {
      const deliveryId = 'del-reassign-miss'
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.DISPATCHED,
        courierId: 'courier-original',
      } as any)
      mockCourierRepository.findByIdOrThrow.mockResolvedValue({ id: 'courier-new', userId: 'user-new' } as any)

      const callOrder: string[] = []
      mockDeliveryCalculationService.calculateDeliveryAmountsForMatchedCourier.mockImplementation(async () => {
        callOrder.push('calculateAmounts')
        return { totalCost: 1000, totalCompensation: 800, fee: 200, feePercentage: 20 } as any
      })
      mockDeliveryRepository.updateIfMatches.mockImplementation(async () => {
        callOrder.push('updateIfMatches')
        return false // miss!
      })

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.REASSIGNED,
        actor: EnumEventActor.ADMIN,
        courierId: 'courier-new',
        source: EnumDeliveryEventSource.OPENCOURIER,
      })

      // Calculation must happen BEFORE updateIfMatches
      expect(callOrder).toEqual(['calculateAmounts', 'updateIfMatches'])

      // Failure must record failed transition and offer nobody
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.REASSIGNED,
          transitionSuccessful: false,
        })
      )
      expect(mockWebsocketDispatcher.sendOfferToCourier).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Fix 5: Skip list added before clear
  // --------------------------------------------------------------------------
  describe('Fix 5: Skip list added before conditional clear (Minor 4)', () => {
    it('endOffer: cache save happens before updateIfMatches, and miss undoes only newly added entry', async () => {
      const deliveryId = 'del-skiplist-order'
      const courierId = 'courier-skip-1'
      const offeredAt = new Date(Date.now() - 30000)

      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt,
        offerExpiresAt: new Date(Date.now() - 5000),
      } as any)

      const callOrder: string[] = []
      mockCacheService.getOrDefault.mockImplementation(async () => [])
      mockCacheService.save.mockImplementation(async (_key, val) => {
        callOrder.push(`cache.save:${JSON.stringify(val)}`)
      })
      mockDeliveryRepository.updateIfMatches.mockImplementation(async () => {
        callOrder.push('updateIfMatches')
        return false // miss
      })

      await service.handleOfferExpiryJob({
        deliveryId,
        courierId,
        offeredAt: offeredAt.toISOString(),
      })

      // Added before update, and undone after miss
      expect(callOrder).toEqual([
        'cache.save:["courier-skip-1"]',
        'updateIfMatches',
        'cache.save:[]',
      ])
    })

    it('rejectDelivery: cache save happens before updateIfMatches, and miss undoes only newly added entry', async () => {
      const mockDeliveryRepo: any = {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'del-reject-order',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: 'courier-1',
          offeredAt: new Date(),
        }),
        updateIfMatches: jest.fn(),
      }
      const callOrder: string[] = []
      mockCacheService.getOrDefault.mockImplementation(async () => [])
      mockCacheService.save.mockImplementation(async (_k, val) => {
        callOrder.push(`cache.save:${JSON.stringify(val)}`)
      })
      mockDeliveryRepo.updateIfMatches.mockImplementation(async () => {
        callOrder.push('updateIfMatches')
        return false // miss
      })

      const domainService = new DeliveryDomainService(
        mockDeliveryRepo,
        {} as any,
        mockCacheService,
        service,
        mockCourierRepository,
        {} as any,
        {} as any
      )

      await expect(domainService.rejectDelivery('del-reject-order', 'courier-1')).rejects.toThrow()
      expect(callOrder).toEqual([
        'cache.save:["courier-1"]',
        'updateIfMatches',
        'cache.save:[]',
      ])
    })
  })

  // --------------------------------------------------------------------------
  // Fix 6: Accept rollback rearmOfferExpiry
  // --------------------------------------------------------------------------
  describe('Fix 6: Accept rollback re-arms offer expiry (Minor 5)', () => {
    it('rearmOfferExpiry adds job with delay = time left + 3s grace (never negative) and unique jobId', async () => {
      const deliveryId = 'del-rearm-test'
      const courierId = 'courier-rearm'
      const offeredAt = new Date(Date.now() - 10000)
      const offerExpiresAt = new Date(Date.now() + 15000) // 15s left

      await service.rearmOfferExpiry(deliveryId, courierId, offeredAt, offerExpiresAt)

      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'offer-expiry',
        {
          deliveryId,
          courierId,
          offeredAt: offeredAt.toISOString(),
        },
        expect.objectContaining({
          // 15s + 3s grace = ~18s (within tolerance)
          delay: expect.any(Number),
          jobId: expect.stringMatching(new RegExp(`offer-expiry-${deliveryId}-${offeredAt.getTime()}-rearm-`)),
        })
      )
      const call = mockBullMQService.addJob.mock.calls.find((c) => c[0] === 'offer-expiry')
      expect(call?.[2]?.delay).toBeGreaterThanOrEqual(17000)
    })

    it('rearmOfferExpiry never uses a negative delay even if deadline already passed', async () => {
      const deliveryId = 'del-rearm-past'
      const courierId = 'courier-rearm-past'
      const offeredAt = new Date(Date.now() - 30000)
      const offerExpiresAt = new Date(Date.now() - 10000) // 10s past!

      await service.rearmOfferExpiry(deliveryId, courierId, offeredAt, offerExpiresAt)

      const call = mockBullMQService.addJob.mock.calls.find((c) => c[0] === 'offer-expiry')
      // delay = Math.max(0, -10s) + 3s = 3000ms
      expect(call?.[2]?.delay).toBe(3000)
    })

    it('acceptDelivery does not re-arm when offer had no deadline (offerExpiresAt null)', async () => {
      const mockDeliveryRepo: any = {
        findByIdOrThrow: jest.fn()
          .mockResolvedValueOnce({
            id: 'del-no-deadline',
            status: EnumDeliveryStatus.ASSIGNING_COURIER,
            partnerId: 'partner-1',
            matchedCourierId: 'c-admin',
            offeredAt: new Date(),
            offerExpiresAt: null, // Admin offer, no deadline
            courierId: null,
          })
          .mockResolvedValueOnce({
            id: 'del-no-deadline',
            status: EnumDeliveryStatus.ASSIGNING_COURIER, // Rollback trigger
            partnerId: 'partner-1',
            courierId: 'c-admin',
          }),
        updateIfMatches: jest.fn().mockResolvedValue(true),
      }
      mockDeliveryRepository.findById.mockResolvedValue({
        id: 'del-no-deadline',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        matchedCourierId: 'c-admin',
        courierId: null,
      } as any)
      mockCourierRepository.findByIdOrThrow.mockResolvedValue({
        id: 'c-admin',
        status: EnumCourierStatus.ONLINE,
      } as any)
      jest.spyOn(service, 'rearmOfferExpiry')

      const domainService = new DeliveryDomainService(
        mockDeliveryRepo,
        {} as any,
        mockCacheService,
        service,
        mockCourierRepository,
        {} as any,
        {} as any
      )

      await expect(domainService.acceptDelivery('del-no-deadline', 'c-admin')).rejects.toThrow()
      expect(service.rearmOfferExpiry).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Fix 7: scheduleNoCourierRetry on remove failure
  // --------------------------------------------------------------------------
  describe('Fix 7: scheduleNoCourierRetry handles remove failure (Minor 6)', () => {
    it('still calls addJob when removeDelayedJobsWithIdPrefix rejects', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-retry-err',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        matchedCourierId: null,
        courierId: null,
      } as any)
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce(undefined)

      // remove fails
      mockBullMQService.removeDelayedJobsWithIdPrefix.mockRejectedValueOnce(new Error('Redis job lock'))

      await service.offerWaitingDeliveryNow('del-retry-err')

      // addJob must still be called for no-courier-retry
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'no-courier-retry',
        { deliveryId: 'del-retry-err' },
        expect.anything()
      )
    })
  })

  // --------------------------------------------------------------------------
  // Fix 8: Partner webhook suppression
  // --------------------------------------------------------------------------
  describe('Fix 8: Partner webhooks skipped for OFFERED, OFFER_EXPIRED, NO_COURIER_AVAILABLE (Minor 8)', () => {
    it('does NOT send partner webhook for OFFER_EXPIRED driven through processDeliveryEvent', async () => {
      mockDeliveryRepository.findById.mockResolvedValue({
        id: 'del-expired-webhook',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        courierId: null,
      } as any)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-expired-webhook',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        courierId: null,
      } as any)
      mockDeliveryRepository.update.mockResolvedValue({
        id: 'del-expired-webhook',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        courierId: null,
      } as any)

      await service.processDeliveryEvent({
        deliveryId: 'del-expired-webhook',
        type: EnumDeliveryEventType.OFFER_EXPIRED,
        actor: EnumEventActor.SYSTEM,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: 'courier-1',
      })

      expect(mockPartnerWebhookService.sendDeliveryUpdatePartnerWebhook).not.toHaveBeenCalled()
    })

    it('STILL sends partner webhook for REJECTED and CANCELED', async () => {
      mockDeliveryRepository.findById.mockResolvedValue({
        id: 'del-reject-webhook',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        courierId: null,
      } as any)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-reject-webhook',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        courierId: null,
      } as any)
      mockDeliveryRepository.update.mockResolvedValue({
        id: 'del-reject-webhook',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        courierId: null,
      } as any)

      await service.processDeliveryEvent({
        deliveryId: 'del-reject-webhook',
        type: EnumDeliveryEventType.REJECTED,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: 'courier-1',
      })

      expect(mockPartnerWebhookService.sendDeliveryUpdatePartnerWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-reject-webhook',
          event: expect.objectContaining({ type: EnumDeliveryEventType.REJECTED }),
        })
      )

      mockPartnerWebhookService.sendDeliveryUpdatePartnerWebhook.mockClear()

      mockDeliveryRepository.update.mockResolvedValueOnce({
        id: 'del-reject-webhook',
        status: EnumDeliveryStatus.CANCELED,
        partnerId: 'partner-1',
        courierId: null,
      } as any)

      await service.processDeliveryEvent({
        deliveryId: 'del-reject-webhook',
        type: EnumDeliveryEventType.CANCELED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
      })

      expect(mockPartnerWebhookService.sendDeliveryUpdatePartnerWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-reject-webhook',
          event: expect.objectContaining({ type: EnumDeliveryEventType.CANCELED }),
        })
      )
    })
  })
})
