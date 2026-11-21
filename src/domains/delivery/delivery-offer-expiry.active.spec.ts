import { ConflictException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { EnumDeliveryEventSource, EnumDeliveryEventType, EnumDeliveryStatus, EnumEventActor } from '@prisma/types'
import { DeliveryDomainService } from './delivery.domain.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { CacheService } from 'src/services/cache/cache.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { CantUpdateDeliveryStatusError, DeliveryCantBeAcceptedException, OfferHasEndedException } from 'src/errors'
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
      // No dispatch stop is on in these tests (spec 0014).
      refuseIfDispatchStopped: jest.fn().mockResolvedValue(undefined),
      // No SOS is on in these tests (spec 0022, decision 73.10).
      refuseIfCourierInSos: jest.fn().mockResolvedValue(undefined),
      // Spec 0051 (cross check 7): accept, reassign and an admin hand offer ask this first.
      refuseIfCourierDeactivated: jest.fn().mockResolvedValue(undefined),
      // Row 108 review: after the take the rider is read again; not deactivated in these tests.
      isCourierDeactivatedAfterTake: jest.fn().mockResolvedValue(false),
      rearmOfferExpiry: jest.fn().mockResolvedValue(undefined),
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
      mockConfigDomainService,
      // PartnerRepository (spec 0023): only create() reads it, which these tests do not call.
      {} as any
    )
  })

  describe('acceptDelivery (AC-5, AC-8)', () => {
    const deliveryId = 'del-accept-test'
    const courierId = 'courier-1'
    const offeredAt = new Date()

    it('refuses (409 CantUpdateDeliveryStatusError) during a dispatch stop before touching the delivery (spec 0014, row 29 review)', async () => {
      mockDeliveryEventService.refuseIfDispatchStopped.mockRejectedValue(
        new CantUpdateDeliveryStatusError('Dispatch is stopped until 17:00.')
      )

      await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toThrow(CantUpdateDeliveryStatusError)
      await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toThrow('Dispatch is stopped until 17:00.')

      // Must NOT touch the delivery before checking the stop gate
      expect(mockDeliveryRepository.findByIdOrThrow).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    it('refuses (409 CantUpdateDeliveryStatusError) when rider has an active SOS before reading or writing the delivery (decision 73.10)', async () => {
      mockDeliveryEventService.refuseIfCourierInSos.mockRejectedValue(
        new CantUpdateDeliveryStatusError('This rider has an active SOS and cannot be given a delivery until it ends.')
      )

      await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toThrow(CantUpdateDeliveryStatusError)
      await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toThrow(
        'This rider has an active SOS and cannot be given a delivery until it ends.'
      )

      expect(mockDeliveryEventService.refuseIfCourierInSos).toHaveBeenCalledWith(courierId)
      // Must NOT touch the delivery before checking the SOS gate
      expect(mockDeliveryRepository.findByIdOrThrow).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    // Spec 0051 (cross checks 5 and 7): accept refuses a deactivated rider, so no accept slips in between
    // a deactivation's checks and its writes. Asked before the SOS check and before the delivery is read.
    it('refuses (409) a deactivated rider before the SOS check and before reading or writing the delivery (spec 0051)', async () => {
      mockDeliveryEventService.refuseIfCourierDeactivated.mockRejectedValue(
        new ConflictException("This rider's account is deactivated.")
      )

      await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toThrow(ConflictException)
      await expect(service.acceptDelivery(deliveryId, courierId, true)).rejects.toThrow(
        "This rider's account is deactivated."
      )

      expect(mockDeliveryEventService.refuseIfCourierDeactivated).toHaveBeenCalledWith(courierId)
      expect(mockDeliveryEventService.refuseIfCourierInSos).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.findByIdOrThrow).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    it('refuses automatic accept (automatic=true) when rider has an active SOS (decision 73.10)', async () => {
      mockDeliveryEventService.refuseIfCourierInSos.mockRejectedValue(
        new CantUpdateDeliveryStatusError('This rider has an active SOS and cannot be given a delivery until it ends.')
      )

      await expect(service.acceptDelivery(deliveryId, courierId, true)).rejects.toThrow(CantUpdateDeliveryStatusError)
      await expect(service.acceptDelivery(deliveryId, courierId, true)).rejects.toThrow(
        'This rider has an active SOS and cannot be given a delivery until it ends.'
      )

      expect(mockDeliveryEventService.refuseIfCourierInSos).toHaveBeenCalledWith(courierId)
      expect(mockDeliveryRepository.findByIdOrThrow).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    it('gives back the claim and throws 409 when dispatch stop starts between initial check and claim (spec 0014, row 29 review)', async () => {
      // 1st call (before claim) passes, 2nd call (after claim) throws 409
      mockDeliveryEventService.refuseIfDispatchStopped
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new CantUpdateDeliveryStatusError('Dispatch is stopped until 17:00.'))

      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt,
        offerExpiresAt: new Date(Date.now() + 15000),
        courierId: null,
      } as any)

      mockDeliveryRepository.updateIfMatches
        .mockResolvedValueOnce(true) // 1st update: claim succeeds
        .mockResolvedValueOnce(true) // 2nd update: give back claim

      await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toThrow(CantUpdateDeliveryStatusError)

      // Initial claim: sets courierId, clears offerExpiresAt
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenNthCalledWith(
        1,
        deliveryId,
        {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: courierId,
          offeredAt,
          courierId: null,
        },
        { courierId, offerExpiresAt: null }
      )

      // Claim given back: clears courierId, matchedCourierId, offeredAt, offerExpiresAt
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenNthCalledWith(
        2,
        deliveryId,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        { courierId: null, matchedCourierId: null, offeredAt: null, offerExpiresAt: null }
      )

      // No ACCEPTED event is processed
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    // Row 108 review (ruling: "Accept after the deactivation commits"): an accept already past the first
    // check can take an offer after a deactivation committed. The rider is read again after the take and,
    // if deactivated, the take is given back the way the dispatch stop check gives one back.
    describe('a deactivation that commits between the first check and the take (spec 0051, row 108 review)', () => {
      const offered = () =>
        ({
          id: deliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: courierId,
          offeredAt,
          offerExpiresAt: new Date(Date.now() + 15000),
          courierId: null,
        } as any)

      it('gives the take back and answers 409 with the deactivated sentence; no ACCEPTED is processed', async () => {
        mockDeliveryEventService.isCourierDeactivatedAfterTake.mockResolvedValue(true)
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(offered())

        const call = service.acceptDelivery(deliveryId, courierId)
        await expect(call).rejects.toBeInstanceOf(ConflictException)
        await expect(call).rejects.toMatchObject({ status: 409, message: "This rider's account is deactivated." })

        expect(mockDeliveryEventService.isCourierDeactivatedAfterTake).toHaveBeenCalledWith(courierId)
        expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledTimes(2)
        // The take.
        expect(mockDeliveryRepository.updateIfMatches).toHaveBeenNthCalledWith(
          1,
          deliveryId,
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: courierId, offeredAt, courierId: null },
          { courierId, offerExpiresAt: null }
        )
        // Given back: only while this rider still holds it, and the whole offer is cleared.
        expect(mockDeliveryRepository.updateIfMatches).toHaveBeenNthCalledWith(
          2,
          deliveryId,
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
          { courierId: null, matchedCourierId: null, offeredAt: null, offerExpiresAt: null }
        )
        expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      })

      it('the automatic accept is given back the same way', async () => {
        mockDeliveryEventService.isCourierDeactivatedAfterTake.mockResolvedValue(true)
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(offered())

        await expect(service.acceptDelivery(deliveryId, courierId, true)).rejects.toThrow(
          "This rider's account is deactivated."
        )
        expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledTimes(2)
        expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      })

      it('the rider is read again only after the take, never before it', async () => {
        const order: string[] = []
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(offered())
        mockDeliveryRepository.updateIfMatches.mockImplementation(async () => {
          order.push('updateIfMatches')
          return true
        })
        mockDeliveryEventService.isCourierDeactivatedAfterTake.mockImplementation(async () => {
          order.push('isCourierDeactivatedAfterTake')
          return true
        })

        await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toBeInstanceOf(ConflictException)

        expect(order).toEqual(['updateIfMatches', 'isCourierDeactivatedAfterTake', 'updateIfMatches'])
      })

      it('an offer that could not be taken is never read again or given back', async () => {
        mockDeliveryEventService.isCourierDeactivatedAfterTake.mockResolvedValue(true)
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(offered())
        mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)

        await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toBeInstanceOf(OfferHasEndedException)

        expect(mockDeliveryEventService.isCourierDeactivatedAfterTake).not.toHaveBeenCalled()
        expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledTimes(1)
      })

      it('a rider who is still active keeps the take: ACCEPTED is processed and nothing is given back', async () => {
        mockDeliveryEventService.isCourierDeactivatedAfterTake.mockResolvedValue(false)
        mockDeliveryRepository.findByIdOrThrow
          .mockResolvedValueOnce(offered())
          .mockResolvedValueOnce({ id: deliveryId, status: EnumDeliveryStatus.ACCEPTED, courierId } as any)

        const result = await service.acceptDelivery(deliveryId, courierId)

        expect(mockDeliveryEventService.isCourierDeactivatedAfterTake).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.isCourierDeactivatedAfterTake).toHaveBeenCalledWith(courierId)
        expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
          expect.objectContaining({ deliveryId, type: EnumDeliveryEventType.ACCEPTED, courierId })
        )
        expect(result.id).toBe(deliveryId)
      })
    })

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

    it('Spec 0020 AC-1: automatic true makes the ACCEPTED message end with " (accepted automatically)"', async () => {
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

      await service.acceptDelivery(deliveryId, courierId, true)

      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith({
        deliveryId,
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
        message: `Courier ${courierId} accepted delivery ${deliveryId} (accepted automatically)`,
      })
    })

    it('Spec 0020 AC-1: automatic false does NOT end with " (accepted automatically)"', async () => {
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

      await service.acceptDelivery(deliveryId, courierId, false)

      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith({
        deliveryId,
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
        message: `Courier ${courierId} accepted delivery ${deliveryId}`,
      })
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
      const loggerWarnSpy = jest.spyOn((service as any).logger, 'warn')

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

      await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toThrow(DeliveryCantBeAcceptedException)

      // Rollback call
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenLastCalledWith(
        deliveryId,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        { courierId: null, offerExpiresAt, acceptedAt: null, handBackUntil: null }
      )
      // Rollback re-arms the offer expiry timer (AC-5, review fix)
      expect(mockDeliveryEventService.rearmOfferExpiry).toHaveBeenCalledWith(
        deliveryId,
        courierId,
        offeredAt,
        offerExpiresAt
      )
      // One warning keeps the failed accept traceable (row 121 review fix)
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1)
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        `Accept by courier ${courierId} on delivery ${deliveryId} did not take; offer given back`
      )
      loggerWarnSpy.mockRestore()
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
      expect(mockCacheService.save).toHaveBeenCalledWith(expect.stringContaining(deliveryId), [courierId], 1200)

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
      // Rider was added before clear and removed when clear matched nothing (not left on list)
      expect(mockCacheService.save).toHaveBeenLastCalledWith(
        expect.stringContaining(deliveryId),
        [],
        expect.any(Number)
      )
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    it('when courier was already on the skip list and conditional clear misses, pre-existing entry is kept', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt,
      } as any)
      mockCacheService.getOrDefault.mockResolvedValueOnce([courierId])
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(false)

      await expect(service.rejectDelivery(deliveryId, courierId)).rejects.toThrow(OfferHasEndedException)
      expect(mockCacheService.save).toHaveBeenLastCalledWith(
        expect.stringContaining(deliveryId),
        [courierId],
        expect.any(Number)
      )
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

      mockCourierRepository.findNamesByIds.mockResolvedValueOnce(new Map([['courier-1', 'Ana P.']]))
      mockDeliveryRepository.findLatestNoCourierAvailableAt.mockResolvedValueOnce(new Map([['del-waiting', waitDate]]))

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
