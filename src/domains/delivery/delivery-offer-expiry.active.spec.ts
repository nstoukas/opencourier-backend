import { EventEmitter2 } from '@nestjs/event-emitter'
import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'
import { DeliveryDomainService } from './delivery.domain.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { CacheService } from 'src/services/cache/cache.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryCantBeAcceptedException, OfferHasEndedException } from 'src/errors'
import { DeliveryEntity } from './entities/delivery.entity'

describe('DeliveryDomainService - Offer Expiry (AC-5, AC-11)', () => {
  let service: DeliveryDomainService

  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>
  let mockEventEmitter: jest.Mocked<EventEmitter2>
  let mockCacheService: jest.Mocked<CacheService>
  let mockDeliveryEventService: jest.Mocked<DeliveryEventService>
  let mockCourierRepository: jest.Mocked<CourierRepository>
  let mockCourierCompensationRepository: jest.Mocked<CourierCompensationRepository>
  let mockConfigDomainService: jest.Mocked<ConfigDomainService>

  beforeEach(() => {
    mockDeliveryRepository = {
      findByIdOrThrow: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      findLatestNoCourierAvailableAt: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockEventEmitter = {
      emit: jest.fn(),
    } as unknown as jest.Mocked<EventEmitter2>

    mockCacheService = {
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CacheService>

    mockDeliveryEventService = {
      processDeliveryEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeliveryEventService>

    mockCourierRepository = {
      findByIdOrThrow: jest.fn(),
      findNamesByIds: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<CourierRepository>

    mockCourierCompensationRepository = {
      create: jest.fn(),
      deleteById: jest.fn(),
    } as unknown as jest.Mocked<CourierCompensationRepository>

    mockConfigDomainService = {} as any

    service = new DeliveryDomainService(
      mockDeliveryRepository,
      mockEventEmitter,
      mockCacheService,
      mockDeliveryEventService,
      mockCourierRepository,
      mockCourierCompensationRepository,
      mockConfigDomainService
    )
  })

  describe('acceptDelivery (AC-5, AC-8)', () => {
    const deliveryId = 'del-accept-test'
    const courierId = 'courier-1'
    const offeredAt = new Date()

    it('successfully accepts delivery with conditional update setting courierId and clearing offerExpiresAt', async () => {
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce({
          id: deliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: courierId,
          offeredAt,
          offerExpiresAt: new Date(Date.now() + 15000),
          courierId: null,
        } as any)
        .mockResolvedValueOnce({
          id: deliveryId,
          status: EnumDeliveryStatus.ACCEPTED,
          courierId: courierId,
        } as any)

      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(true)

      const result = await service.acceptDelivery(deliveryId, courierId)

      // 1. updateIfMatches checks matching offer and courierId: null, then writes courierId
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: courierId,
          offeredAt,
          courierId: null,
        },
        {
          courierId,
          offerExpiresAt: null,
        }
      )

      // 2. processDeliveryEvent is called with ACCEPTED and actor COURIER
      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith({
        deliveryId,
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
        message: `Courier ${courierId} accepted delivery ${deliveryId}`,
      })

      expect(result.id).toBe(deliveryId)
    })

    it('throws 409 OfferHasEndedException when delivery status is not ASSIGNING_COURIER', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ACCEPTED,
        matchedCourierId: courierId,
      } as any)

      await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toThrow(OfferHasEndedException)
      await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toThrow('This offer has ended')

      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    it('throws 409 OfferHasEndedException when delivery is offered to a different courier', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-other',
      } as any)

      await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toThrow(OfferHasEndedException)
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    it('throws 409 OfferHasEndedException when updateIfMatches returns false (raced against expiry or another update)', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt,
      } as any)
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(false)

      await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toThrow(OfferHasEndedException)
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    it('rolls back offer fields and throws DeliveryCantBeAcceptedException if delivery status remains ASSIGNING_COURIER after event processing', async () => {
      const offerExpiresAt = new Date(Date.now() + 15000)
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce({
          id: deliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: courierId,
          offeredAt,
          offerExpiresAt,
          courierId: null,
        } as any)
        .mockResolvedValueOnce({
          id: deliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER, // State machine did not transition!
          courierId: courierId,
        } as any)

      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

      await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toThrow(
        DeliveryCantBeAcceptedException
      )

      // Rollback call
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenLastCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        { courierId: null, offerExpiresAt }
      )
    })
  })

  describe('rejectDelivery (AC-5)', () => {
    const deliveryId = 'del-reject-test'
    const courierId = 'courier-1'
    const offeredAt = new Date()

    it('successfully rejects delivery with conditional update clearing all three offer fields', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt,
        offerExpiresAt: new Date(Date.now() + 10000),
        courierId: null,
      } as any)
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(true)

      await service.rejectDelivery(deliveryId, courierId)

      // 1. Conditional update clears matchedCourierId, offeredAt, and offerExpiresAt
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: courierId,
          offeredAt,
          courierId: null,
        },
        {
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
        }
      )

      // 2. Courier added to skip list (20 min TTL)
      expect(mockCacheService.save).toHaveBeenCalledWith(
        expect.stringContaining(deliveryId),
        [courierId],
        1200
      )

      // 3. processDeliveryEvent called with REJECTED
      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith({
        deliveryId,
        type: EnumDeliveryEventType.REJECTED,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
        message: `Courier ${courierId} rejected delivery ${deliveryId}`,
      })
    })

    it('throws 409 OfferHasEndedException when delivery is not ASSIGNING_COURIER', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: deliveryId,
        status: EnumDeliveryStatus.CANCELED,
        matchedCourierId: courierId,
      } as any)

      await expect(service.rejectDelivery(deliveryId, courierId)).rejects.toThrow(OfferHasEndedException)
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    it('throws 409 OfferHasEndedException when delivery matchedCourierId does not match', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-someone-else',
      } as any)

      await expect(service.rejectDelivery(deliveryId, courierId)).rejects.toThrow(OfferHasEndedException)
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    it('throws 409 OfferHasEndedException when updateIfMatches returns false', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt,
      } as any)
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(false)

      await expect(service.rejectDelivery(deliveryId, courierId)).rejects.toThrow(OfferHasEndedException)
      expect(mockCacheService.save).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })
  })

  describe('getOfferViews (AC-11)', () => {
    it('returns matchedCourierName for open offers and waitingForCourierSince for waiting deliveries', async () => {
      const waitDate = new Date('2026-10-25T10:00:00.000Z')

      const deliveries: DeliveryEntity[] = [
        // 1. Open offer: ASSIGNING_COURIER with matchedCourierId and no courierId
        {
          id: 'del-open',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: 'courier-1',
          courierId: null,
        } as any,
        // 2. Waiting delivery: ASSIGNING_COURIER with no matchedCourierId and no courierId
        {
          id: 'del-waiting',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: null,
          courierId: null,
        } as any,
        // 3. Accepted delivery: in ACCEPTED status with courierId
        {
          id: 'del-accepted',
          status: EnumDeliveryStatus.ACCEPTED,
          matchedCourierId: 'courier-1',
          courierId: 'courier-1',
        } as any,
        // 4. Created delivery: CREATED status
        {
          id: 'del-created',
          status: EnumDeliveryStatus.CREATED,
          matchedCourierId: null,
          courierId: null,
        } as any,
      ]

      mockCourierRepository.findNamesByIds.mockResolvedValueOnce(
        new Map([['courier-1', 'Ana P.']])
      )
      mockDeliveryRepository.findLatestNoCourierAvailableAt.mockResolvedValueOnce(
        new Map([['del-waiting', waitDate]])
      )

      const views = await service.getOfferViews(deliveries)

      // Check del-open: has rider name, waitingSince is null
      expect(views.get('del-open')).toEqual({
        matchedCourierName: 'Ana P.',
        waitingForCourierSince: null,
      })

      // Check del-waiting: no rider name, waitingSince is set
      expect(views.get('del-waiting')).toEqual({
        matchedCourierName: null,
        waitingForCourierSince: waitDate,
      })

      // Check del-accepted: both null (no longer looking for a rider)
      expect(views.get('del-accepted')).toEqual({
        matchedCourierName: null,
        waitingForCourierSince: null,
      })

      // Check del-created: both null (not in ASSIGNING_COURIER)
      expect(views.get('del-created')).toEqual({
        matchedCourierName: null,
        waitingForCourierSince: null,
      })
    })

    it('handles empty deliveries list gracefully', async () => {
      const views = await service.getOfferViews([])
      expect(views.size).toBe(0)
      expect(mockCourierRepository.findNamesByIds).toHaveBeenCalledWith([])
      expect(mockDeliveryRepository.findLatestNoCourierAvailableAt).toHaveBeenCalledWith([])
    })
  })
})
