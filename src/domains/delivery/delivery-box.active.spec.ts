import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common'
import {
  BoxSize,
  EnumCancelledBy,
  EnumCourierCompensationReason,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'
import { DeliveryDomainService } from './delivery.domain.service'
import { DeliveryEntity } from './entities/delivery.entity'
import { DeliveryWithLocationsEntity } from './entities/delivery-with-locations.entity'
import { BOX_SIZE_LOCKED_MESSAGE, BoxOverCapacityException, CantUpdateDeliveryStatusError, ErrorCode } from 'src/errors'
import { DeliveryCreatePartnerInput } from 'src/rest-api/delivery/partner/queries/delivery-create.partner.input'
import { DeliveryUpdatePartnerInput } from 'src/rest-api/delivery/partner/queries/delivery-update.partner.input'
import { DeliverySubmitEventAdminInput } from 'src/rest-api/delivery/admin/queries/delivery-submit-event.admin.input'
import { DeliveryReassignAdminInput } from 'src/rest-api/delivery/admin/queries/delivery-reassign.admin.input'
import { BOX_EVENT_TYPES, DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { adminLabel } from '../partner-billing/billing-month'

/**
 * Spec 0043 (Row 9) - Box Model Backend Tests: AC-1, AC-3, AC-6
 */
describe('Box Model: Delivery Domain & Partner/Admin Lifecycle (AC-1, AC-3, AC-6)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  // Common mock dependencies for DeliveryDomainService
  let service: DeliveryDomainService
  let mockDeliveryRepository: any
  let mockEventEmitter: any
  let mockCacheService: any
  let mockDeliveryEventService: any
  let mockCourierRepository: any
  let mockCourierCompensationRepository: any
  let mockConfigDomainService: any
  let mockPartnerRepository: any

  beforeEach(() => {
    mockDeliveryRepository = {
      findByIdOrThrow: jest.fn(),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      create: jest.fn().mockImplementation(async (data: any) => ({
        id: 'del-box-1',
        status: EnumDeliveryStatus.CREATED,
        ...data,
      })),
      update: jest.fn(),
    }

    mockEventEmitter = { emit: jest.fn() }
    mockCacheService = {
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      addWithOwnExpiry: jest.fn().mockResolvedValue(true),
      removeMember: jest.fn().mockResolvedValue(undefined),
      membersStillCounting: jest.fn().mockResolvedValue([]),
    }

    mockDeliveryEventService = {
      processDeliveryEvent: jest.fn().mockResolvedValue(undefined),
      recordBoxEvent: jest.fn().mockResolvedValue(undefined),
      refuseIfDispatchStopped: jest.fn().mockResolvedValue(undefined),
      refuseIfCourierInSos: jest.fn().mockResolvedValue(undefined),
      // Spec 0051 (cross check 7): accept, reassign and an admin hand offer ask this first.
      refuseIfCourierDeactivated: jest.fn().mockResolvedValue(undefined),
      // Spec 0046 (AC-4): the admin paths ask this before writing; no sibling leg held by default.
      refuseIfCourierHoldsSiblingLeg: jest.fn().mockResolvedValue(undefined),
      // Spec 0048 (cross check 10): a third delivery is refused before the box question.
      refuseIfCourierHoldsTwo: jest.fn().mockResolvedValue(undefined),
      offerDeliveryToCourierAsAdmin: jest.fn().mockResolvedValue(undefined),
      hasSuccessfulReassignedWithMessage: jest.fn().mockResolvedValue(true),
    }

    mockCourierRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'courier-new' }),
      heldBoxUnits: jest.fn().mockResolvedValue(0),
    }

    mockCourierCompensationRepository = {
      create: jest.fn().mockResolvedValue({ id: 'comp-box-1' }),
      deleteById: jest.fn().mockResolvedValue(undefined),
    }

    mockConfigDomainService = {
      instanceConfig: {
        getBoxDefaultSize: jest.fn().mockResolvedValue(BoxSize.MEDIUM),
        getBoxUnitsSmall: jest.fn().mockResolvedValue(30),
        getBoxUnitsMedium: jest.fn().mockResolvedValue(50),
        getBoxUnitsLarge: jest.fn().mockResolvedValue(100),
        getReassignmentPayoutPolicies: jest.fn().mockResolvedValue({
          FULL_COMPENSATION: 100,
          NO_COMPENSATION: 0,
        }),
        getReassignmentPayoutDefaultPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
        getOfferSkipMinutes: jest.fn().mockResolvedValue(20),
      },
    }

    mockPartnerRepository = {
      findById: jest.fn().mockResolvedValue(null),
    }

    service = new DeliveryDomainService(
      mockDeliveryRepository,
      mockEventEmitter,
      mockCacheService,
      mockDeliveryEventService,
      mockCourierRepository,
      mockCourierCompensationRepository,
      mockConfigDomainService,
      mockPartnerRepository
    )
  })

  // ==========================================================================
  // AC-1: Delivery gains boxSize, boxUnits, boxSizeAssumed & entity constructors
  // ==========================================================================
  describe('AC-1: Creation snapshot & entity field copying', () => {
    test('create copies boxUnits from the setting for the size at creation (Small -> 30)', async () => {
      mockConfigDomainService.instanceConfig.getBoxUnitsSmall.mockResolvedValue(30)

      await service.create({
        partnerId: 'partner-1',
        pickupName: 'Nosh',
        pickupLocationId: 'loc-1',
        dropoffLocationId: 'loc-2',
        boxSize: BoxSize.SMALL,
      } as any)

      expect(mockDeliveryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          boxSize: BoxSize.SMALL,
          boxUnits: 30,
          boxSizeAssumed: false,
        })
      )
    })

    test('create copies boxUnits from the setting for Large (Large -> 100)', async () => {
      mockConfigDomainService.instanceConfig.getBoxUnitsLarge.mockResolvedValue(100)

      await service.create({
        partnerId: 'partner-1',
        pickupName: 'Nosh',
        pickupLocationId: 'loc-1',
        dropoffLocationId: 'loc-2',
        boxSize: BoxSize.LARGE,
      } as any)

      expect(mockDeliveryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          boxSize: BoxSize.LARGE,
          boxUnits: 100,
          boxSizeAssumed: false,
        })
      )
    })

    test('changing the setting later does not change an existing delivery (the repository row is what was written)', async () => {
      // 1. Create when Medium is 50
      mockConfigDomainService.instanceConfig.getBoxUnitsMedium.mockResolvedValue(50)
      const created = await service.create({
        partnerId: 'partner-1',
        pickupName: 'Nosh',
        pickupLocationId: 'loc-1',
        dropoffLocationId: 'loc-2',
        boxSize: BoxSize.MEDIUM,
      } as any)

      expect(created.boxUnits).toBe(50)

      // 2. Setting changes to 60 later
      mockConfigDomainService.instanceConfig.getBoxUnitsMedium.mockResolvedValue(60)

      // The created delivery still has 50 units (snapshotted at creation)
      expect(created.boxUnits).toBe(50)
    })

    test('a missing size takes boxDefaultSize with boxSizeAssumed true', async () => {
      mockConfigDomainService.instanceConfig.getBoxDefaultSize.mockResolvedValue(BoxSize.MEDIUM)
      mockConfigDomainService.instanceConfig.getBoxUnitsMedium.mockResolvedValue(50)

      const result = await service.create({
        partnerId: 'partner-1',
        pickupName: 'Nosh',
        pickupLocationId: 'loc-1',
        dropoffLocationId: 'loc-2',
      } as any)

      expect(mockDeliveryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          boxSize: BoxSize.MEDIUM,
          boxUnits: 50,
          boxSizeAssumed: true,
        })
      )
      expect(result.boxSize).toBe(BoxSize.MEDIUM)
      expect(result.boxUnits).toBe(50)
      expect(result.boxSizeAssumed).toBe(true)
    })

    test('entity constructors copy boxSize, boxUnits, and boxSizeAssumed (not undefined)', () => {
      const rawData = {
        id: 'del-ent-1',
        status: EnumDeliveryStatus.CREATED,
        boxSize: BoxSize.MEDIUM,
        boxUnits: 50,
        boxSizeAssumed: true,
      } as any

      const deliveryEntity = new DeliveryEntity(rawData)
      expect(deliveryEntity.boxSize).toBe(BoxSize.MEDIUM)
      expect(deliveryEntity.boxUnits).toBe(50)
      expect(deliveryEntity.boxSizeAssumed).toBe(true)

      const deliveryWithLocations = new DeliveryWithLocationsEntity(rawData)
      expect(deliveryWithLocations.boxSize).toBe(BoxSize.MEDIUM)
      expect(deliveryWithLocations.boxUnits).toBe(50)
      expect(deliveryWithLocations.boxSizeAssumed).toBe(true)
    })
  })

  // ==========================================================================
  // AC-3: Partner create, assumed event, update, and processDeliveryEvent refusal
  // ==========================================================================
  describe('AC-3: Partner API box size create, assumed event, and update', () => {
    test('partner create with no boxSize records a BOX_SIZE_ASSUMED event (actor SYSTEM, old and new status CREATED) BEFORE the CREATED event is processed', async () => {
      const callLog: string[] = []
      mockDeliveryEventService.recordBoxEvent.mockImplementation(async (evt: any, status: any) => {
        callLog.push(`recordBoxEvent:${evt.type}:${status}`)
      })
      mockDeliveryEventService.processDeliveryEvent.mockImplementation(async (evt: any) => {
        callLog.push(`processDeliveryEvent:${evt.type}`)
      })

      await service.create({
        partnerId: 'partner-1',
        pickupName: 'Nosh',
        pickupLocationId: 'loc-1',
        dropoffLocationId: 'loc-2',
        // no boxSize
      } as any)

      expect(mockDeliveryEventService.recordBoxEvent).toHaveBeenCalledWith(
        {
          deliveryId: 'del-box-1',
          type: EnumDeliveryEventType.BOX_SIZE_ASSUMED,
          actor: EnumEventActor.SYSTEM,
          source: EnumDeliveryEventSource.OPENCOURIER,
          message: "No box size was sent, so it counts as Medium (50 units), the co-op's default",
          messageCode: 'BOX_SIZE_ASSUMED',
          messageParams: {
            size: 'MEDIUM',
            units: 50,
          },
        },
        EnumDeliveryStatus.CREATED
      )

      // Verified order: recordBoxEvent called BEFORE processDeliveryEvent
      expect(callLog).toEqual(['recordBoxEvent:BOX_SIZE_ASSUMED:CREATED', 'processDeliveryEvent:CREATED'])
    })

    test('create: when recording BOX_SIZE_ASSUMED throws, the error is logged and the CREATED event is still processed', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})
      mockDeliveryEventService.recordBoxEvent.mockRejectedValue(new Error('DB failure on event insert'))

      await service.create({
        partnerId: 'partner-1',
        pickupName: 'Nosh',
        pickupLocationId: 'loc-1',
        dropoffLocationId: 'loc-2',
      } as any)

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not record BOX_SIZE_ASSUMED for delivery del-box-1: Error: DB failure on event insert')
      )
      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.CREATED, deliveryId: 'del-box-1' })
      )
      loggerSpy.mockRestore()
    })

    test('partner create with a size records NO BOX_SIZE_ASSUMED event', async () => {
      await service.create({
        partnerId: 'partner-1',
        pickupName: 'Nosh',
        pickupLocationId: 'loc-1',
        dropoffLocationId: 'loc-2',
        boxSize: BoxSize.LARGE,
      } as any)

      expect(mockDeliveryEventService.recordBoxEvent).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.CREATED })
      )
    })

    test('an unknown size is refused by the DTO with 400 (DeliveryCreatePartnerInput)', async () => {
      const badInput = { boxSize: 'EXTRA_LARGE' }
      await expect(pipe.transform(badInput, { type: 'body', metatype: DeliveryCreatePartnerInput })).rejects.toThrow(
        BadRequestException
      )
    })

    test('an unknown size is refused by the DTO with 400 (DeliveryUpdatePartnerInput)', async () => {
      const badInput = { boxSize: 'HUGE' }
      await expect(pipe.transform(badInput, { type: 'body', metatype: DeliveryUpdatePartnerInput })).rejects.toThrow(
        BadRequestException
      )
    })

    test('partner update with a new size calls a conditional write requiring matchedCourierId null and courierId null, recopies units, clears boxSizeAssumed, and records BOX_SIZE_CHANGED (actor PARTNER)', async () => {
      mockConfigDomainService.instanceConfig.getBoxUnitsLarge.mockResolvedValue(100)
      const existingDelivery = new DeliveryEntity({
        id: 'del-update-1',
        status: EnumDeliveryStatus.CREATED,
        boxSize: BoxSize.MEDIUM,
        boxUnits: 50,
        boxSizeAssumed: true,
        matchedCourierId: null,
        courierId: null,
      } as any)

      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

      await service.changeBoxSize(existingDelivery, BoxSize.LARGE)

      // Conditional write requires matchedCourierId null and courierId null
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-update-1',
        {
          matchedCourierId: null,
          courierId: null,
          boxSize: BoxSize.MEDIUM,
          status: EnumDeliveryStatus.CREATED,
        },
        {
          boxSize: BoxSize.LARGE,
          boxUnits: 100,
          boxSizeAssumed: false,
        }
      )

      // Records BOX_SIZE_CHANGED naming old and new
      expect(mockDeliveryEventService.recordBoxEvent).toHaveBeenCalledWith(
        {
          deliveryId: 'del-update-1',
          type: EnumDeliveryEventType.BOX_SIZE_CHANGED,
          actor: EnumEventActor.PARTNER,
          source: EnumDeliveryEventSource.PARTNER_APP,
          message: 'Box size changed by the restaurant from Medium (50 units) to Large (100 units)',
          messageCode: 'BOX_SIZE_CHANGED_BY_RESTAURANT',
          messageParams: {
            fromSize: 'MEDIUM',
            fromUnits: 50,
            toSize: 'LARGE',
            toUnits: 100,
          },
        },
        EnumDeliveryStatus.CREATED
      )
    })

    test('partner update when conditional write misses (an offer is out or a rider holds it) answers 409 with BOX_SIZE_LOCKED_MESSAGE and records nothing', async () => {
      const existingDelivery = new DeliveryEntity({
        id: 'del-locked-1',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        boxSize: BoxSize.SMALL,
        boxUnits: 30,
        boxSizeAssumed: false,
        matchedCourierId: 'courier-offered',
        courierId: null,
      } as any)

      // Misses because matchedCourierId is not null
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)

      await expect(service.changeBoxSize(existingDelivery, BoxSize.MEDIUM)).rejects.toThrow(ConflictException)
      await expect(service.changeBoxSize(existingDelivery, BoxSize.MEDIUM)).rejects.toThrow(BOX_SIZE_LOCKED_MESSAGE)

      // Records nothing
      expect(mockDeliveryEventService.recordBoxEvent).not.toHaveBeenCalled()
    })

    test('processDeliveryEvent refuses each of the three box event types and records a failed row', async () => {
      // Test real deliveryEventService refusing the three box event types
      const realDeliveryEventService = new DeliveryEventService(
        {} as any,
        {} as any,
        mockCourierRepository,
        mockDeliveryRepository,
        { create: jest.fn().mockResolvedValue({ id: 'evt-failed' }) } as any,
        {} as any,
        { registerTaskHandler: jest.fn() } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        mockCacheService,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      )

      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-box-types',
        status: EnumDeliveryStatus.CREATED,
      })

      for (const eventType of BOX_EVENT_TYPES) {
        // Must throw and save a failed row in catch block, NOT silently dropped
        await realDeliveryEventService.processDeliveryEvent({
          deliveryId: 'del-box-types',
          type: eventType,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId: 'courier-1',
        } as any)
      }

      // 3 failed rows saved
      const mockEventRepo = (realDeliveryEventService as any).deliveryEventRepository
      expect(mockEventRepo.create).toHaveBeenCalledTimes(3)
      for (const call of mockEventRepo.create.mock.calls) {
        expect(call[0].transitionSuccessful).toBe(false)
        expect(call[0].message).toContain('is recorded by the box model only')
      }
    })
  })

  // ==========================================================================
  // AC-6: Admin hand offer past 100, confirmOverCapacity, and reassignment
  // ==========================================================================
  describe('AC-6: Admin capacity checks and confirmed override events', () => {
    const adminUser = {
      id: 'admin-1',
      email: 'admin@coop.gr',
      username: 'coordinator',
    }

    test('admin hand offer past 100 throws 409 with code BOX_OVER_CAPACITY, heldUnits and deliveryUnits, calling neither offer nor recordBoxEvent', async () => {
      // Rider already holds 60 units, delivery takes 50 units (60 + 50 = 110 > 100)
      mockCourierRepository.heldBoxUnits.mockResolvedValue(60)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-admin-over',
        status: EnumDeliveryStatus.CREATED,
        matchedCourierId: null,
        courierId: null,
        boxUnits: 50,
      })

      const submitCall = service.submitDeliveryEvent(
        {
          deliveryId: 'del-admin-over',
          eventType: EnumDeliveryEventType.ACCEPTED,
          courierId: 'courier-busy',
        },
        'Admin manual offer',
        adminUser
      )

      await expect(submitCall).rejects.toBeInstanceOf(BoxOverCapacityException)
      try {
        await submitCall
      } catch (err: any) {
        expect(err.getStatus()).toBe(409)
        const res = err.getResponse()
        expect(res.code).toBe(ErrorCode.BOX_OVER_CAPACITY)
        expect(res.heldUnits).toBe(60)
        expect(res.deliveryUnits).toBe(50)
      }

      expect(mockDeliveryEventService.offerDeliveryToCourierAsAdmin).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.recordBoxEvent).not.toHaveBeenCalled()
    })

    test('admin hand offer past 100 with confirmOverCapacity: true offers and THEN records BOX_OVER_CAPACITY_CONFIRMED (actor ADMIN, courierId the rider, message naming admin and units)', async () => {
      mockCourierRepository.heldBoxUnits.mockResolvedValue(60)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-admin-over',
        status: EnumDeliveryStatus.CREATED,
        matchedCourierId: null,
        courierId: null,
        boxUnits: 50,
      })

      const callOrder: string[] = []
      mockDeliveryEventService.offerDeliveryToCourierAsAdmin.mockImplementation(async () => {
        callOrder.push('offerDeliveryToCourierAsAdmin')
        return { heldUnits: 60, deliveryUnits: 50 }
      })
      mockDeliveryEventService.recordBoxEvent.mockImplementation(async (evt: any) => {
        callOrder.push(`recordBoxEvent:${evt.type}`)
      })

      await service.submitDeliveryEvent(
        {
          deliveryId: 'del-admin-over',
          eventType: EnumDeliveryEventType.ACCEPTED,
          courierId: 'courier-busy',
          confirmOverCapacity: true,
        },
        'Admin manual offer',
        adminUser
      )

      expect(callOrder).toEqual(['offerDeliveryToCourierAsAdmin', 'recordBoxEvent:BOX_OVER_CAPACITY_CONFIRMED'])
      expect(mockDeliveryEventService.offerDeliveryToCourierAsAdmin).toHaveBeenCalledWith(
        'del-admin-over',
        'courier-busy',
        'Admin manual offer',
        true,
        'admin-1'
      )

      expect(mockDeliveryEventService.recordBoxEvent).toHaveBeenCalledWith(
        {
          deliveryId: 'del-admin-over',
          type: EnumDeliveryEventType.BOX_OVER_CAPACITY_CONFIRMED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId: 'courier-busy',
          message: `${adminLabel(
            adminUser
          )} confirmed giving this order (50 units) to a rider already holding 60 of 100 units, 110 in all`,
          messageCode: 'BOX_OVER_CAPACITY_CONFIRMED',
          messageParams: {
            admin: 'admin@coop.gr',
            deliveryUnits: 50,
            heldUnits: 60,
            boxUnits: 100,
            totalUnits: 110,
          },
        },
        EnumDeliveryStatus.CREATED
      )
    })

    test('admin hand offer within 100 records no BOX_OVER_CAPACITY_CONFIRMED event', async () => {
      // Rider holds 40 units, delivery takes 50 units (40 + 50 = 90 <= 100)
      mockCourierRepository.heldBoxUnits.mockResolvedValue(40)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-admin-fits',
        status: EnumDeliveryStatus.CREATED,
        matchedCourierId: null,
        courierId: null,
        boxUnits: 50,
      })
      mockDeliveryEventService.offerDeliveryToCourierAsAdmin.mockResolvedValue({
        heldUnits: 40,
        deliveryUnits: 50,
      })

      await service.submitDeliveryEvent(
        {
          deliveryId: 'del-admin-fits',
          eventType: EnumDeliveryEventType.ACCEPTED,
          courierId: 'courier-1',
        },
        'Admin manual offer',
        adminUser
      )

      expect(mockDeliveryEventService.offerDeliveryToCourierAsAdmin).toHaveBeenCalledWith(
        'del-admin-fits',
        'courier-1',
        'Admin manual offer',
        false,
        'admin-1'
      )
      expect(mockDeliveryEventService.recordBoxEvent).not.toHaveBeenCalled()
    })

    test('submitDeliveryEvent ACCEPTED (hand offer): BOX_OVER_CAPACITY_CONFIRMED event uses numbers returned from locked write (not earlier read) and is written only when they pass 100', async () => {
      // 1. Earlier read was 60 held, 50 delivery (sum 110 > 100).
      // Under lock, a race added another order, so write returned 75 held, 50 delivery (sum 125).
      mockCourierRepository.heldBoxUnits.mockResolvedValue(60)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-admin-race',
        status: EnumDeliveryStatus.CREATED,
        matchedCourierId: null,
        courierId: null,
        boxUnits: 50,
      })
      mockDeliveryEventService.offerDeliveryToCourierAsAdmin.mockResolvedValue({
        heldUnits: 75,
        deliveryUnits: 50,
      })

      await service.submitDeliveryEvent(
        {
          deliveryId: 'del-admin-race',
          eventType: EnumDeliveryEventType.ACCEPTED,
          courierId: 'courier-busy',
          confirmOverCapacity: true,
        },
        'Admin manual offer',
        adminUser
      )

      // Event message uses the 75 units returned from the locked write (not 60 from earlier read), 125 in all
      expect(mockDeliveryEventService.recordBoxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.BOX_OVER_CAPACITY_CONFIRMED,
          message: expect.stringContaining('already holding 75 of 100 units, 125 in all'),
        }),
        EnumDeliveryStatus.CREATED
      )

      // 2. Only written when numbers pass 100:
      // Even if confirmOverCapacity was true and earlier read was > 100, if locked write returns <= 100, no event is written
      mockDeliveryEventService.recordBoxEvent.mockClear()
      mockDeliveryEventService.offerDeliveryToCourierAsAdmin.mockResolvedValue({
        heldUnits: 30,
        deliveryUnits: 50, // 30 + 50 = 80 <= 100
      })

      await service.submitDeliveryEvent(
        {
          deliveryId: 'del-admin-race',
          eventType: EnumDeliveryEventType.ACCEPTED,
          courierId: 'courier-busy',
          confirmOverCapacity: true,
        },
        'Admin manual offer',
        adminUser
      )

      expect(mockDeliveryEventService.recordBoxEvent).not.toHaveBeenCalled()
    })

    test('accepting the offer already out to the rider (matchedCourierId === courierId) does no box check', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-already-matched',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-matched',
        courierId: null,
        boxUnits: 50,
      })
      const acceptSpy = jest.spyOn(service, 'acceptDelivery').mockResolvedValue({} as any)

      await service.submitDeliveryEvent(
        {
          deliveryId: 'del-already-matched',
          eventType: EnumDeliveryEventType.ACCEPTED,
          courierId: 'courier-matched',
        },
        undefined,
        adminUser
      )

      // Did NOT call heldBoxUnits because the rider already held this open offer
      expect(mockCourierRepository.heldBoxUnits).not.toHaveBeenCalled()
      expect(acceptSpy).toHaveBeenCalledWith('del-already-matched', 'courier-matched', false, true)
      acceptSpy.mockRestore()
    })

    test('reassignDelivery over capacity throws 409 BEFORE compensation award is written (no CourierCompensation create)', async () => {
      // Rider holds 80 units, delivery takes 30 units (80 + 30 = 110 > 100)
      mockCourierRepository.heldBoxUnits.mockResolvedValue(80)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-reassign-over',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        matchedCourierId: null,
        boxUnits: 30,
        totalCompensation: 350,
        currencyCode: 'EUR',
      })

      const reassignCall = service.reassignDelivery('del-reassign-over', 'courier-new', undefined, 'note')

      await expect(reassignCall).rejects.toBeInstanceOf(BoxOverCapacityException)

      // Compensation creation was NOT called
      expect(mockCourierCompensationRepository.create).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    test('reassignDelivery confirmed: event is written once after reassignment took effect, not when rolled back', async () => {
      mockCourierRepository.heldBoxUnits.mockResolvedValue(80)
      const initialDelivery = {
        id: 'del-reassign-confirmed',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        matchedCourierId: null,
        boxUnits: 30,
        totalCompensation: 350,
        currencyCode: 'EUR',
      }
      const reloadedDelivery = {
        id: 'del-reassign-confirmed',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        matchedCourierId: 'courier-new',
        boxUnits: 30,
        totalCompensation: 400,
        currencyCode: 'EUR',
      }
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery)
        .mockResolvedValueOnce(reloadedDelivery)
        .mockResolvedValueOnce(reloadedDelivery)

      await service.reassignDelivery(
        'del-reassign-confirmed',
        'courier-new',
        undefined,
        'Reassigned with capacity confirmed',
        { confirmOverCapacity: true, admin: adminUser }
      )

      // Verified CourierCompensation created and event recorded
      expect(mockCourierCompensationRepository.create).toHaveBeenCalled()
      expect(mockDeliveryEventService.recordBoxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.BOX_OVER_CAPACITY_CONFIRMED,
          courierId: 'courier-new',
          message: expect.stringContaining(`${adminLabel(adminUser)} confirmed giving this order (30 units)`),
        }),
        EnumDeliveryStatus.ASSIGNING_COURIER
      )
    })

    test('reassignDelivery with confirmOverCapacity: when the reassignment did not take effect (rolled back), no BOX_OVER_CAPACITY_CONFIRMED is written', async () => {
      mockCourierRepository.heldBoxUnits.mockResolvedValue(80)
      const initialDelivery = {
        id: 'del-reassign-rollback',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        matchedCourierId: null,
        boxUnits: 30,
        totalCompensation: 350,
        currencyCode: 'EUR',
      }
      const reloadedDelivery = {
        ...initialDelivery,
        // courierId is still courier-old! Reassignment did not take effect!
      }
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery)
        .mockResolvedValueOnce(reloadedDelivery)

      mockDeliveryEventService.hasSuccessfulReassignedWithMessage.mockResolvedValue(false)

      await expect(
        service.reassignDelivery(
          'del-reassign-rollback',
          'courier-new',
          undefined,
          'Reassignment attempt',
          { confirmOverCapacity: true, admin: adminUser }
        )
      ).rejects.toThrow(CantUpdateDeliveryStatusError)

      // Compensation award was rolled back
      expect(mockCourierCompensationRepository.deleteById).toHaveBeenCalledWith('comp-box-1')
      // No BOX_OVER_CAPACITY_CONFIRMED was written
      expect(mockDeliveryEventService.recordBoxEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.BOX_OVER_CAPACITY_CONFIRMED }),
        expect.anything()
      )
    })
  })
})
