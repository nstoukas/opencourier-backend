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
import { OfferPushService } from '../pushNotification/offer-push.service'
import { DispatchStopRepository } from 'src/persistence/repositories/dispatch-stop.repository'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'
import { PartnerChargeRepository } from 'src/persistence/repositories/partner-charge.repository'
import { CantUpdateDeliveryStatusError } from 'src/errors'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DEFAULT_HAND_BACK_SECONDS } from 'src/constants'

describe('DeliveryEventService - Hand Back & Auto Accept (Spec 0020 AC-2, AC-6, AC-7)', () => {
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
  let mockCourierCompensationRepository: any
  let mockPartnerChargeRepository: any

  const deliveryId = 'del-hb-100'
  const courierId = 'courier-hb-1'
  const partnerId = 'partner-hb-1'

  beforeEach(() => {
    mockConfigService = { get: jest.fn() }
    mockWebsocketDispatcher = {
      dispatchDeliveryStatusUpdate: jest.fn(),
      dispatchDeliveryStatusUpdated: jest.fn(),
      dispatchNewDeliveryOffer: jest.fn(),
      sendOfferEnded: jest.fn().mockResolvedValue(undefined),
      dispatchDeliveryUpdate: jest.fn(),
      sendOfferToCourier: jest.fn().mockResolvedValue(undefined),
    }
    mockCourierRepository = {
      findById: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({ id, userId: `user-${id}`, status: EnumCourierStatus.ONLINE })
      ),
      findByIdOrThrow: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({ id, userId: `user-${id}`, status: EnumCourierStatus.ONLINE })
      ),
      updateById: jest.fn().mockResolvedValue(undefined),
    }
    mockDeliveryRepository = {
      findById: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          partnerId,
          matchedCourierId: null,
          courierId: null,
        })
      ),
      findByIdOrThrow: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          partnerId,
          matchedCourierId: null,
          courierId: null,
        })
      ),
      update: jest.fn().mockImplementation((id: string, data: any) =>
        Promise.resolve(
          new DeliveryEntity({
            id,
            partnerId,
            status: data.status ?? EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId: data.courierId ?? null,
            matchedCourierId: data.matchedCourierId ?? null,
            acceptedAt: data.acceptedAt ?? null,
            handBackUntil: data.handBackUntil ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any)
        )
      ),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      findIdsWaitingForCourierOldestFirst: jest.fn().mockResolvedValue([]),
    }
    mockDeliveryEventRepository = {
      create: jest.fn().mockImplementation((event) => Promise.resolve({ id: 'evt-hb-1', ...event })),
      findLatestOfTypes: jest.fn().mockResolvedValue(null),
    }
    mockTaskScheduler = { schedule: jest.fn().mockResolvedValue(undefined) }
    mockTaskBusService = { registerTaskHandler: jest.fn(), scheduleTask: jest.fn().mockResolvedValue(undefined) }
    mockPartnerWebhookService = {
      sendWebhookForEvent: jest.fn().mockResolvedValue(undefined),
      sendDeliveryUpdatePartnerWebhook: jest.fn().mockResolvedValue(undefined),
    }
    mockDeliveryMatchingService = { findCourierForDelivery: jest.fn().mockResolvedValue(null) }
    mockDeliveryCalculationService = {
      calculateDeliveryAmountsForMatchedCourier: jest.fn().mockResolvedValue({
        totalCost: 1000,
        totalCompensation: 800,
        fee: 200,
        feePercentage: 20,
      }),
    }
    mockBullMQService = {
      addJob: jest.fn().mockResolvedValue(undefined),
      addRepeatableJob: jest.fn(),
      removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue(undefined),
    }
    mockConfigDomainService = {
      instanceConfig: {
        getHandBackSeconds: jest.fn().mockResolvedValue(60),
        getOfferExpiryEnabled: jest.fn().mockResolvedValue(false),
        getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
        getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
        getNoCourierRetrySeconds: jest.fn().mockResolvedValue(60),
        getCancellationPayoutPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
      },
    }
    mockCacheService = {
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    }
    mockOfferPushService = {
      newOffer: jest.fn().mockResolvedValue(undefined),
      offerEnded: jest.fn().mockResolvedValue(undefined),
      jobCancelled: jest.fn().mockResolvedValue(undefined),
    }
    mockDispatchStopRepository = {
      findOn: jest.fn().mockResolvedValue(null),
    }
    mockCourierCompensationRepository = {
      create: jest.fn().mockResolvedValue({ id: 'comp-1' }),
    }
    mockPartnerChargeRepository = {
      create: jest.fn().mockResolvedValue({ id: 'charge-1' }),
    }

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
      mockPartnerChargeRepository
    )
  })

  describe('ACCEPTED branch: acceptedAt and handBackUntil (Spec 0020 AC-2)', () => {
    it('writes acceptedAt and handBackUntil = acceptedAt + handBackSeconds inside conditional write', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId,
        courierId: null,
      } as any)
      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId,
        courierId: null,
      } as any)
      mockConfigDomainService.instanceConfig.getHandBackSeconds.mockResolvedValue(120)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
      })

      // Must be written in updateIfMatches
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        expect.objectContaining({
          status: EnumDeliveryStatus.ACCEPTED,
          courierId,
          offerExpiresAt: null,
          acceptedAt: expect.any(Date),
          handBackUntil: expect.any(Date),
        })
      )

      const lastCall = mockDeliveryRepository.updateIfMatches.mock.calls[0]
      const updateData = lastCall[2]
      const acceptedAt = updateData.acceptedAt as Date
      const handBackUntil = updateData.handBackUntil as Date

      expect(handBackUntil.getTime() - acceptedAt.getTime()).toBe(120 * 1000)
    })

    it('acceptedAt is taken after getHandBackSeconds resolves so a slow read does not shorten the window', async () => {
      jest.useFakeTimers()
      try {
        const initialTime = new Date('2026-11-02T12:00:00.000Z')
        jest.setSystemTime(initialTime)
        const readDelayMs = 5000 // 5 seconds simulated latency on config read
        const handBackSeconds = 60

        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
          id: deliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          partnerId,
          courierId: null,
        } as any)
        mockDeliveryRepository.findById.mockResolvedValue({
          id: deliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          partnerId,
          courierId: null,
        } as any)

        // The mocked read advances the fake clock
        mockConfigDomainService.instanceConfig.getHandBackSeconds.mockImplementation(async () => {
          jest.advanceTimersByTime(readDelayMs)
          return handBackSeconds
        })

        await service.processDeliveryEvent({
          deliveryId,
          type: EnumDeliveryEventType.ACCEPTED,
          actor: EnumEventActor.COURIER,
          courierId,
          source: EnumDeliveryEventSource.OPENCOURIER,
        })

        const lastCall = mockDeliveryRepository.updateIfMatches.mock.calls[0]
        const updateData = lastCall[2]
        const acceptedAt = updateData.acceptedAt as Date
        const handBackUntil = updateData.handBackUntil as Date

        const timeAfterRead = new Date(initialTime.getTime() + readDelayMs)
        expect(acceptedAt.getTime()).toBe(timeAfterRead.getTime())
        expect(handBackUntil.getTime()).toBe(timeAfterRead.getTime() + handBackSeconds * 1000)
      } finally {
        jest.useRealTimers()
      }
    })

    it('sets handBackUntil null when handBackSeconds setting is 0 (hand back switched off)', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId,
        courierId: null,
      } as any)
      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId,
        courierId: null,
      } as any)
      mockConfigDomainService.instanceConfig.getHandBackSeconds.mockResolvedValue(0)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
      })

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        expect.objectContaining({
          status: EnumDeliveryStatus.ACCEPTED,
          courierId,
          acceptedAt: expect.any(Date),
          handBackUntil: null,
        })
      )
    })

    it('when getHandBackSeconds throws, still accepts with default 60 seconds and logs warning', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId,
        courierId: null,
      } as any)
      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId,
        courierId: null,
      } as any)
      mockConfigDomainService.instanceConfig.getHandBackSeconds.mockRejectedValue(
        new Error('Redis connection down')
      )

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
      })

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not read handBackSeconds while accepting ${deliveryId}`)
      )

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        expect.objectContaining({
          status: EnumDeliveryStatus.ACCEPTED,
          courierId,
          acceptedAt: expect.any(Date),
          handBackUntil: expect.any(Date),
        })
      )

      const lastCall = mockDeliveryRepository.updateIfMatches.mock.calls[0]
      const updateData = lastCall[2]
      const acceptedAt = updateData.acceptedAt as Date
      const handBackUntil = updateData.handBackUntil as Date

      // Default 60 seconds
      expect(handBackUntil.getTime() - acceptedAt.getTime()).toBe(DEFAULT_HAND_BACK_SECONDS * 1000)

      warnSpy.mockRestore()
    })
  })

  describe('Clearing acceptedAt and handBackUntil (Spec 0020 AC-2)', () => {
    it('REASSIGNED event nulls acceptedAt and handBackUntil in conditional write', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ACCEPTED,
        partnerId,
        courierId,
      } as any)
      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ACCEPTED,
        partnerId,
        courierId,
      } as any)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.REASSIGNED,
        actor: EnumEventActor.ADMIN,
        courierId: 'courier-new-1',
        source: EnumDeliveryEventSource.OPENCOURIER,
      })

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.ACCEPTED, courierId },
        expect.objectContaining({
          courierId: null,
          matchedCourierId: 'courier-new-1',
          acceptedAt: null,
          arrivedAtPickupAt: null,
          handBackUntil: null,
        })
      )
    })

    it('cancelDelivery nulls acceptedAt and handBackUntil in conditional write', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ACCEPTED,
        partnerId,
        courierId,
        totalCost: 1000,
        totalCompensation: 800,
      } as any)
      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ACCEPTED,
        partnerId,
        courierId,
        totalCost: 1000,
        totalCompensation: 800,
      } as any)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.CANCELED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
      })

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.ACCEPTED, courierId },
        expect.objectContaining({
          status: EnumDeliveryStatus.CANCELED,
          acceptedAt: null,
          arrivedAtPickupAt: null,
          handBackUntil: null,
        })
      )
    })
  })

  describe('DeliveryEventService.handBack (Spec 0020 AC-6, AC-7)', () => {
    it('successful handBack: skip list first, ONE updateIfMatches, HANDED_BACK event, notifies partner and rider, offerOrWait runs, no compensation, no charge', async () => {
      const callOrder: string[] = []
      mockCacheService.save.mockImplementation(async () => {
        callOrder.push('cacheService.save')
      })
      mockDeliveryRepository.updateIfMatches.mockImplementation(async () => {
        callOrder.push('updateIfMatches')
        return true
      })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId,
        courierId: null,
      } as any)

      const result = await service.handBack(deliveryId, courierId, EnumDeliveryStatus.ACCEPTED)

      expect(result).toBe(true)

      // 1. Rider goes on skip list BEFORE conditional write
      expect(callOrder[0]).toBe('cacheService.save')
      expect(callOrder[1]).toBe('updateIfMatches')

      // 2. ONE updateIfMatches conditioned on { status: oldStatus, courierId }
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.ACCEPTED, courierId },
        {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          acceptedAt: null,
          arrivedAtPickupAt: null,
          handBackUntil: null,
        }
      )
      expect(mockDeliveryRepository.update).not.toHaveBeenCalled()

      // 3. HANDED_BACK event saved with transitionSuccessful true, courierId, COURIER actor, oldStatus and ASSIGNING_COURIER
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.HANDED_BACK,
          actor: EnumEventActor.COURIER,
          courierId,
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          message: 'Handed back within the free window',
        })
      )

      // 4. Partner and rider notified
      expect(mockWebsocketDispatcher.dispatchDeliveryStatusUpdated).toHaveBeenCalled()

      // 5. offerOrWait runs (straight back to matching)
      expect(mockDeliveryMatchingService.findCourierForDelivery).toHaveBeenCalled()

      // 6. AC-7: No compensation and no partner charge created
      expect(mockCourierCompensationRepository.create).not.toHaveBeenCalled()
      expect(mockPartnerChargeRepository.create).not.toHaveBeenCalled()
    })

    it('when offerOrWait throws (for example recordNoCourierAvailable rejects), handBack still returns true, logs the error, and the HANDED_BACK event was saved', async () => {
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation()
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId,
        courierId: null,
      } as any)

      // Cause offerOrWait to throw: no courier free -> recordNoCourierAvailable rejects
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValue(null)
      jest
        .spyOn(service as any, 'recordNoCourierAvailable')
        .mockRejectedValue(new Error('DB failure recording no courier available'))

      const result = await service.handBack(deliveryId, courierId, EnumDeliveryStatus.ACCEPTED)

      // 1. handBack still returns true (the hand back is done, never answers 500)
      expect(result).toBe(true)

      // 2. The matching failure is logged
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not start matching after delivery ${deliveryId} was handed back`)
      )

      // 3. The HANDED_BACK event was saved
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.HANDED_BACK,
          courierId,
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          message: 'Handed back within the free window',
        })
      )

      errorSpy.mockRestore()
    })

    it('skip list cache failure is logged and hand back still proceeds', async () => {
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation()
      mockCacheService.getOrDefault.mockRejectedValue(new Error('Redis timeout'))
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

      const result = await service.handBack(deliveryId, courierId, EnumDeliveryStatus.DISPATCHED)

      expect(result).toBe(true)
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not put rider ${courierId} on the skip list`)
      )
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalled()

      errorSpy.mockRestore()
    })

    it('missed write (lost race): removes skip list entry, saves failed HANDED_BACK event, notifies nobody, offerOrWait does not run, returns false', async () => {
      mockCacheService.getOrDefault.mockResolvedValue([])
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false) // lost race (e.g. cancelled)

      const result = await service.handBack(deliveryId, courierId, EnumDeliveryStatus.ACCEPTED)

      expect(result).toBe(false)

      // Skip list entry removed
      expect(mockCacheService.save).toHaveBeenLastCalledWith(
        expect.any(String),
        [],
        expect.any(Number)
      )

      // Failed HANDED_BACK event saved
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.HANDED_BACK,
          actor: EnumEventActor.COURIER,
          courierId,
          transitionSuccessful: false,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          newStatus: EnumDeliveryStatus.ACCEPTED,
          message: 'Hand back refused: the order changed first',
        })
      )

      // Tells nobody
      expect(mockWebsocketDispatcher.dispatchDeliveryStatusUpdated).not.toHaveBeenCalled()

      // offerOrWait does not run
      expect(mockDeliveryMatchingService.findCourierForDelivery).not.toHaveBeenCalled()

      // No compensation or charge
      expect(mockCourierCompensationRepository.create).not.toHaveBeenCalled()
      expect(mockPartnerChargeRepository.create).not.toHaveBeenCalled()
    })
  })

  describe('processDeliveryEvent with HANDED_BACK event (Spec 0020 AC-6)', () => {
    it('is refused like RETURNED_TO_WAITING: records a failed transition and does NOT change status', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ACCEPTED,
        courierId,
        partnerId,
      } as any)
      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ACCEPTED,
        courierId,
        partnerId,
      } as any)

      await service.processDeliveryEvent({
        deliveryId,
        type: EnumDeliveryEventType.HANDED_BACK,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
      })

      // Recorded as failed transition in delivery event repository (refused like RETURNED_TO_WAITING)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.HANDED_BACK,
          transitionSuccessful: false,
          message: 'HANDED_BACK is recorded by a rider hand back only',
        })
      )

      // Never updates status through processDeliveryEvent
      expect(mockDeliveryRepository.update).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
    })
  })
})
