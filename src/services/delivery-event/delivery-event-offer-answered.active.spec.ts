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
import { EnumDeliveryStatus } from '@prisma/types'

describe('DeliveryEventService - Rows 154 & 155: Offer Answer Targets, Silence Phones & OfferedAt', () => {
  let service: DeliveryEventService
  let mockWebsocketDispatcher: jest.Mocked<WebsocketDispatcher>
  let mockOfferPushService: jest.Mocked<OfferPushService>
  let mockCourierRepository: jest.Mocked<CourierRepository>
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>
  let mockDeliveryEventRepository: jest.Mocked<DeliveryEventRepository>
  let mockBullMQService: jest.Mocked<BullMQService>
  let mockDeliveryMatchingService: jest.Mocked<DeliveryMatchingService>
  let mockDeliveryCalculationService: jest.Mocked<DeliveryCalculationService>

  const courierId = 'courier-rider-1'
  const userId = 'user-courier-1'
  const deliveryId = 'del-offer-1'
  const sampleOfferedAt = new Date('2026-11-24T12:00:00.000Z')

  const sampleCourier: CourierEntity = {
    id: courierId,
    userId,
    firstName: 'Nikos',
    lastName: 'Rider',
  } as CourierEntity

  const sampleDelivery: DeliveryEntity = {
    id: deliveryId,
    status: EnumDeliveryStatus.ASSIGNING_COURIER,
    matchedCourierId: courierId,
    courierId: null,
    partnerId: 'partner-1',
    offeredAt: sampleOfferedAt,
    offerExpiresAt: null,
    offerGroupId: null,
  } as DeliveryEntity

  beforeEach(() => {
    mockWebsocketDispatcher = {
      sendOfferToCourier: jest.fn().mockResolvedValue(undefined),
      sendOfferEnded: jest.fn().mockResolvedValue(undefined),
      sendDeliveryStatusUpdate: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WebsocketDispatcher>

    mockOfferPushService = {
      newOffer: jest.fn(),
      offerEnded: jest.fn(),
    } as unknown as jest.Mocked<OfferPushService>

    mockCourierRepository = {
      findById: jest.fn().mockResolvedValue(sampleCourier),
      findByIdOrThrow: jest.fn().mockResolvedValue(sampleCourier),
      findMany: jest.fn().mockResolvedValue([sampleCourier]),
      hasActiveSos: jest.fn().mockResolvedValue(false),
      clearLocationIfOfflineAndFree: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CourierRepository>

    mockDeliveryRepository = {
      findById: jest.fn().mockResolvedValue(sampleDelivery),
      findByIdOrThrow: jest.fn().mockResolvedValue(sampleDelivery),
      findOpenGroupMembers: jest.fn().mockResolvedValue([]),
      updateIfMatches: jest.fn().mockResolvedValue(true),
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
      findCourierForDelivery: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeliveryMatchingService>

    mockDeliveryCalculationService = {
      calculateDeliveryAmountsForMatchedCourier: jest.fn().mockResolvedValue({} as any),
    } as unknown as jest.Mocked<DeliveryCalculationService>

    const mockConfigDomainService = {
      instanceConfig: {
        getOfferExpiryEnabled: jest.fn().mockResolvedValue(false),
        getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
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
      mockOfferPushService,
      { findOn: jest.fn().mockResolvedValue(null) } as any,
      { getRoute: jest.fn() } as any,
      {} as any,
      {} as any,
      { closeOpenForDelivery: jest.fn().mockResolvedValue(undefined) } as any
    )
  })

  describe('offerAnswerTargets (Scope row 154)', () => {
    test('returns courierId, deliveryIds, and offeredAt for a single delivery offer', async () => {
      const targets = await service.offerAnswerTargets(deliveryId, courierId)

      expect(mockDeliveryRepository.findById).toHaveBeenCalledWith(deliveryId)
      expect(targets).toEqual({
        courierId,
        deliveryIds: [deliveryId],
        offeredAt: sampleOfferedAt,
      })
    })

    test('returns all delivery ids for a stacked offer pair (both deliveries covered)', async () => {
      const secondDeliveryId = 'del-offer-2'
      const stackedDelivery: DeliveryEntity = {
        ...sampleDelivery,
        offerGroupId: 'stack-group-1',
      } as DeliveryEntity
      mockDeliveryRepository.findById.mockResolvedValue(stackedDelivery)
      mockDeliveryRepository.findOpenGroupMembers.mockResolvedValue([
        { id: deliveryId } as any,
        { id: secondDeliveryId } as any,
      ])

      const targets = await service.offerAnswerTargets(deliveryId, courierId)

      expect(mockDeliveryRepository.findOpenGroupMembers).toHaveBeenCalledWith(
        'stack-group-1',
        courierId,
        sampleOfferedAt
      )
      expect(targets).toEqual({
        courierId,
        deliveryIds: [deliveryId, secondDeliveryId],
        offeredAt: sampleOfferedAt,
      })
    })

    test('returns null when delivery does not exist', async () => {
      mockDeliveryRepository.findById.mockResolvedValue(null)

      const targets = await service.offerAnswerTargets('del-unknown', courierId)

      expect(targets).toBeNull()
    })

    test('returns null when delivery status is not ASSIGNING_COURIER', async () => {
      const acceptedDelivery: DeliveryEntity = {
        ...sampleDelivery,
        status: EnumDeliveryStatus.ACCEPTED,
      } as DeliveryEntity
      mockDeliveryRepository.findById.mockResolvedValue(acceptedDelivery)

      const targets = await service.offerAnswerTargets(deliveryId, courierId)

      expect(targets).toBeNull()
    })

    test('returns null when delivery is matched to a different courier', async () => {
      const otherCourierDelivery: DeliveryEntity = {
        ...sampleDelivery,
        matchedCourierId: 'courier-other',
      } as DeliveryEntity
      mockDeliveryRepository.findById.mockResolvedValue(otherCourierDelivery)

      const targets = await service.offerAnswerTargets(deliveryId, courierId)

      expect(targets).toBeNull()
    })

    test('returns null and does not throw when findById throws an error (never breaks the answer)', async () => {
      mockDeliveryRepository.findById.mockRejectedValue(new Error('Postgres connection lost'))

      const targets = await service.offerAnswerTargets(deliveryId, courierId)

      expect(targets).toBeNull()
    })
  })

  describe('tellPhonesOfferAnswered (Scope row 154)', () => {
    test('sends OFFER_ENDED with reason ANSWERED and offeredAt to websocket and push for each delivery', async () => {
      const secondDeliveryId = 'del-offer-2'
      const targets = {
        courierId,
        deliveryIds: [deliveryId, secondDeliveryId],
        offeredAt: sampleOfferedAt,
      }

      await service.tellPhonesOfferAnswered(targets)

      // Live connection received OFFER_ENDED for both deliveries
      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledTimes(2)
      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith(userId, {
        deliveryId,
        reason: 'ANSWERED',
        offeredAt: sampleOfferedAt.toISOString(),
      })
      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith(userId, {
        deliveryId: secondDeliveryId,
        reason: 'ANSWERED',
        offeredAt: sampleOfferedAt.toISOString(),
      })

      // Push received OFFER_ENDED for both deliveries
      expect(mockOfferPushService.offerEnded).toHaveBeenCalledTimes(2)
      expect(mockOfferPushService.offerEnded).toHaveBeenCalledWith(courierId, {
        deliveryId,
        reason: 'ANSWERED',
        offeredAt: sampleOfferedAt.toISOString(),
      })
      expect(mockOfferPushService.offerEnded).toHaveBeenCalledWith(courierId, {
        deliveryId: secondDeliveryId,
        reason: 'ANSWERED',
        offeredAt: sampleOfferedAt.toISOString(),
      })
    })

    test('sends offeredAt: null when targets.offeredAt is null', async () => {
      const targets = {
        courierId,
        deliveryIds: [deliveryId],
        offeredAt: null,
      }

      await service.tellPhonesOfferAnswered(targets)

      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith(userId, {
        deliveryId,
        reason: 'ANSWERED',
        offeredAt: null,
      })
      expect(mockOfferPushService.offerEnded).toHaveBeenCalledWith(courierId, {
        deliveryId,
        reason: 'ANSWERED',
        offeredAt: null,
      })
    })

    test('does nothing when courier is not found', async () => {
      mockCourierRepository.findById.mockResolvedValue(null)

      const targets = {
        courierId: 'courier-unknown',
        deliveryIds: [deliveryId],
        offeredAt: sampleOfferedAt,
      }

      await service.tellPhonesOfferAnswered(targets)

      expect(mockWebsocketDispatcher.sendOfferEnded).not.toHaveBeenCalled()
      expect(mockOfferPushService.offerEnded).not.toHaveBeenCalled()
    })

    test('swallows errors and does not throw when courierRepository.findById throws', async () => {
      mockCourierRepository.findById.mockRejectedValue(new Error('Courier lookup failed'))

      const targets = {
        courierId,
        deliveryIds: [deliveryId],
        offeredAt: sampleOfferedAt,
      }

      await expect(service.tellPhonesOfferAnswered(targets)).resolves.toBeUndefined()
    })

    test('swallows errors and does not throw when sendOfferEnded fails', async () => {
      mockWebsocketDispatcher.sendOfferEnded.mockRejectedValue(new Error('Socket send failed'))

      const targets = {
        courierId,
        deliveryIds: [deliveryId],
        offeredAt: sampleOfferedAt,
      }

      await expect(service.tellPhonesOfferAnswered(targets)).resolves.toBeUndefined()
    })
  })

  describe('followUpEndedOffer (Scope row 155)', () => {
    test('sends offeredAt as ISO string when offer ends', async () => {
      await (service as any).followUpEndedOffer(deliveryId, courierId, sampleOfferedAt, 'EXPIRED', 'Offer has expired')

      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith(userId, {
        deliveryId,
        reason: 'EXPIRED',
        offeredAt: sampleOfferedAt.toISOString(),
      })
      expect(mockOfferPushService.offerEnded).toHaveBeenCalledWith(courierId, {
        deliveryId,
        reason: 'EXPIRED',
        offeredAt: sampleOfferedAt.toISOString(),
      })
    })

    test('sends offeredAt: null when offeredAt is null', async () => {
      await (service as any).followUpEndedOffer(deliveryId, courierId, null, 'OFFLINE', 'Rider went offline')

      expect(mockWebsocketDispatcher.sendOfferEnded).toHaveBeenCalledWith(userId, {
        deliveryId,
        reason: 'OFFLINE',
        offeredAt: null,
      })
      expect(mockOfferPushService.offerEnded).toHaveBeenCalledWith(courierId, {
        deliveryId,
        reason: 'OFFLINE',
        offeredAt: null,
      })
    })
  })
})
