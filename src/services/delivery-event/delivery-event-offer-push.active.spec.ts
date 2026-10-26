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
import { ConfigService } from '@nestjs/config'
import { OfferPushService } from '../pushNotification/offer-push.service'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import {
  EnumCourierStatus,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
} from '@prisma/types'

describe('DeliveryEventService - Spec 0003 AC-2, AC-6 Socket Before Push & Send Points', () => {
  let service: DeliveryEventService
  let mockWebsocketDispatcher: jest.Mocked<WebsocketDispatcher>
  let mockOfferPushService: jest.Mocked<OfferPushService>
  let mockCourierRepository: jest.Mocked<CourierRepository>
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>
  let mockDeliveryEventRepository: jest.Mocked<DeliveryEventRepository>
  let mockBullMQService: jest.Mocked<BullMQService>
  let mockDeliveryMatchingService: jest.Mocked<DeliveryMatchingService>
  let mockDeliveryCalculationService: jest.Mocked<DeliveryCalculationService>

  const callOrder: string[] = []
  const sampleOfferedAt = new Date('2026-10-26T10:00:00.000Z')

  const sampleCourier: CourierEntity = {
    id: 'courier-rider-1',
    userId: 'user-courier-1',
    firstName: 'Nikos',
    lastName: 'Rider',
  } as CourierEntity

  const sampleDelivery: DeliveryEntity = {
    id: 'del-offer-1',
    status: EnumDeliveryStatus.ASSIGNING_COURIER,
    matchedCourierId: 'courier-rider-1',
    courierId: null,
    partnerId: 'partner-1',
    offeredAt: sampleOfferedAt,
    offerExpiresAt: null,
    totalCompensation: 300,
    currencyCode: 'EUR',
    pickupBusinessName: 'Volos Grill',
  } as DeliveryEntity

  beforeEach(() => {
    callOrder.length = 0

    mockWebsocketDispatcher = {
      sendOfferToCourier: jest.fn().mockImplementation(async () => {
        callOrder.push('socket:sendOfferToCourier')
      }),
      sendOfferEnded: jest.fn().mockImplementation(async () => {
        callOrder.push('socket:sendOfferEnded')
      }),
      sendDeliveryStatusUpdate: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WebsocketDispatcher>

    mockOfferPushService = {
      newOffer: jest.fn().mockImplementation(() => {
        callOrder.push('push:newOffer')
      }),
      offerEnded: jest.fn().mockImplementation(() => {
        callOrder.push('push:offerEnded')
      }),
    } as unknown as jest.Mocked<OfferPushService>

    mockCourierRepository = {
      findById: jest.fn().mockResolvedValue(sampleCourier),
      findUniqueOrThrow: jest.fn().mockResolvedValue(sampleCourier),
      findByIdOrThrow: jest.fn().mockResolvedValue(sampleCourier),
      findMany: jest.fn().mockResolvedValue([sampleCourier]),
    } as unknown as jest.Mocked<CourierRepository>

    mockDeliveryRepository = {
      findById: jest.fn().mockResolvedValue(sampleDelivery),
      findByIdOrThrow: jest.fn().mockResolvedValue(sampleDelivery),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      updateStatus: jest.fn().mockResolvedValue(sampleDelivery),
      update: jest.fn().mockResolvedValue(sampleDelivery),
      findOpenOffersForCourier: jest.fn().mockResolvedValue([sampleDelivery]),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockDeliveryEventRepository = {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' } as any),
      findLatestOfTypes: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<DeliveryEventRepository>

    mockBullMQService = {
      addJob: jest.fn().mockResolvedValue(undefined as any),
      removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<BullMQService>

    mockDeliveryMatchingService = {
      findCourierForDelivery: jest.fn().mockResolvedValue({ courier: sampleCourier }),
    } as unknown as jest.Mocked<DeliveryMatchingService>

    mockDeliveryCalculationService = {
      calculateDeliveryAmountsForMatchedCourier: jest.fn().mockResolvedValue({
        courierBaseFee: 100,
        courierDistanceFee: 200,
        courierFeeAmount: 300,
        courierTipAmount: 0,
        totalCost: 500,
        totalCompensation: 300,
        fee: 50,
        feePercentage: 10,
      }),
    } as unknown as jest.Mocked<DeliveryCalculationService>

    const mockConfigDomainService = {
      instanceConfig: {
        getOfferExpiryEnabled: jest.fn().mockResolvedValue(false),
        getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
        getNoCourierRetrySeconds: jest.fn().mockResolvedValue(30),
      },
    }

    const mockCacheService = {
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CacheService>

    service = new DeliveryEventService(
      {} as ConfigService,
      mockWebsocketDispatcher,
      mockCourierRepository,
      mockDeliveryRepository,
      mockDeliveryEventRepository,
      { scheduleTask: jest.fn() } as unknown as TaskBusScheduler,
      { registerTaskHandler: jest.fn() } as unknown as TaskBusService,
      { sendDeliveryUpdatePartnerWebhook: jest.fn() } as unknown as PartnerWebhookService,
      mockDeliveryMatchingService,
      mockDeliveryCalculationService,
      mockBullMQService,
      mockConfigDomainService as unknown as ConfigDomainService,
      mockCacheService,
      mockOfferPushService
    )
  })

  describe('AC-2: Socket before push ordering and push resilience', () => {
    test('sends socket offer first, then starts push', async () => {
      await (service as any).sendOfferToRider(sampleCourier, sampleDelivery)

      // AC-2: Socket message is sent before the push
      expect(callOrder).toEqual(['socket:sendOfferToCourier', 'push:newOffer'])
      expect(mockWebsocketDispatcher.sendOfferToCourier).toHaveBeenCalledWith(
        'user-courier-1',
        expect.objectContaining({ id: 'del-offer-1' })
      )
      expect(mockOfferPushService.newOffer).toHaveBeenCalledWith('courier-rider-1', 'del-offer-1')
    })

    test('starts push in finally block even when socket offer fails/throws', async () => {
      mockWebsocketDispatcher.sendOfferToCourier.mockRejectedValue(new Error('Socket disconnected'))

      await expect(
        (service as any).sendOfferToRider(sampleCourier, sampleDelivery)
      ).rejects.toThrow('Socket disconnected')

      // Push must still start so a rider with a locked phone gets the offer
      expect(mockOfferPushService.newOffer).toHaveBeenCalledWith('courier-rider-1', 'del-offer-1')
    })

    test('sends socket offer-ended first, then starts offer-ended push', async () => {
      const message = { deliveryId: 'del-offer-1', reason: 'EXPIRED' as const }
      await (service as any).sendOfferEndedToRider(sampleCourier, message)

      expect(callOrder).toEqual(['socket:sendOfferEnded', 'push:offerEnded'])
      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith('user-courier-1', message)
      expect(mockOfferPushService.offerEnded).toHaveBeenCalledWith('courier-rider-1', message)
    })

    test('starts offer-ended push in finally block even when socket send fails/throws', async () => {
      mockWebsocketDispatcher.sendOfferEnded.mockRejectedValue(new Error('Socket network timeout'))

      const message = { deliveryId: 'del-offer-1', reason: 'OFFLINE' as const }
      await expect(
        (service as any).sendOfferEndedToRider(sampleCourier, message)
      ).rejects.toThrow('Socket network timeout')

      expect(mockOfferPushService.offerEnded).toHaveBeenCalledWith('courier-rider-1', message)
    })
  })

  describe('The 5 Send Points trigger OfferPushService', () => {
    test('Point 1: automatic offer (shared offerToNextCourier path via retry job) sends push', async () => {
      // Waiting delivery with nobody offered or assigned
      mockDeliveryRepository.findById.mockResolvedValue({
        ...sampleDelivery,
        matchedCourierId: null,
        courierId: null,
      } as DeliveryEntity)

      // Simulate automatic dispatch via no-courier-retry job handler
      await service.handleNoCourierRetryJob({ deliveryId: 'del-offer-1' })

      expect(mockWebsocketDispatcher.sendOfferToCourier).toHaveBeenCalled()
      expect(mockOfferPushService.newOffer).toHaveBeenCalledWith('courier-rider-1', 'del-offer-1')
    })

    test('Point 2: admin offer (offerDeliveryToCourierAsAdmin) sends socket and push', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        ...sampleDelivery,
        matchedCourierId: null, // initially unassigned
      } as DeliveryEntity)

      await service.offerDeliveryToCourierAsAdmin('del-offer-1', 'courier-rider-1', 'Admin manual offer')

      expect(mockWebsocketDispatcher.sendOfferToCourier).toHaveBeenCalled()
      expect(mockOfferPushService.newOffer).toHaveBeenCalledWith('courier-rider-1', 'del-offer-1')
    })

    test('Point 3: admin reassignment to new courier sends newOffer push', async () => {
      // Delivery starts in an ongoing status (e.g. ACCEPTED), transitioning to ASSIGNING_COURIER on REASSIGNED
      const currentDelivery = {
        ...sampleDelivery,
        status: EnumDeliveryStatus.ACCEPTED,
        courierId: 'courier-old',
        matchedCourierId: null,
      } as DeliveryEntity
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(currentDelivery)

      await service.processDeliveryEvent({
        deliveryId: 'del-offer-1',
        type: EnumDeliveryEventType.REASSIGNED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: 'courier-rider-1',
      })

      expect(mockWebsocketDispatcher.sendOfferToCourier).toHaveBeenCalled()
      expect(mockOfferPushService.newOffer).toHaveBeenCalledWith('courier-rider-1', 'del-offer-1')
    })

    test('Point 4: admin offer replacing previous courier sends OFFER_ENDED with reason MOVED', async () => {
      const replacedCourier = {
        id: 'courier-replaced-old',
        userId: 'user-replaced-old',
      } as CourierEntity

      mockCourierRepository.findById.mockImplementation(async (id) => {
        if (id === 'courier-replaced-old') return replacedCourier
        return sampleCourier
      })

      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        ...sampleDelivery,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-replaced-old', // Open offer currently held by old courier
      } as DeliveryEntity)

      await service.offerDeliveryToCourierAsAdmin('del-offer-1', 'courier-rider-1', 'Moving offer to rider 1')

      // Old courier receives OFFER_ENDED with reason MOVED
      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith(
        'user-replaced-old',
        { deliveryId: 'del-offer-1', reason: 'MOVED' }
      )
      expect(mockOfferPushService.offerEnded).toHaveBeenCalledWith('courier-replaced-old', {
        deliveryId: 'del-offer-1',
        reason: 'MOVED',
      })

      // New courier receives new offer push
      expect(mockOfferPushService.newOffer).toHaveBeenCalledWith('courier-rider-1', 'del-offer-1')
    })

    test('Point 5: offer expiry or courier offline triggers OFFER_ENDED push', async () => {
      // Test when courier goes OFFLINE with open offer
      await service.handleCourierStatusChanged('courier-rider-1', EnumCourierStatus.OFFLINE)

      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith(
        'user-courier-1',
        { deliveryId: 'del-offer-1', reason: 'OFFLINE' }
      )
      expect(mockOfferPushService.offerEnded).toHaveBeenCalledWith('courier-rider-1', {
        deliveryId: 'del-offer-1',
        reason: 'OFFLINE',
      })
    })
  })
})
