import { ConfigService } from '@nestjs/config'
import { EnumDeliveryEventType, EnumDeliveryStatus, EnumEventActor, Prisma } from '@prisma/types'
import { DeliveryEventService } from './delivery-event.service'
import { CacheService } from '../cache/cache.service'
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
import { OfferPushService } from '../pushNotification/offer-push.service'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'
import { PartnerChargeRepository } from 'src/persistence/repositories/partner-charge.repository'
import { RemovalRequestRepository } from 'src/persistence/repositories/removal-request.repository'
import { DispatchStopRepository } from 'src/persistence/repositories/dispatch-stop.repository'
import { OsrmRoutingService } from '../osrm/osrm-routing.service'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { stackPairBlockKey } from 'src/domains/delivery/stack'

// Scope row 147: How long a declined pair stays apart is a co-op setting.
// Clauses 1 and 6:
// - A representative edits the pair block time and the next declined or missed pair uses it, with no deploy:
//   blockStackPair in DeliveryEventService reads configDomainService.instanceConfig.getStackPairBlockMinutes()
//   at each call and saves the stack-pair-block key with minutes * 60 as its TTL:
//   at 5 minutes 300 s, at 7 minutes 420 s, for both declineStack and endOffer on an expired stack.
// - At 0 nothing is saved at all (Redis refuses an expiry of 0), no error is logged, and follow ups still occur.
// - A failed settings read is logged and the decline or expiry still goes through without a block.
// - Not after Offline or a dispatch stop: the rider never judged the pair, so block is not written and getter not read.
// - Tests fail if the block goes back to a fixed time (60 * 20 / 1200 s).
describe('Pair block TTL follows stackPairBlockMinutes co-op setting (row 147, Clauses 1 & 6)', () => {
  let service: DeliveryEventService

  let mockCacheService: { get: jest.Mock; getOrDefault: jest.Mock; save: jest.Mock; delete: jest.Mock }
  let mockConfigDomainService: {
    instanceConfig: { getStackPairBlockMinutes: jest.Mock; getOfferSkipMinutes: jest.Mock; [k: string]: any }
  }
  let mockDeliveryRepo: any
  let mockCourierRepo: any
  let mockDeliveryEventRepo: any
  let mockWebsocketDispatcher: any

  const del1Id = 'del-1'
  const del2Id = 'del-2'
  const courierId = 'courier-1'
  const offerGroupId = 'grp-stack-1'
  const offeredAt = new Date('2026-11-24T12:00:00.000Z')
  const pairKey = stackPairBlockKey(del1Id, del2Id)

  const makeDelivery = (id: string, overrides: Partial<any> = {}): DeliveryEntity =>
    ({
      id,
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      matchedCourierId: courierId,
      courierId: null,
      offeredAt,
      offerExpiresAt: new Date(offeredAt.getTime() + 60000),
      offerGroupId,
      stopSequence: id === del1Id ? 1 : 2,
      totalCompensation: 400,
      currencyCode: 'EUR',
      pickupReadyAt: new Date(),
      ...overrides,
    } as unknown as DeliveryEntity)

  beforeEach(() => {
    mockCacheService = {
      get: jest.fn().mockResolvedValue(null),
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    }

    mockConfigDomainService = {
      instanceConfig: {
        getStackPairBlockMinutes: jest.fn().mockResolvedValue(20),
        getOfferSkipMinutes: jest.fn().mockResolvedValue(20),
        getOfferExpiryEnabled: jest.fn().mockResolvedValue(true),
        getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
        getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
        getNoCourierRetrySeconds: jest.fn().mockResolvedValue(30),
      },
    }

    mockDeliveryRepo = {
      findById: jest.fn().mockResolvedValue(null),
      findByIdOrThrow: jest.fn().mockImplementation((id: string) => Promise.resolve(makeDelivery(id))),
      findOpenGroupMembers: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation((id, data) => Promise.resolve({ id, ...data })),
      updateIfMatches: jest.fn().mockResolvedValue(true),
    }

    mockCourierRepo = {
      findById: jest.fn().mockResolvedValue({ id: courierId, userId: `user-${courierId}` }),
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: courierId, userId: `user-${courierId}` }),
      updateById: jest.fn().mockResolvedValue({}),
      changeStatus: jest.fn().mockResolvedValue({}),
      clearLocationIfOfflineAndFree: jest.fn().mockResolvedValue(undefined),
    }

    mockDeliveryEventRepo = {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      findLatestOfTypes: jest.fn().mockResolvedValue(null),
    }

    mockWebsocketDispatcher = {
      sendOfferToCourier: jest.fn().mockResolvedValue(undefined),
      sendOfferEnded: jest.fn().mockResolvedValue(undefined),
      dispatchDeliveryStatusUpdated: jest.fn().mockResolvedValue(undefined),
    }

    const mockBullMQService = {
      addJob: jest.fn().mockResolvedValue(undefined),
      removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue([]),
    }

    service = new DeliveryEventService(
      { get: jest.fn() } as unknown as ConfigService,
      mockWebsocketDispatcher as unknown as WebsocketDispatcher,
      mockCourierRepo as unknown as CourierRepository,
      mockDeliveryRepo as unknown as DeliveryRepository,
      mockDeliveryEventRepo as unknown as DeliveryEventRepository,
      { scheduleTask: jest.fn() } as unknown as TaskBusScheduler,
      { registerTaskHandler: jest.fn() } as unknown as TaskBusService,
      { sendDeliveryUpdatePartnerWebhook: jest.fn() } as unknown as PartnerWebhookService,
      { findCourierForDelivery: jest.fn(), matchDeliveryToCourier: jest.fn() } as unknown as DeliveryMatchingService,
      {
        calculateDeliveryAmountsForMatchedCourier: jest
          .fn()
          .mockResolvedValue({ totalCost: 500, totalCompensation: 400 }),
      } as unknown as DeliveryCalculationService,
      mockBullMQService as unknown as BullMQService,
      mockConfigDomainService as any,
      mockCacheService as unknown as CacheService,
      { newOffer: jest.fn(), offerEnded: jest.fn(), jobCancelled: jest.fn() } as unknown as OfferPushService,
      { findOn: jest.fn().mockResolvedValue(null) } as unknown as DispatchStopRepository,
      { getRoute: jest.fn() } as unknown as OsrmRoutingService,
      {
        create: jest.fn().mockResolvedValue({ id: 'comp-1' }),
        deleteById: jest.fn().mockResolvedValue(undefined),
      } as unknown as CourierCompensationRepository,
      { create: jest.fn().mockResolvedValue({ id: 'charge-1' }) } as unknown as PartnerChargeRepository,
      { closeOpenForDelivery: jest.fn().mockResolvedValue(undefined) } as unknown as RemovalRequestRepository
    )
  })

  // --------------------------------------------------------------------------
  // declineStack (declined pair)
  // --------------------------------------------------------------------------
  describe('declineStack (declined pair)', () => {
    it('saves stack pair block with 300 s TTL when stackPairBlockMinutes is 5 (not fixed 1200)', async () => {
      mockConfigDomainService.instanceConfig.getStackPairBlockMinutes.mockResolvedValue(5)
      const del1 = makeDelivery(del1Id)
      const del2 = makeDelivery(del2Id)
      mockDeliveryRepo.findOpenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.updateIfMatches.mockResolvedValue(true)
      jest.spyOn(service, 'processDeliveryEvent').mockResolvedValue(undefined)

      await service.declineStack(del1, courierId)

      expect(mockCacheService.save).toHaveBeenCalledWith(pairKey, true, 300)
    })

    it('saves stack pair block with 420 s TTL when stackPairBlockMinutes is 7', async () => {
      mockConfigDomainService.instanceConfig.getStackPairBlockMinutes.mockResolvedValue(7)
      const del1 = makeDelivery(del1Id)
      const del2 = makeDelivery(del2Id)
      mockDeliveryRepo.findOpenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.updateIfMatches.mockResolvedValue(true)
      jest.spyOn(service, 'processDeliveryEvent').mockResolvedValue(undefined)

      await service.declineStack(del1, courierId)

      expect(mockCacheService.save).toHaveBeenCalledWith(pairKey, true, 420)
    })

    it('writes nothing to Redis when stackPairBlockMinutes is 0 (decision 147.1)', async () => {
      mockConfigDomainService.instanceConfig.getStackPairBlockMinutes.mockResolvedValue(0)
      const del1 = makeDelivery(del1Id)
      const del2 = makeDelivery(del2Id)
      mockDeliveryRepo.findOpenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.updateIfMatches.mockResolvedValue(true)
      const processSpy = jest.spyOn(service, 'processDeliveryEvent').mockResolvedValue(undefined)
      const loggerSpy = jest.spyOn((service as any).logger, 'error')

      await service.declineStack(del1, courierId)

      // Nothing saved for the pair block key
      const pairBlockCalls = mockCacheService.save.mock.calls.filter(([savedKey]) => savedKey === pairKey)
      expect(pairBlockCalls).toHaveLength(0)
      expect(loggerSpy).not.toHaveBeenCalled()

      // Follow up events still happen
      expect(processSpy).toHaveBeenCalledTimes(2)
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryId: del1Id, type: EnumDeliveryEventType.REJECTED })
      )
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryId: del2Id, type: EnumDeliveryEventType.REJECTED })
      )
    })

    it('logs error and decline still goes through when getStackPairBlockMinutes rejects', async () => {
      mockConfigDomainService.instanceConfig.getStackPairBlockMinutes.mockRejectedValue(
        new Error('Config DB unreachable')
      )
      const del1 = makeDelivery(del1Id)
      const del2 = makeDelivery(del2Id)
      mockDeliveryRepo.findOpenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.updateIfMatches.mockResolvedValue(true)
      const processSpy = jest.spyOn(service, 'processDeliveryEvent').mockResolvedValue(undefined)
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation()

      await service.declineStack(del1, courierId)

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not keep deliveries ${del1Id} and ${del2Id} from being stacked again:`)
      )
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledTimes(2)
      expect(processSpy).toHaveBeenCalledTimes(2)
    })
  })

  // --------------------------------------------------------------------------
  // endOffer on expired/missed stack (reason: 'EXPIRED')
  // --------------------------------------------------------------------------
  describe('endOffer on expired stack (reason: EXPIRED)', () => {
    it('saves stack pair block with 300 s TTL when stackPairBlockMinutes is 5 (not fixed 1200)', async () => {
      mockConfigDomainService.instanceConfig.getStackPairBlockMinutes.mockResolvedValue(5)
      const del1 = makeDelivery(del1Id)
      const del2 = makeDelivery(del2Id)
      mockDeliveryRepo.findById.mockResolvedValueOnce(del1)
      mockDeliveryRepo.findOpenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.updateIfMatches.mockResolvedValue(true)
      jest.spyOn(service, 'processDeliveryEvent').mockResolvedValue(undefined)

      const count = await (service as any).endOffer({
        deliveryId: del1Id,
        courierId,
        offeredAt,
        reason: 'EXPIRED',
        text: 'Offer expired',
      })

      expect(count).toBe(2)
      expect(mockCacheService.save).toHaveBeenCalledWith(pairKey, true, 300)
    })

    it('saves stack pair block with 420 s TTL when stackPairBlockMinutes is 7', async () => {
      mockConfigDomainService.instanceConfig.getStackPairBlockMinutes.mockResolvedValue(7)
      const del1 = makeDelivery(del1Id)
      const del2 = makeDelivery(del2Id)
      mockDeliveryRepo.findById.mockResolvedValueOnce(del1)
      mockDeliveryRepo.findOpenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.updateIfMatches.mockResolvedValue(true)
      jest.spyOn(service, 'processDeliveryEvent').mockResolvedValue(undefined)

      const count = await (service as any).endOffer({
        deliveryId: del1Id,
        courierId,
        offeredAt,
        reason: 'EXPIRED',
        text: 'Offer expired',
      })

      expect(count).toBe(2)
      expect(mockCacheService.save).toHaveBeenCalledWith(pairKey, true, 420)
    })

    it('writes nothing to Redis when stackPairBlockMinutes is 0 on expired stack (decision 147.1)', async () => {
      mockConfigDomainService.instanceConfig.getStackPairBlockMinutes.mockResolvedValue(0)
      const del1 = makeDelivery(del1Id)
      const del2 = makeDelivery(del2Id)
      mockDeliveryRepo.findById.mockResolvedValueOnce(del1)
      mockDeliveryRepo.findOpenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.updateIfMatches.mockResolvedValue(true)
      const processSpy = jest.spyOn(service, 'processDeliveryEvent').mockResolvedValue(undefined)
      const loggerSpy = jest.spyOn((service as any).logger, 'error')

      const count = await (service as any).endOffer({
        deliveryId: del1Id,
        courierId,
        offeredAt,
        reason: 'EXPIRED',
        text: 'Offer expired',
      })

      expect(count).toBe(2)
      const pairBlockCalls = mockCacheService.save.mock.calls.filter(([savedKey]) => savedKey === pairKey)
      expect(pairBlockCalls).toHaveLength(0)
      expect(loggerSpy).not.toHaveBeenCalled()

      expect(processSpy).toHaveBeenCalledTimes(2)
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryId: del1Id, type: EnumDeliveryEventType.OFFER_EXPIRED })
      )
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryId: del2Id, type: EnumDeliveryEventType.OFFER_EXPIRED })
      )
    })

    it('logs error and expiry still goes through when getStackPairBlockMinutes rejects', async () => {
      mockConfigDomainService.instanceConfig.getStackPairBlockMinutes.mockRejectedValue(new Error('Config DB down'))
      const del1 = makeDelivery(del1Id)
      const del2 = makeDelivery(del2Id)
      mockDeliveryRepo.findById.mockResolvedValueOnce(del1)
      mockDeliveryRepo.findOpenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.updateIfMatches.mockResolvedValue(true)
      const processSpy = jest.spyOn(service, 'processDeliveryEvent').mockResolvedValue(undefined)
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation()

      const count = await (service as any).endOffer({
        deliveryId: del1Id,
        courierId,
        offeredAt,
        reason: 'EXPIRED',
        text: 'Offer expired',
      })

      expect(count).toBe(2)
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not keep deliveries ${del1Id} and ${del2Id} from being stacked again:`)
      )
      expect(processSpy).toHaveBeenCalledTimes(2)
    })
  })

  // --------------------------------------------------------------------------
  // Not after Offline or a dispatch stop
  // --------------------------------------------------------------------------
  describe('Not after Offline or a dispatch stop', () => {
    it('does not block stack pair and does not read getter when reason is OFFLINE', async () => {
      const del1 = makeDelivery(del1Id)
      const del2 = makeDelivery(del2Id)
      mockDeliveryRepo.findById.mockResolvedValueOnce(del1)
      mockDeliveryRepo.findOpenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.updateIfMatches.mockResolvedValue(true)
      jest.spyOn(service, 'processDeliveryEvent').mockResolvedValue(undefined)

      await (service as any).endOffer({
        deliveryId: del1Id,
        courierId,
        offeredAt,
        reason: 'OFFLINE',
        text: 'Courier went offline',
      })

      expect(mockConfigDomainService.instanceConfig.getStackPairBlockMinutes).not.toHaveBeenCalled()
      const pairBlockCalls = mockCacheService.save.mock.calls.filter(([savedKey]) => savedKey === pairKey)
      expect(pairBlockCalls).toHaveLength(0)
    })

    it('does not block stack pair and does not read getter when reason is DISPATCH_STOPPED', async () => {
      const del1 = makeDelivery(del1Id)
      const del2 = makeDelivery(del2Id)
      mockDeliveryRepo.findById.mockResolvedValueOnce(del1)
      mockDeliveryRepo.findOpenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.updateIfMatches.mockResolvedValue(true)
      jest.spyOn(service, 'processDeliveryEvent').mockResolvedValue(undefined)

      await (service as any).endOffer({
        deliveryId: del1Id,
        courierId,
        offeredAt,
        reason: 'DISPATCH_STOPPED',
        text: 'Dispatch stopped',
      })

      expect(mockConfigDomainService.instanceConfig.getStackPairBlockMinutes).not.toHaveBeenCalled()
      const pairBlockCalls = mockCacheService.save.mock.calls.filter(([savedKey]) => savedKey === pairKey)
      expect(pairBlockCalls).toHaveLength(0)
    })
  })
})
