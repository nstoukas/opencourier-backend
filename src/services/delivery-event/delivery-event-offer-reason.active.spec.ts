import { EnumDeliveryEventType, EnumDeliveryStatus, EnumEventActor } from '@prisma/types'
import { EnumCourierMatcherType } from 'src/shared-types/courier-matching'
import { DeliveryEventService } from './delivery-event.service'
import { OfferReasonRepository } from 'src/persistence/repositories/offer-reason.repository'
import { adminOfferReason, OFFER_REASON_ADMIN } from 'src/domains/matching/offer-reason'
import { NearestCourierMatcherService } from '../courier-matcher/nearest-courier-matcher.service'
import { CourierSeniorityMatcherService } from '../courier-matcher/courier-seniority-matcher.service'
import { StaticCourierMatcherService } from '../courier-matcher/static-courier-matcher.service'

describe('Offer Reasons across matchers and admin offers (Spec 0044: AC-6)', () => {
  let service: DeliveryEventService
  let mockOfferReasonRepository: jest.Mocked<OfferReasonRepository>
  let mockDeliveryRepository: any
  let mockDeliveryEventRepository: any
  let mockDeliveryMatchingService: any
  let mockDeliveryCalculationService: any
  let mockCourierRepository: any
  let mockConfigDomainService: any
  let mockDispatchStopRepository: any

  const deliveryId = 'del-offer-reason-1'
  const courierId = 'courier-1'

  beforeEach(() => {
    mockOfferReasonRepository = {
      create: jest.fn().mockResolvedValue({ id: 'or-1' } as any),
      findByDeliveryId: jest.fn().mockResolvedValue([]),
    } as any

    mockDeliveryRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        readyAt: null,
        foodReadyAt: null,
        undispatchedAt: null,
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
      }),
      claimOfferWithinBox: jest.fn().mockResolvedValue({
        claimed: true,
        heldUnits: 30,
        deliveryUnits: 50,
      }),
      claimForRiderWithinBox: jest.fn().mockResolvedValue({
        outcome: 'CLAIMED',
        heldUnits: 30,
        deliveryUnits: 50,
      }),
      updateIfMatches: jest.fn().mockResolvedValue({ count: 1 }),
    }

    mockDeliveryEventRepository = {
      create: jest.fn().mockImplementation((data: any) =>
        Promise.resolve({
          id: data.type === EnumDeliveryEventType.OFFERED ? 'evt-offered-1' : 'evt-event-1',
          deliveryId,
          type: data.type ?? EnumDeliveryEventType.OFFERED,
          actor: data.actor ?? EnumEventActor.SYSTEM,
        })
      ),
    }

    mockDeliveryMatchingService = {
      findCourierForDelivery: jest.fn(),
    }

    mockDeliveryCalculationService = {
      calculateDeliveryAmountsForMatchedCourier: jest.fn().mockResolvedValue({
        totalCost: 1000,
        totalCompensation: 400,
        fee: 100,
        feePercentage: 10,
      }),
    }

    mockCourierRepository = {
      findByIdOrThrow: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          userId: `user-${id}`,
          name: 'Alex Rider',
          phone: '+306912345678',
        })
      ),
      hasActiveSos: jest.fn().mockResolvedValue(false),
    }

    mockConfigDomainService = {
      instanceConfig: {
        getOfferExpiryEnabled: jest.fn().mockResolvedValue(false),
        getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
        getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
        getNoCourierRetrySeconds: jest.fn().mockResolvedValue(30),
      },
    }

    mockDispatchStopRepository = {
      findOn: jest.fn().mockResolvedValue(null),
    }

    service = new DeliveryEventService(
      {} as any, // configService
      { notifyPartner: jest.fn(), sendOfferToCourier: jest.fn(), sendOfferEnded: jest.fn() } as any, // websocketDispatcher
      mockCourierRepository,
      mockDeliveryRepository,
      mockDeliveryEventRepository,
      { scheduleOfferExpiry: jest.fn(), removeOfferExpiry: jest.fn() } as any, // taskScheduler
      { registerTaskHandler: jest.fn() } as any, // taskBusService
      { sendWebhookToPartner: jest.fn() } as any, // partnerWebhookService
      mockDeliveryMatchingService,
      mockDeliveryCalculationService,
      { removeJob: jest.fn() } as any, // bullMQService
      mockConfigDomainService,
      { get: jest.fn(), save: jest.fn() } as any, // cacheService
      { sendPushToCourier: jest.fn(), newOffer: jest.fn(), offerEnded: jest.fn() } as any, // offerPushService
      mockDispatchStopRepository,
      { getRoute: jest.fn() } as any, // osrmRoutingService
      {} as any, // courierCompensationRepository
      {} as any, // partnerChargeRepository
      {} as any, // removalRequestRepository
      mockOfferReasonRepository
    )
  })

  describe('Automatic offers in offerToNextCourier', () => {
    test('writes OfferReason with the saved event id and matcher reason', async () => {
      const matchReason = {
        strategy: EnumCourierMatcherType.FAIRNESS,
        weights: { roadTime: 50, earnings: 30, waiting: 20 },
        values: { roadSeconds: 120, centsPerHour: 800 },
        score: 0.25,
        candidateCount: 3,
        ridersInRange: 5,
        candidates: [],
      }

      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier: { id: courierId },
        distance: 400,
        travelSeconds: 120,
        reason: matchReason,
        delivery: { readyAt: null, foodReadyAt: null, undispatchedAt: null },
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
      })

      await (service as any).offerToNextCourier(deliveryId)

      expect(mockOfferReasonRepository.create).toHaveBeenCalledWith('evt-offered-1', deliveryId, courierId, matchReason)
    })

    test('failure to write OfferReason is caught and logged, offer still completes without throwing', async () => {
      mockOfferReasonRepository.create.mockRejectedValueOnce(new Error('DB write failed'))

      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValueOnce({
        courier: { id: courierId },
        distance: 400,
        travelSeconds: 120,
        reason: { strategy: EnumCourierMatcherType.FAIRNESS, values: {} },
        delivery: { readyAt: null, foodReadyAt: null, undispatchedAt: null },
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
      })

      // Must NOT throw
      await expect((service as any).offerToNextCourier(deliveryId)).resolves.not.toThrow()
      expect(mockOfferReasonRepository.create).toHaveBeenCalled()
    })
  })

  describe('Admin manual offer and reassignment', () => {
    test('offerDeliveryToCourierAsAdmin writes OfferReason with ADMIN strategy and adminUserId', async () => {
      mockDeliveryEventRepository.create.mockImplementation((data: any) =>
        Promise.resolve({
          id: data.type === EnumDeliveryEventType.OFFERED ? 'evt-admin-offered-1' : 'evt-admin-conf-1',
          type: data.type,
        })
      )

      const adminId = 'admin-user-42'
      await service.offerDeliveryToCourierAsAdmin(deliveryId, courierId, 'Hand assigned by dispatcher', false, adminId)

      expect(mockOfferReasonRepository.create).toHaveBeenCalledWith('evt-admin-offered-1', deliveryId, courierId, {
        strategy: OFFER_REASON_ADMIN,
        values: { adminUserId: adminId },
      })
    })

    test('reassignDelivery writes OfferReason with ADMIN strategy and adminUserId', async () => {
      mockDeliveryEventRepository.create.mockImplementation((data: any) =>
        Promise.resolve({
          id: data.type === EnumDeliveryEventType.OFFERED ? 'evt-reassign-offered-1' : 'evt-reassign-1',
          type: data.type,
        })
      )

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce({
          id: deliveryId,
          status: EnumDeliveryStatus.ACCEPTED,
          partnerId: 'partner-1',
          courierId: 'courier-old',
          matchedCourierId: null,
        })
        .mockResolvedValue({
          id: deliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          partnerId: 'partner-1',
          courierId: null,
          matchedCourierId: 'courier-new',
        })
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

      const adminId = 'admin-user-reassign'
      const reassignEvent = {
        deliveryId,
        type: EnumDeliveryEventType.REASSIGNED,
        actor: EnumEventActor.ADMIN,
        source: 'OPENCOURIER',
        courierId: 'courier-new',
        droppedCourierId: 'courier-old',
        message: 'Reassigned by admin',
        adminUserId: adminId,
      }

      await service.processDeliveryEvent(reassignEvent as any)

      expect(mockOfferReasonRepository.create).toHaveBeenCalledWith(
        'evt-reassign-offered-1',
        deliveryId,
        'courier-new',
        {
          strategy: OFFER_REASON_ADMIN,
          values: { adminUserId: adminId },
        }
      )
    })
  })

  describe('Matcher reason shapes', () => {
    test('adminOfferReason helper returns strategy ADMIN and adminUserId in values', () => {
      expect(adminOfferReason('adm-1')).toEqual({
        strategy: OFFER_REASON_ADMIN,
        values: { adminUserId: 'adm-1' },
      })
      expect(adminOfferReason(null)).toEqual({
        strategy: OFFER_REASON_ADMIN,
        values: { adminUserId: null },
      })
    })

    test('Nearest matcher returns NEAREST_COURIER reason shape with straightMetres', async () => {
      const mockCourierDomain = {
        getNearestAvailableCourier: jest.fn().mockResolvedValue({
          courier: { id: 'c-near' },
          distance: 350,
        }),
      }
      const mockConfig = {
        instanceConfig: {
          getMaxAssignmentDistanceInKM: jest.fn().mockResolvedValue(20),
          getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
        },
      }
      const nearestService = new NearestCourierMatcherService(mockCourierDomain as any, mockConfig as any, {} as any)

      const result = await nearestService.findCourierForDelivery({
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
        dropoffLocation: { latitude: 39.37, longitude: 22.95 },
        rejectedCourierIds: [],
      })

      expect(result?.reason).toEqual({
        strategy: EnumCourierMatcherType.NEAREST_COURIER,
        values: { straightMetres: 350 },
      })
    })

    test('Seniority matcher returns COURIER_SENIORITY reason shape with memberSince and straightMetres', async () => {
      const memberDate = new Date('2025-06-15T10:00:00Z')
      const mockCourierDomain = {
        getMostSeniorAvailableCourier: jest.fn().mockResolvedValue({
          courier: { id: 'c-senior', createdAt: memberDate },
          distance: 500,
        }),
      }
      const mockConfig = {
        instanceConfig: {
          getMaxAssignmentDistanceInKM: jest.fn().mockResolvedValue(20),
        },
      }
      const seniorityService = new CourierSeniorityMatcherService(mockCourierDomain as any, mockConfig as any)

      const result = await seniorityService.findCourierForDelivery({
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
        dropoffLocation: { latitude: 39.37, longitude: 22.95 },
        rejectedCourierIds: [],
      })

      expect(result?.reason).toEqual({
        strategy: EnumCourierMatcherType.COURIER_SENIORITY,
        values: {
          memberSince: memberDate.toISOString(),
          straightMetres: 500,
        },
      })
    })

    test('Static matcher returns STATIC reason shape with empty values', async () => {
      const staticService = new StaticCourierMatcherService()
      const result = await staticService.findCourierForDelivery({
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
        dropoffLocation: { latitude: 39.37, longitude: 22.95 },
        rejectedCourierIds: [],
      })

      expect(result?.reason).toEqual({
        strategy: EnumCourierMatcherType.STATIC,
        values: {},
      })
    })
  })
})
