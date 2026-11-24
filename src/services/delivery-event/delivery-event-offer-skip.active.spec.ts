import { ConfigService } from '@nestjs/config'
import { EnumDeliveryEventType, EnumDeliveryStatus, EnumEventActor } from '@prisma/types'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { DeliveryEventService } from './delivery-event.service'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { CacheService } from '../cache/cache.service'
import { CacheHelpers } from '../cache/cache.helpers'
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
import { OfferHasEndedException } from 'src/errors'

// Scope row 144, Clause 1:
// A representative edits the skip time on Instance configuration and the next decline uses it, with no deploy:
// the skip list Redis key (delivery-rejected-couriers:<id>) must be saved with the CURRENT offerSkipMinutes * 60
// as its TTL, read at the moment of each add and remove.
// Covers both helpers in rejected-couriers.ts and callers:
// - DeliveryEventService: a rider's decline/reject, an offer that runs out, a stack partner, an add on, hand back, leaveWait, private offerSkipSeconds()
// - DeliveryDomainService: addCourierToRejectedList/removeCourierFromRejectedList wrappers used by admin reassignment and rejectDelivery.
// Tests fail if any of them goes back to a fixed 20 minutes (1200 s) or ignores a changed setting (5 -> 300, 7 -> 420).
describe('Skip list TTL follows offerSkipMinutes co-op setting (row 144, Clause 1)', () => {
  let eventService: DeliveryEventService
  let domainService: DeliveryDomainService

  let mockCacheService: { getOrDefault: jest.Mock; save: jest.Mock; delete: jest.Mock }
  let mockConfigDomainService: { instanceConfig: { getOfferSkipMinutes: jest.Mock; [k: string]: any } }
  let mockDeliveryRepository: any
  let mockCourierRepository: any
  let mockCourierCompensationRepository: any
  let mockPartnerChargeRepository: any
  let mockRemovalRequestRepository: any
  let mockDeliveryEventRepository: any
  let mockWebsocketDispatcher: any

  const deliveryId = 'del-skip-1'
  const courierId = 'courier-1'
  const key = CacheHelpers.getDeliveryRejectedCouriersKey(deliveryId)

  beforeEach(() => {
    mockCacheService = {
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    }

    mockConfigDomainService = {
      instanceConfig: {
        getOfferSkipMinutes: jest.fn().mockResolvedValue(20),
        getStackPairBlockMinutes: jest.fn().mockResolvedValue(20),
        getOfferExpiryEnabled: jest.fn().mockResolvedValue(true),
        getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
        getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
        getNoCourierRetrySeconds: jest.fn().mockResolvedValue(30),
        getHandBackSeconds: jest.fn().mockResolvedValue(60),
        getWaitPayEnabled: jest.fn().mockResolvedValue(false),
        getWaitLimitMinutes: jest.fn().mockResolvedValue(10),
        getWaitPayFreeMinutes: jest.fn().mockResolvedValue(5),
        getWaitPayCentsPerMinute: jest.fn().mockResolvedValue(10),
        getCancellationPayoutPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
        getReassignmentPayoutPolicies: jest.fn().mockResolvedValue({ FULL_COMPENSATION: 100 }),
        getReassignmentPayoutDefaultPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
        getBoxDefaultSize: jest.fn().mockResolvedValue('MEDIUM'),
        getBoxUnitsSmall: jest.fn().mockResolvedValue(30),
        getBoxUnitsMedium: jest.fn().mockResolvedValue(50),
        getBoxUnitsLarge: jest.fn().mockResolvedValue(100),
      },
    }

    mockDeliveryRepository = {
      findById: jest.fn().mockResolvedValue(null),
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt: new Date(),
        offerExpiresAt: new Date(Date.now() + 60000),
        offerGroupId: null,
        stopSequence: null,
        totalCompensation: 500,
        currencyCode: 'EUR',
        pickupReadyAt: new Date(),
      }),
      update: jest.fn().mockImplementation((id, data) => Promise.resolve({ id, ...data })),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      claimOfferWithinBox: jest.fn().mockResolvedValue('CLAIMED'),
      claimForRiderWithinBox: jest.fn().mockResolvedValue({ outcome: 'CLAIMED', heldUnits: 0, deliveryUnits: 50 }),
      findOpenOffersForCourier: jest.fn().mockResolvedValue([]),
      findIdsWaitingForCourierOldestFirst: jest.fn().mockResolvedValue([]),
      findLatestNoCourierAvailableAt: jest.fn().mockResolvedValue(new Map()),
      holdsSiblingLeg: jest.fn().mockResolvedValue(false),
      findOpenGroupMembers: jest.fn().mockResolvedValue([]),
    }

    mockCourierRepository = {
      findById: jest.fn().mockResolvedValue({ id: courierId, userId: 'user-courier-1' }),
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: courierId, userId: 'user-courier-1' }),
      updateById: jest.fn().mockResolvedValue({}),
      changeStatus: jest.fn().mockResolvedValue({}),
      findNamesByIds: jest.fn().mockResolvedValue(new Map()),
      hasActiveSos: jest.fn().mockResolvedValue(false),
      heldBoxUnits: jest.fn().mockResolvedValue(0),
      liveDeliveryCount: jest.fn().mockResolvedValue(0),
      clearLocationIfOfflineAndFree: jest.fn().mockResolvedValue(undefined),
    }

    mockCourierCompensationRepository = {
      create: jest.fn().mockResolvedValue({ id: 'comp-1' }),
      deleteById: jest.fn().mockResolvedValue(undefined),
    }

    mockPartnerChargeRepository = {
      create: jest.fn().mockResolvedValue({ id: 'charge-1' }),
    }

    mockRemovalRequestRepository = {
      closeOpenForDelivery: jest.fn().mockResolvedValue(undefined),
    }

    mockDeliveryEventRepository = {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      findLatestOfTypes: jest.fn().mockResolvedValue(null),
      hasSuccessfulReassignedWithMessage: jest.fn().mockResolvedValue(true),
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

    eventService = new DeliveryEventService(
      { get: jest.fn() } as unknown as ConfigService,
      mockWebsocketDispatcher as unknown as WebsocketDispatcher,
      mockCourierRepository as unknown as CourierRepository,
      mockDeliveryRepository as unknown as DeliveryRepository,
      mockDeliveryEventRepository as unknown as DeliveryEventRepository,
      { scheduleTask: jest.fn() } as unknown as TaskBusScheduler,
      { registerTaskHandler: jest.fn() } as unknown as TaskBusService,
      { sendDeliveryUpdatePartnerWebhook: jest.fn() } as unknown as PartnerWebhookService,
      { findCourierForDelivery: jest.fn(), matchDeliveryToCourier: jest.fn() } as unknown as DeliveryMatchingService,
      {
        calculateDeliveryAmountsForMatchedCourier: jest
          .fn()
          .mockResolvedValue({ totalCost: 600, totalCompensation: 500, fee: 100, feePercentage: 20 }),
      } as unknown as DeliveryCalculationService,
      mockBullMQService as unknown as BullMQService,
      mockConfigDomainService as any,
      mockCacheService as unknown as CacheService,
      { newOffer: jest.fn(), offerEnded: jest.fn(), jobCancelled: jest.fn() } as unknown as OfferPushService,
      { findOn: jest.fn().mockResolvedValue(null) } as unknown as DispatchStopRepository,
      { getRoute: jest.fn() } as unknown as OsrmRoutingService,
      mockCourierCompensationRepository as unknown as CourierCompensationRepository,
      mockPartnerChargeRepository as unknown as PartnerChargeRepository,
      mockRemovalRequestRepository as unknown as RemovalRequestRepository
    )

    domainService = new DeliveryDomainService(
      mockDeliveryRepository as unknown as DeliveryRepository,
      { emit: jest.fn() } as unknown as EventEmitter2,
      mockCacheService as unknown as CacheService,
      eventService,
      mockCourierRepository as unknown as CourierRepository,
      mockCourierCompensationRepository as unknown as CourierCompensationRepository,
      mockConfigDomainService as any,
      { findById: jest.fn().mockResolvedValue(null) } as any
    )
  })

  describe('DeliveryEventService', () => {
    describe('private offerSkipSeconds()', () => {
      it('returns 300 s when offerSkipMinutes is 5', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(5)
        const seconds = await (eventService as any).offerSkipSeconds()
        expect(seconds).toBe(300)
      })

      it('returns 420 s when offerSkipMinutes is 7', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(7)
        const seconds = await (eventService as any).offerSkipSeconds()
        expect(seconds).toBe(420)
      })
    })

    describe('an offer that runs out (endOffer)', () => {
      it('saves to skip list with 300 s TTL when offerSkipMinutes is 5 (not fixed 1200)', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(5)

        await (eventService as any).endOffer({ deliveryId, courierId, reason: 'EXPIRED' })

        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 300)
      })

      it('saves to skip list with 420 s TTL when offerSkipMinutes is 7', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(7)

        await (eventService as any).endOffer({ deliveryId, courierId, reason: 'EXPIRED' })

        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 420)
      })

      it('undoes skip list entry by deleting key when last courier comes off in undoSkipListEntry', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(5)
        mockCacheService.getOrDefault.mockResolvedValueOnce([courierId])

        await (eventService as any).undoSkipListEntry(deliveryId, courierId)

        expect(mockCacheService.delete).toHaveBeenCalledWith(key)
        expect(mockCacheService.save).not.toHaveBeenCalled()
      })
    })

    describe('a stack partner decline (declineStack)', () => {
      it('saves stack partner delivery with 300 s TTL when offerSkipMinutes is 5', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(5)

        const partnerDeliveryId = 'del-stack-partner'
        const partnerKey = CacheHelpers.getDeliveryRejectedCouriersKey(partnerDeliveryId)

        const offeredAt = new Date()
        const deliveryWithStack: any = {
          id: deliveryId,
          offerGroupId: 'group-1',
          offeredAt,
        }
        const partnerDelivery: any = {
          id: partnerDeliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: courierId,
          offerGroupId: 'group-1',
          offeredAt,
        }

        mockDeliveryRepository.findOpenGroupMembers.mockResolvedValueOnce([deliveryWithStack, partnerDelivery])

        await eventService.declineStack(deliveryWithStack, courierId)

        expect(mockCacheService.save).toHaveBeenCalledWith(partnerKey, [courierId], 300)
      })

      it('saves stack partner delivery with 420 s TTL when offerSkipMinutes is 7', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(7)

        const partnerDeliveryId = 'del-stack-partner'
        const partnerKey = CacheHelpers.getDeliveryRejectedCouriersKey(partnerDeliveryId)

        const offeredAt = new Date()
        const deliveryWithStack: any = {
          id: deliveryId,
          offerGroupId: 'group-1',
          offeredAt,
        }
        const partnerDelivery: any = {
          id: partnerDeliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: courierId,
          offerGroupId: 'group-1',
          offeredAt,
        }

        mockDeliveryRepository.findOpenGroupMembers.mockResolvedValueOnce([deliveryWithStack, partnerDelivery])

        await eventService.declineStack(deliveryWithStack, courierId)

        expect(mockCacheService.save).toHaveBeenCalledWith(partnerKey, [courierId], 420)
      })
    })

    describe('handBack', () => {
      it('adds to skip list with 300 s TTL when setting is 5 min, and undoes on update miss', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(5)
        mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)

        await eventService.handBack(deliveryId, courierId, EnumDeliveryStatus.ACCEPTED)

        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 300)
        expect(mockCacheService.delete).toHaveBeenCalledWith(key)
      })

      it('adds with 420 s TTL when setting is 7 min', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(7)
        mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

        await eventService.handBack(deliveryId, courierId, EnumDeliveryStatus.ACCEPTED)

        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 420)
      })
    })

    describe('leaveWait', () => {
      it('adds to skip list with 300 s TTL when setting is 5 min, and undoes on update miss', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(5)
        mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)

        const delivery: any = { id: deliveryId, status: EnumDeliveryStatus.ON_THE_WAY }
        await eventService.leaveWait(delivery, courierId, new Date())

        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 300)
        expect(mockCacheService.delete).toHaveBeenCalledWith(key)
      })

      it('adds with 420 s TTL when setting is 7 min', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(7)
        mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

        const delivery: any = { id: deliveryId, status: EnumDeliveryStatus.ON_THE_WAY }
        await eventService.leaveWait(delivery, courierId, new Date())

        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 420)
      })
    })

    describe('removeRiderBeforePickup', () => {
      it('adds rider to skip list with 300 s TTL when setting is 5 min', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(5)
        const delivery: any = { id: deliveryId, status: EnumDeliveryStatus.ACCEPTED }

        await eventService.removeRiderBeforePickup(delivery, courierId, 'Emergency')

        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 300)
      })

      it('adds rider to skip list with 420 s TTL when setting is 7 min', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(7)
        const delivery: any = { id: deliveryId, status: EnumDeliveryStatus.ACCEPTED }

        await eventService.removeRiderBeforePickup(delivery, courierId, 'Emergency')

        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 420)
      })
    })
  })

  describe('DeliveryDomainService', () => {
    describe('private offerSkipSeconds()', () => {
      it('returns 300 s when offerSkipMinutes is 5', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(5)
        const seconds = await (domainService as any).offerSkipSeconds()
        expect(seconds).toBe(300)
      })

      it('returns 420 s when offerSkipMinutes is 7', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(7)
        const seconds = await (domainService as any).offerSkipSeconds()
        expect(seconds).toBe(420)
      })
    })

    describe('addCourierToRejectedList wrapper', () => {
      it('passes 300 s to cache helper when setting is 5 min (not fixed 1200)', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(5)

        const added = await domainService.addCourierToRejectedList(deliveryId, courierId)

        expect(added).toBe(true)
        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 300)
      })

      it('passes 420 s to cache helper when setting is 7 min', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(7)

        const added = await domainService.addCourierToRejectedList(deliveryId, courierId)

        expect(added).toBe(true)
        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 420)
      })
    })

    describe('removeCourierFromRejectedList wrapper', () => {
      it('passes 300 s to cache helper when setting is 5 min', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(5)
        mockCacheService.getOrDefault.mockResolvedValueOnce([courierId, 'courier-2'])

        await domainService.removeCourierFromRejectedList(deliveryId, courierId)

        expect(mockCacheService.save).toHaveBeenCalledWith(key, ['courier-2'], 300)
      })

      it('passes 420 s to cache helper when setting is 7 min', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(7)
        mockCacheService.getOrDefault.mockResolvedValueOnce([courierId, 'courier-2'])

        await domainService.removeCourierFromRejectedList(deliveryId, courierId)

        expect(mockCacheService.save).toHaveBeenCalledWith(key, ['courier-2'], 420)
      })
    })

    describe('a rider decline/reject (rejectDelivery)', () => {
      it('adds with 300 s when setting is 5 min, and undoes on update miss', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(5)
        mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)

        await expect(domainService.rejectDelivery(deliveryId, courierId)).rejects.toThrow()

        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 300)
        expect(mockCacheService.delete).toHaveBeenCalledWith(key)
      })

      it('adds with 420 s when setting is 7 min (not fixed 1200)', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(7)
        mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

        await domainService.rejectDelivery(deliveryId, courierId)

        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 420)
      })
    })

    describe('admin reassignment (reassignDelivery)', () => {
      it('puts dropped rider on skip list with 300 s TTL when offerSkipMinutes is 5', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(5)

        const initialDelivery = {
          id: deliveryId,
          status: EnumDeliveryStatus.PICKED_UP,
          courierId: courierId,
          totalCompensation: 500,
          currencyCode: 'EUR',
        }
        const updatedDelivery = {
          ...initialDelivery,
          courierId: 'courier-new',
        }
        mockDeliveryRepository.findByIdOrThrow
          .mockResolvedValueOnce(initialDelivery)
          .mockResolvedValueOnce(updatedDelivery)

        await domainService.reassignDelivery(deliveryId, 'courier-new')

        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 300)
      })

      it('puts dropped rider on skip list with 420 s TTL when offerSkipMinutes is 7', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(7)

        const initialDelivery = {
          id: deliveryId,
          status: EnumDeliveryStatus.PICKED_UP,
          courierId: courierId,
          totalCompensation: 500,
          currencyCode: 'EUR',
        }
        const updatedDelivery = {
          ...initialDelivery,
          courierId: 'courier-new',
        }
        mockDeliveryRepository.findByIdOrThrow
          .mockResolvedValueOnce(initialDelivery)
          .mockResolvedValueOnce(updatedDelivery)

        await domainService.reassignDelivery(deliveryId, 'courier-new')

        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 420)
      })

      it('rolls back dropped rider from skip list when reassignment did not take effect', async () => {
        mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(5)
        mockDeliveryEventRepository.hasSuccessfulReassignedWithMessage.mockResolvedValue(false)

        const initialDelivery = {
          id: deliveryId,
          status: EnumDeliveryStatus.PICKED_UP,
          courierId: courierId,
          totalCompensation: 500,
          currencyCode: 'EUR',
        }
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(initialDelivery)

        await expect(domainService.reassignDelivery(deliveryId, 'courier-new')).rejects.toThrow()

        expect(mockCacheService.save).toHaveBeenCalledWith(key, [courierId], 300)
        expect(mockCacheService.delete).toHaveBeenCalledWith(key)
      })
    })
  })

  // --------------------------------------------------------------------------
  // Minor 1: DeliveryDomainService.rejectDelivery undo failure handling
  // --------------------------------------------------------------------------
  describe('Minor 1: DeliveryDomainService.rejectDelivery undo failures never replace original error', () => {
    it('throws the original database error and logs undo failure when updateIfMatches throws and undo fails (setting read rejects)', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes
        .mockResolvedValueOnce(20) // initial addCourierToRejectedList succeeds
        .mockRejectedValueOnce(new Error('Config service unreachable on undo')) // undo rejects
      mockDeliveryRepository.updateIfMatches.mockRejectedValueOnce(new Error('Postgres connection lost'))
      const loggerSpy = jest.spyOn((domainService as any).logger, 'error').mockImplementation()

      await expect(domainService.rejectDelivery(deliveryId, courierId)).rejects.toThrow('Postgres connection lost')

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not take courier ${courierId} back off the skip list of ${deliveryId}`)
      )
    })

    it('throws the original database error and logs undo failure when updateIfMatches throws and undo fails (cache delete rejects)', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(20)
      mockCacheService.save.mockResolvedValueOnce(undefined) // add succeeds
      mockCacheService.delete.mockRejectedValueOnce(new Error('Redis connection down on undo')) // undo delete fails
      mockDeliveryRepository.updateIfMatches.mockRejectedValueOnce(new Error('Postgres connection lost'))
      const loggerSpy = jest.spyOn((domainService as any).logger, 'error').mockImplementation()

      await expect(domainService.rejectDelivery(deliveryId, courierId)).rejects.toThrow('Postgres connection lost')

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not take courier ${courierId} back off the skip list of ${deliveryId}`)
      )
    })

    it('throws OfferHasEndedException and logs undo failure when updateIfMatches returns false and undo fails (setting read rejects)', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes
        .mockResolvedValueOnce(20) // add succeeds
        .mockRejectedValueOnce(new Error('Config service unreachable on undo')) // undo rejects
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(false)
      const loggerSpy = jest.spyOn((domainService as any).logger, 'error').mockImplementation()

      await expect(domainService.rejectDelivery(deliveryId, courierId)).rejects.toThrow(OfferHasEndedException)

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not take courier ${courierId} back off the skip list of ${deliveryId}`)
      )
    })

    it('throws OfferHasEndedException and logs undo failure when updateIfMatches returns false and undo fails (cache delete rejects)', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(20)
      mockCacheService.save.mockResolvedValueOnce(undefined) // add succeeds
      mockCacheService.delete.mockRejectedValueOnce(new Error('Redis connection down on undo')) // undo delete fails
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(false)
      const loggerSpy = jest.spyOn((domainService as any).logger, 'error').mockImplementation()

      await expect(domainService.rejectDelivery(deliveryId, courierId)).rejects.toThrow(OfferHasEndedException)

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not take courier ${courierId} back off the skip list of ${deliveryId}`)
      )
    })
  })

  // --------------------------------------------------------------------------
  // Minor 6: Failed setting read must not stop the rider's or system's action
  // --------------------------------------------------------------------------
  describe('Minor 6: failed offerSkipMinutes read does not block rider or system actions', () => {
    it('rider decline (rejectDelivery) still declines, logs error, and leaves no skip entry when getOfferSkipMinutes rejects', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockRejectedValue(new Error('Config DB down'))
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)
      const loggerSpy = jest.spyOn((domainService as any).logger, 'error').mockImplementation()

      await domainService.rejectDelivery(deliveryId, courierId)

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalled()
      expect(mockCacheService.save).not.toHaveBeenCalled()
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not add courier ${courierId} to the skip list of ${deliveryId}`)
      )
    })

    it('offer expiry (endOffer) still ends the offer, logs error, and leaves no skip entry when getOfferSkipMinutes rejects', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockRejectedValue(new Error('Config DB down'))
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)
      const loggerSpy = jest.spyOn((eventService as any).logger, 'error').mockImplementation()

      const count = await (eventService as any).endOffer({ deliveryId, courierId, reason: 'EXPIRED' })

      expect(count).toBe(1)
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalled()
      expect(mockCacheService.save).not.toHaveBeenCalled()
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not add courier ${courierId} to the skip list of ${deliveryId}`)
      )
    })

    it('hand back (handBack) still goes through, logs error, and leaves no skip entry when getOfferSkipMinutes rejects', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockRejectedValue(new Error('Config DB down'))
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)
      const loggerSpy = jest.spyOn((eventService as any).logger, 'error').mockImplementation()

      const success = await eventService.handBack(deliveryId, courierId, EnumDeliveryStatus.ACCEPTED)

      expect(success).toBe(true)
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalled()
      expect(mockCacheService.save).not.toHaveBeenCalled()
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not put rider ${courierId} on the skip list of delivery ${deliveryId}`)
      )
    })

    it('leave wait (leaveWait) still goes through, logs error, and leaves no skip entry when getOfferSkipMinutes rejects', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockRejectedValue(new Error('Config DB down'))
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)
      const loggerSpy = jest.spyOn((eventService as any).logger, 'error').mockImplementation()

      const delivery: any = { id: deliveryId, status: EnumDeliveryStatus.ON_THE_WAY }
      const success = await eventService.leaveWait(delivery, courierId, new Date())

      expect(success).toBe(true)
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalled()
      expect(mockCacheService.save).not.toHaveBeenCalled()
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not put rider ${courierId} on the skip list of delivery ${deliveryId}`)
      )
    })

    it('removal before pickup (removeRiderBeforePickup) still goes through, logs error, and leaves no skip entry when getOfferSkipMinutes rejects', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockRejectedValue(new Error('Config DB down'))
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)
      const loggerSpy = jest.spyOn((eventService as any).logger, 'error').mockImplementation()

      const delivery: any = { id: deliveryId, status: EnumDeliveryStatus.ACCEPTED }
      const result = await eventService.removeRiderBeforePickup(delivery, courierId, 'Emergency')

      expect(result).toBeDefined()
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalled()
      expect(mockCacheService.save).not.toHaveBeenCalled()
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not put rider ${courierId} on the skip list of delivery ${deliveryId}`)
      )
    })

    it('stack decline (declineStack) still declines both deliveries, logs error, and leaves no skip entry when getOfferSkipMinutes rejects (Review test gap 1)', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockRejectedValue(new Error('Config DB down'))
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)
      const loggerSpy = jest.spyOn((eventService as any).logger, 'error').mockImplementation()

      const partnerDeliveryId = 'del-stack-partner'
      const offeredAt = new Date()
      const deliveryWithStack: any = {
        id: deliveryId,
        offerGroupId: 'group-1',
        offeredAt,
      }
      const partnerDelivery: any = {
        id: partnerDeliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offerGroupId: 'group-1',
        offeredAt,
      }

      mockDeliveryRepository.findOpenGroupMembers.mockResolvedValueOnce([deliveryWithStack, partnerDelivery])

      await eventService.declineStack(deliveryWithStack, courierId)

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledTimes(2)
      expect(mockCacheService.save).not.toHaveBeenCalledWith(
        expect.stringContaining('delivery-rejected-couriers'),
        expect.anything(),
        expect.anything()
      )
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not add courier ${courierId} to the skip list of ${deliveryId}`)
      )
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not add courier ${courierId} to the skip list of ${partnerDeliveryId}`)
      )
    })

    it('admin reassignment (reassignDelivery) rolls back award and rethrows when getOfferSkipMinutes rejects during add (Review test gap 2)', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockRejectedValue(new Error('Config DB down'))
      const rollbackSpy = jest.spyOn(domainService as any, 'rollbackReassignmentAward')

      const initialDelivery = {
        id: deliveryId,
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: courierId,
        totalCompensation: 500,
        currencyCode: 'EUR',
      }
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(initialDelivery)

      await expect(domainService.reassignDelivery(deliveryId, 'courier-new')).rejects.toThrow('Config DB down')

      expect(rollbackSpy).toHaveBeenCalledWith('comp-1', 'REASSIGNMENT_DID_NOT_TAKE_EFFECT', expect.anything(), false)
      expect(mockCourierCompensationRepository.deleteById).toHaveBeenCalledWith('comp-1')
    })
  })

  // --------------------------------------------------------------------------
  // handBack and leaveWait: undo failure resilience with shared helper message
  // --------------------------------------------------------------------------
  describe('handBack and leaveWait: undo failure resilience with shared helper message', () => {
    it('handBack completes and logs with shared message when undo fails (setting read rejects)', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes
        .mockResolvedValueOnce(20)
        .mockRejectedValueOnce(new Error('Config DB down on undo'))
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)
      const loggerSpy = jest.spyOn((eventService as any).logger, 'error').mockImplementation()

      const result = await eventService.handBack(deliveryId, courierId, EnumDeliveryStatus.ACCEPTED)

      expect(result).toBe(false)
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not take courier ${courierId} off the skip list of ${deliveryId}`)
      )
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.HANDED_BACK,
          transitionSuccessful: false,
        })
      )
    })

    it('handBack completes and logs with shared message when undo fails (cache delete rejects)', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(20)
      mockCacheService.delete.mockRejectedValueOnce(new Error('Redis delete error on undo'))
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)
      const loggerSpy = jest.spyOn((eventService as any).logger, 'error').mockImplementation()

      const result = await eventService.handBack(deliveryId, courierId, EnumDeliveryStatus.ACCEPTED)

      expect(result).toBe(false)
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not take courier ${courierId} off the skip list of ${deliveryId}`)
      )
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.HANDED_BACK,
          transitionSuccessful: false,
        })
      )
    })

    it('leaveWait completes and logs with shared message when undo fails (setting read rejects)', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes
        .mockResolvedValueOnce(20)
        .mockRejectedValueOnce(new Error('Config DB down on undo'))
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)
      const loggerSpy = jest.spyOn((eventService as any).logger, 'error').mockImplementation()

      const delivery: any = { id: deliveryId, status: EnumDeliveryStatus.ON_THE_WAY }
      const result = await eventService.leaveWait(delivery, courierId, new Date())

      expect(result).toBe(false)
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not take courier ${courierId} off the skip list of ${deliveryId}`)
      )
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
          transitionSuccessful: false,
        })
      )
    })

    it('leaveWait completes and logs with shared message when undo fails (cache delete rejects)', async () => {
      mockConfigDomainService.instanceConfig.getOfferSkipMinutes.mockResolvedValue(20)
      mockCacheService.delete.mockRejectedValueOnce(new Error('Redis delete error on undo'))
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)
      const loggerSpy = jest.spyOn((eventService as any).logger, 'error').mockImplementation()

      const delivery: any = { id: deliveryId, status: EnumDeliveryStatus.ON_THE_WAY }
      const result = await eventService.leaveWait(delivery, courierId, new Date())

      expect(result).toBe(false)
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not take courier ${courierId} off the skip list of ${deliveryId}`)
      )
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
          transitionSuccessful: false,
        })
      )
    })
  })
})
