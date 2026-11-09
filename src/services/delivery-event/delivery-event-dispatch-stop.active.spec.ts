import { ConfigService } from '@nestjs/config'
import {
  DispatchStop,
  EnumDeliveryEventSource,
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
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { CacheService } from '../cache/cache.service'
import { OfferPushService } from '../pushNotification/offer-push.service'
import { DispatchStopRepository } from 'src/persistence/repositories/dispatch-stop.repository'
import { CantUpdateDeliveryStatusError } from 'src/errors'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { dayjs } from 'src/core/utils/time'
import { INSTANCE_TIMEZONE } from 'src/constants'

describe('DeliveryEventService - Dispatch Stop (Spec 0014, AC-4, AC-5)', () => {
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

  // Same-day stop in Athens ending at 17:00 Athens
  const today17Athens = dayjs().tz(INSTANCE_TIMEZONE).hour(17).minute(0).second(0).millisecond(0).toDate()
  const todayStartAthens = dayjs().tz(INSTANCE_TIMEZONE).hour(12).minute(0).second(0).millisecond(0).toDate()

  const activeStop: DispatchStop = {
    id: 'stop-heat-1',
    reason: EnumDispatchStopReason.HEAT,
    startsAt: todayStartAthens,
    endsAt: today17Athens,
    startedAt: todayStartAthens,
    endedAt: null,
    cancelledAt: null,
    createdByUserId: 'admin-1',
    createdAt: todayStartAthens,
    endedByUserId: null,
    cancelledByUserId: null,
    endWorkDoneAt: null,
  }

  beforeEach(() => {
    mockConfigService = { get: jest.fn() }
    mockWebsocketDispatcher = {
      dispatchDeliveryStatusUpdate: jest.fn(),
      dispatchDeliveryStatusUpdated: jest.fn(),
      dispatchNewDeliveryOffer: jest.fn(),
      sendOfferEnded: jest.fn().mockResolvedValue(undefined),
      dispatchDeliveryUpdate: jest.fn(),
    }
    mockCourierRepository = {
      findById: jest.fn().mockImplementation((id: string) => Promise.resolve({ id, userId: `user-${id}` })),
      findByIdOrThrow: jest.fn().mockImplementation((id: string) => Promise.resolve({ id, userId: `user-${id}` })),
      findUnique: jest.fn(),
      hasActiveSos: jest.fn().mockResolvedValue(false),
    }
    mockDeliveryRepository = {
      findById: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          partnerId: 'partner-1',
          matchedCourierId: null,
          courierId: null,
        })
      ),
      findByIdOrThrow: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          partnerId: 'partner-1',
          matchedCourierId: null,
          courierId: null,
        })
      ),
      update: jest.fn().mockImplementation((id: string, data: any) =>
        Promise.resolve(
          new DeliveryEntity({
            id,
            partnerId: 'partner-1',
            status: data.status ?? EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId: data.courierId ?? null,
            matchedCourierId: data.matchedCourierId ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any)
        )
      ),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      findAllOpenOffers: jest.fn().mockResolvedValue([]),
      findAllHeldBeforePickup: jest.fn().mockResolvedValue([]),
      findIdsWaitingForCourierOldestFirst: jest.fn().mockResolvedValue([]),
    }
    mockDeliveryEventRepository = {
      create: jest.fn().mockImplementation((event) => Promise.resolve({ id: 'evt-1', ...event })),
      findLatestOfTypes: jest.fn().mockResolvedValue(null),
    }
    mockTaskScheduler = {
      schedule: jest.fn().mockResolvedValue(undefined),
    }
    mockTaskBusService = {
      registerTaskHandler: jest.fn(),
      scheduleTask: jest.fn().mockResolvedValue(undefined),
    }
    mockPartnerWebhookService = {
      sendWebhookForEvent: jest.fn().mockResolvedValue(undefined),
      sendDeliveryUpdatePartnerWebhook: jest.fn().mockResolvedValue(undefined),
    }
    mockDeliveryMatchingService = {
      findCourierForDelivery: jest.fn(),
    }
    mockDeliveryCalculationService = {
      calculateDeliveryAmountsForMatchedCourier: jest.fn(),
    }
    mockBullMQService = {
      addJob: jest.fn().mockResolvedValue(undefined),
      addRepeatableJob: jest.fn(),
      removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue(undefined),
    }
    mockConfigDomainService = {
      instanceConfig: {
        getOfferExpiryEnabled: jest.fn().mockResolvedValue(false),
        getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
        getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
        getNoCourierRetrySeconds: jest.fn().mockResolvedValue(60),
      },
    }
    mockCacheService = {
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    }
    mockOfferPushService = {
      newOffer: jest.fn().mockResolvedValue(undefined),
      offerEnded: jest.fn().mockResolvedValue(undefined),
    }
    mockDispatchStopRepository = {
      findOn: jest.fn().mockResolvedValue(null),
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
      {} as any,
      {} as any
    )
  })

  describe('AC-4: Gate in offerToNextCourier and its callers while a stop is on', () => {
    test('while findOn returns a stop, offerToNextCourier makes no offer (matcher is not called) and returns STOPPED', async () => {
      mockDispatchStopRepository.findOn.mockResolvedValue(activeStop)

      // When a CREATED event is processed, it transitions to ASSIGNING_COURIER and calls offerOrWait
      const delivery = {
        id: 'del-gate-1',
        status: EnumDeliveryStatus.CREATED,
        matchedCourierId: null,
        courierId: null,
        partnerId: 'partner-1',
      }
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.findById.mockResolvedValue(delivery)

      await service.processDeliveryEvent({
        deliveryId: 'del-gate-1',
        type: EnumDeliveryEventType.CREATED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
      })

      // The matcher was NEVER called because the gate returned 'STOPPED'
      expect(mockDeliveryMatchingService.findCourierForDelivery).not.toHaveBeenCalled()
      // offerOrWait recorded no NO_COURIER_AVAILABLE and scheduled no retry
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.NO_COURIER_AVAILABLE })
      )
      expect(mockTaskBusService.scheduleTask).not.toHaveBeenCalledWith('no-courier-retry', expect.anything(), expect.anything())
    })

    test('backstop retry job does not reschedule when gate returns STOPPED', async () => {
      mockDispatchStopRepository.findOn.mockResolvedValue(activeStop)
      mockDeliveryRepository.findById.mockResolvedValue({
        id: 'del-backstop',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      })

      await service.handleNoCourierRetryJob({ deliveryId: 'del-backstop' })

      expect(mockDeliveryMatchingService.findCourierForDelivery).not.toHaveBeenCalled()
      expect(mockTaskBusService.scheduleTask).not.toHaveBeenCalled()
    })

    test('matchWaitingDeliveries stops and makes no offer when dispatch is stopped', async () => {
      mockDispatchStopRepository.findOn.mockResolvedValue(activeStop)
      mockDeliveryRepository.findIdsWaitingForCourierOldestFirst.mockResolvedValue(['del-wait-1', 'del-wait-2'])

      await service.matchWaitingDeliveries()

      expect(mockDeliveryMatchingService.findCourierForDelivery).not.toHaveBeenCalled()
    })

    test('offerWaitingDeliveryNow throws 409 CantUpdateDeliveryStatusError naming the end time', async () => {
      mockDispatchStopRepository.findOn.mockResolvedValue(activeStop)
      mockDeliveryRepository.findById.mockResolvedValue({
        id: 'del-test-1',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      })

      await expect(service.offerWaitingDeliveryNow('del-test-1')).rejects.toThrow(CantUpdateDeliveryStatusError)
      await expect(service.offerWaitingDeliveryNow('del-test-1')).rejects.toThrow('Dispatch is stopped until 17:00.')
    })

    test('offerDeliveryToCourierAsAdmin throws 409 CantUpdateDeliveryStatusError naming the end time', async () => {
      mockDispatchStopRepository.findOn.mockResolvedValue(activeStop)

      await expect(
        service.offerDeliveryToCourierAsAdmin('del-admin-1', 'courier-1')
      ).rejects.toThrow(CantUpdateDeliveryStatusError)
      await expect(
        service.offerDeliveryToCourierAsAdmin('del-admin-1', 'courier-1')
      ).rejects.toThrow('Dispatch is stopped until 17:00.')
    })

    test('offerToNextCourier checks for a stop again AFTER claiming the delivery, takes claim back, saves no OFFERED event, and returns STOPPED (AC-4)', async () => {
      // Gate check 1 (before matching): null
      // Gate check 2 (after claim): activeStop
      mockDispatchStopRepository.findOn
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(activeStop)

      const matchedCourier = { id: 'courier-race', userId: 'user-courier-race' }
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValue({
        courier: matchedCourier,
        distanceMeters: 500,
      })
      mockDeliveryCalculationService.calculateDeliveryAmountsForMatchedCourier.mockResolvedValue({
        totalCost: 1000,
        totalCompensation: 800,
        fee: 200,
        feePercentage: 20,
      })
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

      const result = await (service as any).offerToNextCourier('del-race-1')

      expect(result).toBe('STOPPED')
      // Both gate checks happened
      expect(mockDispatchStopRepository.findOn).toHaveBeenCalledTimes(2)
      // First updateIfMatches claimed the delivery
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenNthCalledWith(
        1,
        'del-race-1',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: null, courierId: null },
        expect.objectContaining({ matchedCourierId: 'courier-race' })
      )
      // Second updateIfMatches took the claim back on the exact claim written
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenNthCalledWith(
        2,
        'del-race-1',
        expect.objectContaining({
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: 'courier-race',
          courierId: null,
        }),
        { matchedCourierId: null, offeredAt: null, offerExpiresAt: null }
      )
      // No OFFERED event was recorded
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.OFFERED })
      )
      // No offer notifications sent
      expect(mockWebsocketDispatcher.dispatchNewDeliveryOffer).not.toHaveBeenCalled()
      expect(mockOfferPushService.newOffer).not.toHaveBeenCalled()
    })

    test('refuseIfDispatchStopped throws 409 naming the end time or does nothing if no stop', async () => {
      mockDispatchStopRepository.findOn.mockResolvedValue(activeStop)
      await expect(service.refuseIfDispatchStopped()).rejects.toThrow('Dispatch is stopped until 17:00.')

      mockDispatchStopRepository.findOn.mockResolvedValue(null)
      await expect(service.refuseIfDispatchStopped()).resolves.toBeUndefined()
    })
  })

  describe('AC-5: startWork helpers and RETURNED_TO_WAITING event processing', () => {
    test('endAllOpenOffersForDispatchStop ends every open offer with reason STOPPED and no skip list entry', async () => {
      const openOffers = [
        new DeliveryEntity({
          id: 'del-open-1',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: 'courier-1',
          offeredAt: new Date(),
          courierId: null,
          partnerId: 'partner-1',
        } as any),
        new DeliveryEntity({
          id: 'del-open-2',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: 'courier-2',
          offeredAt: new Date(),
          courierId: null,
          partnerId: 'partner-1',
        } as any),
      ]
      mockDeliveryRepository.findAllOpenOffers.mockResolvedValue(openOffers)
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)
      mockDeliveryRepository.findById.mockImplementation(async (id: string) => ({
        id,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        matchedCourierId: null,
        courierId: null,
      }))
      mockDeliveryRepository.findByIdOrThrow.mockImplementation(async (id: string) => ({
        id,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        matchedCourierId: null,
        courierId: null,
      }))

      const count = await service.endAllOpenOffersForDispatchStop('Ended: dispatch stopped (heat)')

      expect(count).toBe(2)
      // updateIfMatches was called for both deliveries clearing matchedCourierId, offeredAt, offerExpiresAt (2 calls),
      // plus the OFFER_EXPIRED status step write for each (2 calls, decision 32.17).
      const clearOfferCalls = mockDeliveryRepository.updateIfMatches.mock.calls.filter(
        (call: any) => (call[2] as any)?.matchedCourierId === null
      )
      expect(clearOfferCalls).toHaveLength(2)
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledTimes(4)
      // Critical check: cacheService.save was NEVER called to add either courier to the rejected/skip list!
      expect(mockCacheService.save).not.toHaveBeenCalled()
      // Web socket and push notified of offer ended
      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledTimes(2)
      expect(mockOfferPushService.offerEnded).toHaveBeenCalledTimes(2)
      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith(
        'user-courier-1',
        { deliveryId: 'del-open-1', reason: 'STOPPED' }
      )
    })

    test('returnToWaitingForDispatchStop writes status ASSIGNING_COURIER and clears courierId, matchedCourierId, offeredAt, offerExpiresAt in ONE updateIfMatches, saves event, notifies, and returns amounts (AC-5)', async () => {
      const heldDelivery = {
        id: 'del-held-1',
        status: EnumDeliveryStatus.ACCEPTED,
        courierId: 'courier-dropped',
        matchedCourierId: null,
        offeredAt: null,
        offerExpiresAt: null,
        partnerId: 'partner-1',
        totalCompensation: 850,
        currencyCode: 'EUR',
      }
      mockDeliveryRepository.findById.mockResolvedValue(heldDelivery)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        ...heldDelivery,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
      })
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

      const result = await service.returnToWaitingForDispatchStop(
        'del-held-1',
        'courier-dropped',
        EnumEventActor.ADMIN,
        'Dispatch stopped (heat)'
      )

      expect(result).toEqual({
        returned: true,
        totalCompensation: 850,
        currencyCode: 'EUR',
      })

      // Conditional write requires matching the exact status and courierId that were read,
      // and writes status ASSIGNING_COURIER and clears courierId, matchedCourierId, offeredAt, offerExpiresAt in ONE write
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-held-1',
        { status: EnumDeliveryStatus.ACCEPTED, courierId: 'courier-dropped' },
        {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          acceptedAt: null,
          handBackUntil: null,
        }
      )
      // Must NOT update status unconditionally afterwards
      expect(mockDeliveryRepository.update).not.toHaveBeenCalled()

      // Saves RETURNED_TO_WAITING event with transitionSuccessful true, oldStatus and newStatus
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-held-1',
          type: EnumDeliveryEventType.RETURNED_TO_WAITING,
          actor: EnumEventActor.ADMIN,
          eventSource: EnumDeliveryEventSource.OPENCOURIER,
          message: 'Dispatch stopped (heat)',
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
        })
      )

      // Partner notified
      expect(mockPartnerWebhookService.sendDeliveryUpdatePartnerWebhook).toHaveBeenCalledWith({
        deliveryId: 'del-held-1',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        oldStatus: EnumDeliveryStatus.ACCEPTED,
        event: expect.objectContaining({
          type: EnumDeliveryEventType.RETURNED_TO_WAITING,
          courierId: 'courier-dropped',
        }),
      })

      // Dropped courier is notified of DELIVERY_STATUS_UPDATED
      expect(mockWebsocketDispatcher.dispatchDeliveryStatusUpdated).toHaveBeenCalledWith(
        'user-courier-dropped',
        EnumDeliveryStatus.ACCEPTED,
        EnumDeliveryStatus.ASSIGNING_COURIER,
        expect.anything()
      )
    })

    test('returnToWaitingForDispatchStop returns { returned: false }, saves no event, and tells nobody when updateIfMatches returns false (e.g. pickup won race) (AC-5)', async () => {
      const heldDelivery = {
        id: 'del-held-race',
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        courierId: 'courier-1',
        partnerId: 'partner-1',
        totalCompensation: 850,
        currencyCode: 'EUR',
      }
      mockDeliveryRepository.findById.mockResolvedValue(heldDelivery)
      // Rider tapped pickup at the exact same moment: updateIfMatches misses!
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)

      const result = await service.returnToWaitingForDispatchStop(
        'del-held-race',
        'courier-1',
        EnumEventActor.ADMIN,
        'Dispatch stopped (storm)'
      )

      expect(result).toEqual({ returned: false })

      // Condition must match read status and rider
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-held-race',
        { status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, courierId: 'courier-1' },
        {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          acceptedAt: null,
          handBackUntil: null,
        }
      )

      // Saves NO event when the write missed
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalled()

      // Tells nobody
      expect(mockWebsocketDispatcher.dispatchDeliveryStatusUpdated).not.toHaveBeenCalled()
      expect(mockPartnerWebhookService.sendDeliveryUpdatePartnerWebhook).not.toHaveBeenCalled()
    })

    test('returnToWaitingForDispatchStop returns { returned: false } without writing when delivery is not held by rider or status is not returnable (AC-5)', async () => {
      // 1. Delivery not held by that rider
      mockDeliveryRepository.findById.mockResolvedValueOnce({
        id: 'del-other-courier',
        status: EnumDeliveryStatus.ACCEPTED,
        courierId: 'courier-other',
      })
      const res1 = await service.returnToWaitingForDispatchStop('del-other-courier', 'courier-1', EnumEventActor.ADMIN, 'why')
      expect(res1).toEqual({ returned: false })
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()

      // 2. Delivery is PICKED_UP (not returnable; rider finishes delivery)
      mockDeliveryRepository.findById.mockResolvedValueOnce({
        id: 'del-picked-up',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-1',
      })
      const res2 = await service.returnToWaitingForDispatchStop('del-picked-up', 'courier-1', EnumEventActor.ADMIN, 'why')
      expect(res2).toEqual({ returned: false })
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()

      // 3. Delivery not found
      mockDeliveryRepository.findById.mockResolvedValueOnce(null)
      const res3 = await service.returnToWaitingForDispatchStop('del-not-found', 'courier-1', EnumEventActor.ADMIN, 'why')
      expect(res3).toEqual({ returned: false })
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
    })

    test('processDeliveryEvent with type RETURNED_TO_WAITING is recorded as a failed transition and changes nothing (AC-5)', async () => {
      const heldDelivery = {
        id: 'del-held-1',
        status: EnumDeliveryStatus.ACCEPTED,
        courierId: 'courier-1',
        partnerId: 'partner-1',
      }
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(heldDelivery)
      mockDeliveryRepository.findById.mockResolvedValue(heldDelivery)

      await service.processDeliveryEvent({
        deliveryId: 'del-held-1',
        type: EnumDeliveryEventType.RETURNED_TO_WAITING,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: 'courier-1',
        message: 'Direct event submission attempt',
      })

      // Recorded as failed transition in delivery event repository
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-held-1',
          type: EnumDeliveryEventType.RETURNED_TO_WAITING,
          transitionSuccessful: false,
          message: 'RETURNED_TO_WAITING is recorded by a dispatch stop only',
        })
      )
      // Delivery status was NOT changed
      expect(mockDeliveryRepository.update).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
    })
  })

  describe('AC-4 end: matchAllWaitingDeliveriesAfterStop', () => {
    test('runs offerOrWait for EVERY waiting delivery (oldest first, not just one)', async () => {
      mockDispatchStopRepository.findOn.mockResolvedValue(null) // Stop has ended
      mockDeliveryRepository.findIdsWaitingForCourierOldestFirst.mockResolvedValue(['del-wait-1', 'del-wait-2', 'del-wait-3'])

      mockDeliveryRepository.findByIdOrThrow.mockImplementation(async (id: string) => ({
        id,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
        partnerId: 'partner-1',
      }))
      mockDeliveryRepository.findById.mockImplementation(async (id: string) => ({
        id,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
        partnerId: 'partner-1',
      }))
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValue(null)

      await service.matchAllWaitingDeliveriesAfterStop()

      // The matcher was queried for all 3 deliveries in sequence!
      expect(mockDeliveryMatchingService.findCourierForDelivery).toHaveBeenCalledTimes(3)
      expect(mockDeliveryMatchingService.findCourierForDelivery).toHaveBeenNthCalledWith(1, 'del-wait-1')
      expect(mockDeliveryMatchingService.findCourierForDelivery).toHaveBeenNthCalledWith(2, 'del-wait-2')
      expect(mockDeliveryMatchingService.findCourierForDelivery).toHaveBeenNthCalledWith(3, 'del-wait-3')
    })
  })
})
