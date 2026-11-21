import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumCourierCompensationReason,
  EnumCancelledBy,
} from '@prisma/types'
import { DeliveryDomainService, arrivalHow } from './delivery.domain.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CacheService } from 'src/services/cache/cache.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'
import { ConfigDomainService } from '../config/config.domain.service'
import { CantUpdateDeliveryStatusError } from 'src/errors'

describe('DeliveryDomainService', () => {
  let service: DeliveryDomainService
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>
  let mockEventEmitter: jest.Mocked<EventEmitter2>
  let mockCacheService: jest.Mocked<CacheService>
  let mockDeliveryEventService: jest.Mocked<DeliveryEventService>
  let mockCourierRepository: jest.Mocked<CourierRepository>
  let mockCourierCompensationRepository: jest.Mocked<CourierCompensationRepository>
  let mockConfigDomainService: jest.Mocked<ConfigDomainService>

  beforeEach(() => {
    // Plain-object mocks for all constructor dependencies
    mockDeliveryRepository = {
      findById: jest.fn(),
      findByIdOrThrow: jest.fn(),
      findByIdOrThrowWithLocations: jest.fn(),
      findByDeliveryQuoteId: jest.fn(),
      findManyPaginated: jest.fn(),
      update: jest.fn(),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      create: jest.fn(),
      findPartnerCharge: jest.fn(),
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
      // No courier is in SOS by default in these tests (spec 0022).
      refuseIfCourierInSos: jest.fn().mockResolvedValue(undefined),
      // Spec 0051 (cross check 7): accept, reassign and an admin hand offer ask this first.
      refuseIfCourierDeactivated: jest.fn().mockResolvedValue(undefined),
      offerDeliveryToCourierAsAdmin: jest.fn(),
      occurredAtForCourierTap: jest.fn(),
      hasSuccessfulReassignedWithMessage: jest.fn().mockResolvedValue(true),
      recordBoxEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeliveryEventService>

    mockCourierRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'courier-new' }),
      heldBoxUnits: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<CourierRepository>

    mockCourierCompensationRepository = {
      create: jest.fn().mockResolvedValue({ id: 'comp-1' } as any),
      deleteById: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CourierCompensationRepository>

    mockConfigDomainService = {
      instanceConfig: {
        getReassignmentPayoutPolicies: jest.fn().mockResolvedValue({
          FULL_COMPENSATION: 100,
          HALF_COMPENSATION: 50,
          NO_COMPENSATION: 0,
        }),
        getReassignmentPayoutDefaultPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
        getBoxDefaultSize: jest.fn().mockResolvedValue('MEDIUM'),
        getBoxUnitsSmall: jest.fn().mockResolvedValue(30),
        getBoxUnitsMedium: jest.fn().mockResolvedValue(50),
        getBoxUnitsLarge: jest.fn().mockResolvedValue(100),
      },
    } as unknown as jest.Mocked<ConfigDomainService>

    service = new DeliveryDomainService(
      mockDeliveryRepository,
      mockEventEmitter,
      mockCacheService,
      mockDeliveryEventService,
      mockCourierRepository,
      mockCourierCompensationRepository,
      mockConfigDomainService,
      // PartnerRepository (spec 0023): only create() reads it; its tests are in ready-signals.domain.active.spec.ts.
      { findById: jest.fn().mockResolvedValue(null) } as any
    )
  })

  describe('reassignDelivery', () => {
    test('refuses reassignment with CantUpdateDeliveryStatusError when dispatch is stopped (spec 0014, AC-4)', async () => {
      mockDeliveryEventService.refuseIfDispatchStopped.mockRejectedValueOnce(
        new CantUpdateDeliveryStatusError('Dispatch is stopped until 17:00.')
      )

      await expect(service.reassignDelivery('del-stopped', 'courier-new')).rejects.toThrow(
        'Dispatch is stopped until 17:00.'
      )
      expect(mockDeliveryRepository.findByIdOrThrow).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      expect(mockCourierCompensationRepository.create).not.toHaveBeenCalled()
    })

    // Spec 0051 (cross check 7): an admin cannot reassign a delivery to a deactivated rider (409).
    test('refuses reassignment to a deactivated rider with 409 before reading the delivery or writing an award (spec 0051)', async () => {
      mockDeliveryEventService.refuseIfCourierDeactivated.mockRejectedValueOnce(
        new ConflictException("This rider's account is deactivated.")
      )

      const call = service.reassignDelivery('del-1', 'courier-deactivated')
      await expect(call).rejects.toThrow(ConflictException)
      await expect(call).rejects.toThrow("This rider's account is deactivated.")

      expect(mockDeliveryEventService.refuseIfCourierDeactivated).toHaveBeenCalledWith('courier-deactivated')
      expect(mockDeliveryRepository.findByIdOrThrow).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      expect(mockCourierCompensationRepository.create).not.toHaveBeenCalled()
    })

    test('refuses reassignment with CantUpdateDeliveryStatusError when new courier has active SOS before reading delivery (spec 0022, AC-7)', async () => {
      mockDeliveryEventService.refuseIfCourierInSos.mockRejectedValueOnce(
        new CantUpdateDeliveryStatusError('This rider has an active SOS and cannot be given a delivery until it ends.')
      )

      await expect(service.reassignDelivery('del-sos', 'courier-in-sos')).rejects.toThrow(
        'This rider has an active SOS and cannot be given a delivery until it ends.'
      )
      expect(mockDeliveryEventService.refuseIfCourierInSos).toHaveBeenCalledWith('courier-in-sos')
      expect(mockDeliveryRepository.findByIdOrThrow).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      expect(mockCourierCompensationRepository.create).not.toHaveBeenCalled()
    })

    // Test Plan Case 17 (guards): Non-ongoing status (e.g. DROPPED_OFF, CREATED, ASSIGNING_COURIER)
    test('throws CantUpdateDeliveryStatusError and performs no side effects when delivery is not in an ongoing status', async () => {
      const nonOngoingStatuses = [
        EnumDeliveryStatus.DROPPED_OFF,
        EnumDeliveryStatus.CREATED,
        EnumDeliveryStatus.ASSIGNING_COURIER,
      ]

      for (const status of nonOngoingStatuses) {
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
          id: 'del-1',
          status,
          courierId: 'courier-old',
        } as any)

        await expect(
          service.reassignDelivery('del-1', 'courier-new')
        ).rejects.toThrow(CantUpdateDeliveryStatusError)
      }

      // Neither processDeliveryEvent nor compensation create should be called
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      expect(mockCourierCompensationRepository.create).not.toHaveBeenCalled()
    })

    // Test Plan Case 17 (guards): Reassigning to the currently assigned courier
    test('throws BadRequestException when newCourierId is equal to the currently assigned courierId', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: 'del-1',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-same',
      } as any)

      await expect(
        service.reassignDelivery('del-1', 'courier-same')
      ).rejects.toThrow(BadRequestException)

      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      expect(mockCourierCompensationRepository.create).not.toHaveBeenCalled()
    })

    // Test Plan Case 17 (guards): Ongoing status with null courierId
    test('throws CantUpdateDeliveryStatusError when delivery has no assigned courierId despite being in an ongoing status', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: 'del-no-courier',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: null,
      } as any)

      await expect(
        service.reassignDelivery('del-no-courier', 'courier-new')
      ).rejects.toThrow(CantUpdateDeliveryStatusError)

      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      expect(mockCourierCompensationRepository.create).not.toHaveBeenCalled()
    })

    // Test Plan Case 17 (guards): Unknown newCourierId
    test('throws NotFoundException when newCourierId is not found in courierRepository', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: 'del-1',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
      } as any)

      mockCourierRepository.findByIdOrThrow.mockRejectedValueOnce(new NotFoundException('Courier not found'))

      await expect(
        service.reassignDelivery('del-1', 'unknown-courier')
      ).rejects.toThrow(NotFoundException)

      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      expect(mockCourierCompensationRepository.create).not.toHaveBeenCalled()
    })

    // Test Plan Cases 7, 8, 9: Happy path reassignment with award-first ordering, DeliveryEvent emission, and exact message match
    test('successfully reassigns delivery: creates compensation row BEFORE event, emits DeliveryReassignedEvent, and adds dropped rider to rejected list', async () => {
      // 1. Initial state before reassignment: status PICKED_UP, courierId 'courier-old', totalCompensation 350
      const initialDelivery = {
        id: 'del-happy',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        matchedCourierId: null,
        totalCompensation: 350,
        currencyCode: 'EUR',
      }

      // 2. Reloaded state after processDeliveryEvent: status ASSIGNING_COURIER, matchedCourierId 'courier-new', recomputed totalCompensation 400
      const reloadedDelivery = {
        id: 'del-happy',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-new',
        courierId: null,
        totalCompensation: 400, // Recomputed for new rider
        currencyCode: 'EUR',
      }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(reloadedDelivery as any)

      const result = await service.reassignDelivery('del-happy', 'courier-new', undefined, 'Admin note')

      // Case 7: Assert compensation row creation happened BEFORE emitting event
      const createOrder = mockCourierCompensationRepository.create.mock.invocationCallOrder[0]
      const processEventOrder = mockDeliveryEventService.processDeliveryEvent.mock.invocationCallOrder[0]
      expect(createOrder).toBeDefined()
      expect(processEventOrder).toBeDefined()
      expect(createOrder!).toBeLessThan(processEventOrder!)

      // Case 7: Assert CourierCompensation created with PRE-reassignment amount (350), NOT recomputed 400
      expect(mockCourierCompensationRepository.create).toHaveBeenCalledWith({
        amount: 350,
        currencyCode: 'EUR',
        reason: EnumCourierCompensationReason.REASSIGNMENT,
        policy: 'FULL_COMPENSATION',
        message: expect.stringContaining('Admin reassigned delivery'),
        courierId: 'courier-old',
        deliveryId: 'del-happy',
      })

      // Case 7: Assert deleteById was NOT called on happy path
      expect(mockCourierCompensationRepository.deleteById).not.toHaveBeenCalled()

      // Case 8: Assert DeliveryReassignedEvent emission with exact required fields and message format
      const awardMessage =
        'Admin reassigned delivery from courier courier-old to courier courier-new; ' +
        'payout policy FULL_COMPENSATION awards 350 EUR (cents) to the dropped courier: Admin note'
      const expectedEventMessage = `${awardMessage} (award comp-1)`

      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith({
        deliveryId: 'del-happy',
        type: EnumDeliveryEventType.REASSIGNED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: 'courier-new',
        droppedCourierId: 'courier-old',
        message: expectedEventMessage,
        adminUserId: null,
      })

      // Case 9: Assert award row message and event message: event message ends with its award id
      const createCallArg = mockCourierCompensationRepository.create.mock.calls[0]![0]
      const processEventCallArg = mockDeliveryEventService.processDeliveryEvent.mock.calls[0]![0] as any
      expect(createCallArg.message).toEqual(awardMessage)
      expect(processEventCallArg.message).toEqual(`${createCallArg.message} (award comp-1)`)

      // Assert dropped courier added to rejected list (Redis cache)
      expect(mockCacheService.save).toHaveBeenCalledTimes(1)
      expect(mockCacheService.save).toHaveBeenCalledWith(
        expect.stringContaining('del-happy'),
        ['courier-old'],
        1200
      )

      // Assert returned delivery is the reloaded entity
      expect(result).toEqual(reloadedDelivery)
    })

    // Test Plan Cases 10 & 16: Anti-silent-drop guard when state transition does not take effect (award created, then deleted)
    test('throws CantUpdateDeliveryStatusError, rolls back compensation award, and logs at error level when processDeliveryEvent does not update status/matchedCourierId', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const initialDelivery = {
        id: 'del-stuck',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }

      // Mocked reload returns unchanged status (transition dropped or failed)
      const unchangedDelivery = {
        id: 'del-stuck',
        status: EnumDeliveryStatus.PICKED_UP, // Still PICKED_UP!
        courierId: 'courier-old',
        matchedCourierId: null,
        totalCompensation: 500,
        currencyCode: 'EUR',
      }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(unchangedDelivery as any)

      mockDeliveryEventService.hasSuccessfulReassignedWithMessage.mockResolvedValueOnce(false)

      await expect(
        service.reassignDelivery('del-stuck', 'courier-new')
      ).rejects.toThrow(CantUpdateDeliveryStatusError)

      // processDeliveryEvent was attempted
      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalled()
      // Under new ordering, create IS called first
      expect(mockCourierCompensationRepository.create).toHaveBeenCalledTimes(1)
      // And then deleteById is called to rollback the award
      expect(mockCourierCompensationRepository.deleteById).toHaveBeenCalledWith('comp-1')

      // Case 16: Logged at error level carrying the required fields
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/deliveryId=del-stuck.*droppedCourierId=courier-old.*amount=500.*policy=FULL_COMPENSATION/)
      )
    })

    test('Spec 0035 AC-23: award stands when hasSuccessfulReassignedWithMessage is true even if reloaded delivery has moved on / changed', async () => {
      const initialDelivery = {
        id: 'del-moved-on',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }
      // Delivery status moved on (e.g. accepted by third courier or already delivered)
      const movedOnDelivery = {
        id: 'del-moved-on',
        status: EnumDeliveryStatus.ACCEPTED,
        courierId: 'courier-third',
        matchedCourierId: null,
        totalCompensation: 500,
        currencyCode: 'EUR',
      }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(movedOnDelivery as any)

      mockDeliveryEventService.hasSuccessfulReassignedWithMessage.mockResolvedValueOnce(true)

      const result = await service.reassignDelivery('del-moved-on', 'courier-new')

      // Award stands: create was called, deleteById was NOT called
      expect(mockCourierCompensationRepository.create).toHaveBeenCalled()
      expect(mockCourierCompensationRepository.deleteById).not.toHaveBeenCalled()
      expect(result).toEqual(movedOnDelivery)
    })

    test('Spec 0035 AC-23 / decision 24.40: award stands and REASSIGNMENT_OUTCOME_UNKNOWN is logged when hasSuccessfulReassignedWithMessage is false but dropped rider is off reloaded delivery', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const initialDelivery = {
        id: 'del-looks-reassigned',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }
      // Reloaded delivery shows courierId is null (rider is off the delivery)
      const reassignedLookingDelivery = {
        id: 'del-looks-reassigned',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        matchedCourierId: 'courier-new',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(reassignedLookingDelivery as any)

      mockDeliveryEventService.hasSuccessfulReassignedWithMessage.mockResolvedValueOnce(false)

      const result = await service.reassignDelivery('del-looks-reassigned', 'courier-new')

      // Award stands because rider is off delivery: deleteById was NOT called
      expect(mockCourierCompensationRepository.deleteById).not.toHaveBeenCalled()
      expect(result).toEqual(reassignedLookingDelivery)

      // REASSIGNMENT_OUTCOME_UNKNOWN is logged
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('REASSIGNMENT_OUTCOME_UNKNOWN')
      )
    })

    test('decision 24.40 / AC-23: successful row found decides regardless of reloaded delivery: award stands and no REASSIGNMENT_OUTCOME_UNKNOWN log even if reloaded delivery still shows dropped rider', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const initialDelivery = {
        id: 'del-row-found-stale-reload',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }
      // Stale read shows the dropped rider still assigned
      const staleReloadedDelivery = {
        id: 'del-row-found-stale-reload',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        matchedCourierId: null,
        totalCompensation: 500,
        currencyCode: 'EUR',
      }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(staleReloadedDelivery as any)

      // Event row was found on the trail!
      mockDeliveryEventService.hasSuccessfulReassignedWithMessage.mockResolvedValueOnce(true)

      const result = await service.reassignDelivery('del-row-found-stale-reload', 'courier-new')

      // Award stands: deleteById is NOT called
      expect(mockCourierCompensationRepository.deleteById).not.toHaveBeenCalled()
      // Returns reloaded delivery
      expect(result).toEqual(staleReloadedDelivery)
      // No REASSIGNMENT_OUTCOME_UNKNOWN logged
      expect(loggerSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('REASSIGNMENT_OUTCOME_UNKNOWN')
      )
    })

    test('decision 24.40 / AC-23: successful row found while rider is off delivery logs no REASSIGNMENT_OUTCOME_UNKNOWN and rolls nothing back', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const initialDelivery = {
        id: 'del-row-found-rider-off',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }
      const reassignedDelivery = {
        id: 'del-row-found-rider-off',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        matchedCourierId: 'courier-new',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(reassignedDelivery as any)

      // Event row was found on the trail!
      mockDeliveryEventService.hasSuccessfulReassignedWithMessage.mockResolvedValueOnce(true)

      const result = await service.reassignDelivery('del-row-found-rider-off', 'courier-new')

      // Award stands: deleteById is NOT called
      expect(mockCourierCompensationRepository.deleteById).not.toHaveBeenCalled()
      expect(result).toEqual(reassignedDelivery)
      // Must NOT log REASSIGNMENT_OUTCOME_UNKNOWN
      expect(loggerSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('REASSIGNMENT_OUTCOME_UNKNOWN')
      )
    })

    test('decision 24.40: no successful row found and reloaded delivery still has dropped rider: award is rolled back with deleteById and throws CantUpdateDeliveryStatusError', async () => {
      jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const initialDelivery = {
        id: 'del-no-row-dropped-rider-still-on',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }
      const reloadedWithSameRider = {
        id: 'del-no-row-dropped-rider-still-on',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old', // still on delivery
        matchedCourierId: null,
        totalCompensation: 500,
        currencyCode: 'EUR',
      }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(reloadedWithSameRider as any)

      mockDeliveryEventService.hasSuccessfulReassignedWithMessage.mockResolvedValueOnce(false)

      await expect(
        service.reassignDelivery('del-no-row-dropped-rider-still-on', 'courier-new')
      ).rejects.toThrow(CantUpdateDeliveryStatusError)

      // Award is rolled back
      expect(mockCourierCompensationRepository.deleteById).toHaveBeenCalledWith('comp-1')
    })

    test('decision 24.41 / Spec 0035 AC-23: event message ends with (award <id>), hasSuccessfulReassignedWithMessage queried with exact full message, and second reassign between same two riders with failed attempt does not match first attempt message so its award is rolled back', async () => {
      jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})
      const deliveryId = 'del-double-reassign'
      const droppedCourierId = 'courier-A'
      const newCourierId = 'courier-B'

      const deliveryStateBeforeFirst = {
        id: deliveryId,
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: droppedCourierId,
        matchedCourierId: null,
        totalCompensation: 300,
        currencyCode: 'EUR',
      }
      const deliveryStateAfterFirst = {
        id: deliveryId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        matchedCourierId: newCourierId,
        totalCompensation: 300,
        currencyCode: 'EUR',
      }

      // First attempt: compensation id is 'comp-attempt-1'
      mockCourierCompensationRepository.create.mockResolvedValueOnce({ id: 'comp-attempt-1' } as any)
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(deliveryStateBeforeFirst as any)
        .mockResolvedValueOnce(deliveryStateAfterFirst as any)

      const baseAwardMessage =
        'Admin reassigned delivery from courier courier-A to courier courier-B; ' +
        'payout policy FULL_COMPENSATION awards 300 EUR (cents) to the dropped courier'
      const firstAttemptFullMessage = `${baseAwardMessage} (award comp-attempt-1)`
      const secondAttemptFullMessage = `${baseAwardMessage} (award comp-attempt-2)`

      // Fake for hasSuccessfulReassignedWithMessage:
      // Answers true ONLY if the queried message matches the first attempt's exact message saved in DB.
      // If the code queried without (award <id>), the second attempt would also match!
      const savedMessagesInDb = new Set<string>()
      mockDeliveryEventService.hasSuccessfulReassignedWithMessage.mockImplementation(
        (_delId: string, message: string) => Promise.resolve(savedMessagesInDb.has(message))
      )

      // Run first attempt:
      mockDeliveryEventService.processDeliveryEvent.mockImplementationOnce((event: any) => {
        savedMessagesInDb.add(event.message)
        return Promise.resolve()
      })

      const firstResult = await service.reassignDelivery(deliveryId, newCourierId)
      expect(firstResult).toEqual(deliveryStateAfterFirst)
      expect(mockDeliveryEventService.hasSuccessfulReassignedWithMessage).toHaveBeenCalledWith(
        deliveryId,
        firstAttemptFullMessage
      )
      expect(mockCourierCompensationRepository.deleteById).not.toHaveBeenCalled()

      // Now, second attempt between the SAME two riders on the SAME delivery:
      const deliveryStateBeforeSecond = {
        id: deliveryId,
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: droppedCourierId,
        matchedCourierId: null,
        totalCompensation: 300,
        currencyCode: 'EUR',
      }
      const deliveryStateAfterFailedSecond = {
        id: deliveryId,
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: droppedCourierId, // Rider is STILL on delivery
        matchedCourierId: null,
        totalCompensation: 300,
        currencyCode: 'EUR',
      }

      mockCourierCompensationRepository.create.mockResolvedValueOnce({ id: 'comp-attempt-2' } as any)
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(deliveryStateBeforeSecond as any)
        .mockResolvedValueOnce(deliveryStateAfterFailedSecond as any)

      // In this second attempt, processDeliveryEvent did not save the event row
      mockDeliveryEventService.processDeliveryEvent.mockResolvedValueOnce(undefined)

      await expect(service.reassignDelivery(deliveryId, newCourierId)).rejects.toThrow(
        CantUpdateDeliveryStatusError
      )

      // Verify that hasSuccessfulReassignedWithMessage was asked about the second attempt's full message
      expect(mockDeliveryEventService.hasSuccessfulReassignedWithMessage).toHaveBeenLastCalledWith(
        deliveryId,
        secondAttemptFullMessage
      )

      // Because secondAttemptFullMessage !== firstAttemptFullMessage, hasSuccessfulReassignedWithMessage returned false,
      // and reloaded delivery still shows dropped courier, the second attempt's award ('comp-attempt-2') is rolled back!
      expect(mockCourierCompensationRepository.deleteById).toHaveBeenCalledWith('comp-attempt-2')
    })

    // Test Plan Item 4: Rollback undoes the rejected-list entry it added when reassignment does not take effect
    test('removes dropped courier from rejected list when reassignment fails and entry was added by us', async () => {
      jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const initialDelivery = {
        id: 'del-undo',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }
      const unchangedDelivery = {
        id: 'del-undo',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        matchedCourierId: null,
        totalCompensation: 500,
        currencyCode: 'EUR',
      }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(unchangedDelivery as any)

      // First getOrDefault: read before add ('courier-old' not present)
      // Second getOrDefault: read before remove ('courier-old' now present alongside 'courier-other')
      mockCacheService.getOrDefault
        .mockResolvedValueOnce(['courier-other'])
        .mockResolvedValueOnce(['courier-other', 'courier-old'])

      mockDeliveryEventService.hasSuccessfulReassignedWithMessage.mockResolvedValueOnce(false)

      await expect(
        service.reassignDelivery('del-undo', 'courier-new')
      ).rejects.toThrow(CantUpdateDeliveryStatusError)

      expect(mockCourierCompensationRepository.deleteById).toHaveBeenCalledWith('comp-1')

      // Second save should remove 'courier-old' and leave 'courier-other'
      expect(mockCacheService.save).toHaveBeenCalledTimes(2)
      expect(mockCacheService.save).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('del-undo'),
        ['courier-other'],
        1200
      )
    })

    // Test Plan Item 5: Pre-existing entry is not stolen when reassignment fails
    test('does not remove dropped courier from rejected list if courier was already in rejected list prior to reassignment', async () => {
      jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const initialDelivery = {
        id: 'del-pre-existing',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }
      const unchangedDelivery = {
        id: 'del-pre-existing',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        matchedCourierId: null,
        totalCompensation: 500,
        currencyCode: 'EUR',
      }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(unchangedDelivery as any)

      // Courier-old was already in rejected list!
      mockCacheService.getOrDefault.mockResolvedValueOnce(['courier-old'])

      mockDeliveryEventService.hasSuccessfulReassignedWithMessage.mockResolvedValueOnce(false)

      await expect(
        service.reassignDelivery('del-pre-existing', 'courier-new')
      ).rejects.toThrow(CantUpdateDeliveryStatusError)

      expect(mockCourierCompensationRepository.deleteById).toHaveBeenCalledWith('comp-1')

      // save called only once during add attempt (which found already rejected), no second save call for removal
      expect(mockCacheService.save).toHaveBeenCalledTimes(1)
    })

    // Test Plan Item 6: Rejected-list write failure: failed add is not followed by removal attempt
    test('propagates error, performs no further side effects, and logs at error level when compensation row creation fails', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const initialDelivery = {
        id: 'del-fail-write',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce(initialDelivery as any)
      mockCourierCompensationRepository.create.mockRejectedValueOnce(new Error('DB write failure'))

      await expect(
        service.reassignDelivery('del-fail-write', 'courier-new')
      ).rejects.toThrow('DB write failure')

      // processDeliveryEvent and cacheService.save are NEVER called
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      expect(mockCacheService.save).not.toHaveBeenCalled()
      expect(mockCourierCompensationRepository.deleteById).not.toHaveBeenCalled()

      // Case 16: Logged at error level carrying the required fields
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/deliveryId=del-fail-write.*droppedCourierId=courier-old.*amount=500.*policy=FULL_COMPENSATION/),
        expect.any(String)
      )
    })

    // Test Plan Item 6: Rejected-list write failure (cacheService.save fails)
    test('rolls back compensation award, refrains from emitting event, and logs at error level when cacheService.save fails', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const initialDelivery = {
        id: 'del-fail-cache',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce(initialDelivery as any)
      mockCacheService.save.mockRejectedValueOnce(new Error('Redis connection lost'))

      await expect(
        service.reassignDelivery('del-fail-cache', 'courier-new')
      ).rejects.toThrow('Redis connection lost')

      // Award created, then deleted because rejected-list update failed before emitting event
      expect(mockCourierCompensationRepository.create).toHaveBeenCalledTimes(1)
      expect(mockCourierCompensationRepository.deleteById).toHaveBeenCalledWith('comp-1')
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()

      // Test Plan Item 6: save called exactly once (the failed add, not followed by removal attempt)
      expect(mockCacheService.save).toHaveBeenCalledTimes(1)

      // Case 16: Logged at error level carrying the required fields
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/deliveryId=del-fail-cache.*droppedCourierId=courier-old.*amount=500.*policy=FULL_COMPENSATION/)
      )
    })

    // Test Plan Item 7: Failed cleanup does not mask the real error
    test('propagates CantUpdateDeliveryStatusError and logs REJECTED_LIST_ROLLBACK_FAILED when cacheService.save fails during removal', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const initialDelivery = {
        id: 'del-cache-rollback-fail',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }
      const unchangedDelivery = {
        id: 'del-cache-rollback-fail',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        matchedCourierId: null,
        totalCompensation: 500,
        currencyCode: 'EUR',
      }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(unchangedDelivery as any)

      // First save succeeds (add), second save rejects (remove)
      mockCacheService.save
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Redis down'))

      mockDeliveryEventService.hasSuccessfulReassignedWithMessage.mockResolvedValueOnce(false)

      await expect(
        service.reassignDelivery('del-cache-rollback-fail', 'courier-new')
      ).rejects.toThrow(CantUpdateDeliveryStatusError)

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/REJECTED_LIST_ROLLBACK_FAILED.*deliveryId=del-cache-rollback-fail/),
        expect.any(String)
      )
    })

    // Test Plan Item 8: processDeliveryEvent throws ⇒ award KEPT (outcome unknown) & deleteById NOT called, save called exactly once
    test('keeps compensation award (deleteById NOT called) and logs at error level when processDeliveryEvent throws', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const initialDelivery = {
        id: 'del-event-error',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce(initialDelivery as any)
      mockDeliveryEventService.processDeliveryEvent.mockRejectedValueOnce(new Error('Event processing pipeline crashed'))

      await expect(
        service.reassignDelivery('del-event-error', 'courier-new')
      ).rejects.toThrow('Event processing pipeline crashed')

      // Outcome unknown: award is KEPT to protect courier income, deleteById is NOT called
      expect(mockCourierCompensationRepository.create).toHaveBeenCalledTimes(1)
      expect(mockCourierCompensationRepository.deleteById).not.toHaveBeenCalled()
      expect(mockCacheService.save).toHaveBeenCalledTimes(1)

      // Case 16: Logged at error level carrying the required fields
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/deliveryId=del-event-error.*droppedCourierId=courier-old.*amount=500.*policy=FULL_COMPENSATION/),
        expect.any(String)
      )
    })

    // Test Plan Item 8: Verification reload throws ⇒ award KEPT & deleteById NOT called, save called exactly once
    test('keeps compensation award (deleteById NOT called) and logs at error level when second findByIdOrThrow throws during verification', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const initialDelivery = {
        id: 'del-reload-error',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockRejectedValueOnce(new Error('DB read error during reload'))

      await expect(
        service.reassignDelivery('del-reload-error', 'courier-new')
      ).rejects.toThrow('DB read error during reload')

      // Outcome unknown: award is KEPT, deleteById is NOT called
      expect(mockCourierCompensationRepository.create).toHaveBeenCalledTimes(1)
      expect(mockCourierCompensationRepository.deleteById).not.toHaveBeenCalled()
      expect(mockCacheService.save).toHaveBeenCalledTimes(1)

      // Case 16: Logged at error level carrying the required fields
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/deliveryId=del-reload-error.*droppedCourierId=courier-old.*amount=500.*policy=FULL_COMPENSATION/),
        expect.any(String)
      )
    })

    // Test Plan Item 9: Double-fault test still holds (deleteById rejects, but rejected-list removal attempt still ran)
    test('preserves primary CantUpdateDeliveryStatusError when rollback deleteById rejects', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const initialDelivery = {
        id: 'del-double-fault',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        totalCompensation: 500,
        currencyCode: 'EUR',
      }
      const unchangedDelivery = {
        id: 'del-double-fault',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId: 'courier-old',
        matchedCourierId: null,
        totalCompensation: 500,
        currencyCode: 'EUR',
      }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(unchangedDelivery as any)

      // deleteById fails during rollback!
      mockCourierCompensationRepository.deleteById.mockRejectedValueOnce(new Error('Delete DB failure'))

      mockDeliveryEventService.hasSuccessfulReassignedWithMessage.mockResolvedValueOnce(false)

      await expect(
        service.reassignDelivery('del-double-fault', 'courier-new')
      ).rejects.toThrow(CantUpdateDeliveryStatusError)

      // Case 16: Logger records both REASSIGNMENT_DID_NOT_TAKE_EFFECT and AWARD_ROLLBACK_FAILED
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/REASSIGNMENT_DID_NOT_TAKE_EFFECT.*deliveryId=del-double-fault/)
      )
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/AWARD_ROLLBACK_FAILED.*deliveryId=del-double-fault/),
        expect.any(String)
      )

      // Test Plan Item 9: Rejected-list removal attempt ran despite award deletion failure
      expect(mockCacheService.save).toHaveBeenCalledTimes(2)
    })
  })

  // Test Plan Item 10: rejectDelivery uses updateIfMatches (spec 0002)
  describe('rejectDelivery', () => {
    test('adds courier to rejected list and processes REJECTED event on successful conditional update', async () => {
      const offeredAt = new Date()
      const delivery = {
        id: 'del-reject',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-1',
        offeredAt,
        courierId: null,
      }
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce(delivery as any)
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(true)

      await service.rejectDelivery('del-reject', 'courier-1')

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-reject',
        {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: 'courier-1',
          offeredAt,
          courierId: null,
        },
        {
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
        }
      )
      expect(mockCacheService.save).toHaveBeenCalledWith(
        expect.stringContaining('del-reject'),
        ['courier-1'],
        1200
      )
      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith({
        deliveryId: 'del-reject',
        type: EnumDeliveryEventType.REJECTED,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: 'courier-1',
        message: 'Courier courier-1 rejected delivery del-reject',
      })
    })

    test('throws 409 OfferHasEndedException when conditional update returns false (count 0)', async () => {
      const offeredAt = new Date()
      const delivery = {
        id: 'del-reject-stale',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-1',
        offeredAt,
        courierId: null,
      }
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce(delivery as any)
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(false)

      await expect(service.rejectDelivery('del-reject-stale', 'courier-1')).rejects.toThrow(
        'This offer has ended'
      )
      // Rider was added before clear and removed when clear matched nothing (not left on list)
      expect(mockCacheService.save).toHaveBeenLastCalledWith(
        expect.stringContaining('del-reject-stale'),
        [],
        expect.any(Number)
      )
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    test('rejectDelivery keeps pre-existing skip list entry when conditional clear misses', async () => {
      const offeredAt = new Date()
      const delivery = {
        id: 'del-reject-stale-2',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-1',
        offeredAt,
        courierId: null,
      }
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce(delivery as any)
      mockCacheService.getOrDefault.mockResolvedValueOnce(['courier-1'])
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(false)

      await expect(service.rejectDelivery('del-reject-stale-2', 'courier-1')).rejects.toThrow(
        'This offer has ended'
      )
      expect(mockCacheService.save).toHaveBeenLastCalledWith(
        expect.stringContaining('del-reject-stale-2'),
        ['courier-1'],
        expect.any(Number)
      )
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })
  })

  describe('submitDeliveryEvent', () => {
    // Test Plan Case 20: REASSIGNED in generic submitDeliveryEvent route
    test('throws BadRequestException when submitDeliveryEvent is called with REASSIGNED eventType', async () => {
      const submitEventPayload = {
        deliveryId: 'del-1',
        eventType: EnumDeliveryEventType.REASSIGNED,
      }

      await expect(
        service.submitDeliveryEvent(submitEventPayload as any)
      ).rejects.toThrow(new BadRequestException('Use POST /api/admin/v1/deliveries/:id/reassign to reassign a delivery'))
    })

    test('refuses ACCEPTED event with BadRequestException when courierId is missing (spec 0022, AC-7)', async () => {
      await expect(
        service.submitDeliveryEvent({
          deliveryId: 'del-1',
          eventType: EnumDeliveryEventType.ACCEPTED,
        } as any)
      ).rejects.toThrow(new BadRequestException('courierId is required when submitting ACCEPTED to assign a courier'))

      expect(mockDeliveryEventService.refuseIfCourierInSos).not.toHaveBeenCalled()
    })

    test('refuses ACCEPTED event with CantUpdateDeliveryStatusError when courier has active SOS before reading delivery (spec 0022, AC-7)', async () => {
      mockDeliveryEventService.refuseIfCourierInSos.mockRejectedValueOnce(
        new CantUpdateDeliveryStatusError('This rider has an active SOS and cannot be given a delivery until it ends.')
      )

      await expect(
        service.submitDeliveryEvent({
          deliveryId: 'del-1',
          eventType: EnumDeliveryEventType.ACCEPTED,
          courierId: 'courier-sos',
        })
      ).rejects.toThrow('This rider has an active SOS and cannot be given a delivery until it ends.')

      expect(mockDeliveryEventService.refuseIfCourierInSos).toHaveBeenCalledWith('courier-sos')
      expect(mockDeliveryRepository.findByIdOrThrow).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.offerDeliveryToCourierAsAdmin).not.toHaveBeenCalled()
    })

    // Spec 0051 (cross check 7): an admin's hand offer, or accept on a rider's behalf, answers 409 for a
    // deactivated rider.
    test('refuses ACCEPTED for a deactivated rider with 409 before reading the delivery, offering or accepting (spec 0051)', async () => {
      mockDeliveryEventService.refuseIfCourierDeactivated.mockRejectedValueOnce(
        new ConflictException("This rider's account is deactivated.")
      )
      const acceptSpy = jest.spyOn(service, 'acceptDelivery')

      const call = service.submitDeliveryEvent({
        deliveryId: 'del-1',
        eventType: EnumDeliveryEventType.ACCEPTED,
        courierId: 'courier-deactivated',
      })
      await expect(call).rejects.toThrow(ConflictException)
      await expect(call).rejects.toThrow("This rider's account is deactivated.")

      expect(mockDeliveryEventService.refuseIfCourierDeactivated).toHaveBeenCalledWith('courier-deactivated')
      expect(mockDeliveryRepository.findByIdOrThrow).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.offerDeliveryToCourierAsAdmin).not.toHaveBeenCalled()
      expect(acceptSpy).not.toHaveBeenCalled()
      acceptSpy.mockRestore()
    })

    test('calls acceptDelivery when courier is already matched to delivery and not in SOS (spec 0022, AC-7)', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: 'del-1',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-matched',
      } as any)
      const acceptSpy = jest.spyOn(service, 'acceptDelivery').mockResolvedValueOnce({} as any)

      await service.submitDeliveryEvent({
        deliveryId: 'del-1',
        eventType: EnumDeliveryEventType.ACCEPTED,
        courierId: 'courier-matched',
      })

      expect(mockDeliveryEventService.refuseIfCourierInSos).toHaveBeenCalledWith('courier-matched')
      expect(acceptSpy).toHaveBeenCalledWith('del-1', 'courier-matched')
      expect(mockDeliveryEventService.offerDeliveryToCourierAsAdmin).not.toHaveBeenCalled()
      acceptSpy.mockRestore()
    })

    test('calls offerDeliveryToCourierAsAdmin when courier is not matched to delivery and not in SOS (spec 0022, AC-7)', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: 'del-1',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-other',
        boxUnits: 50,
      } as any)
      mockDeliveryEventService.offerDeliveryToCourierAsAdmin.mockResolvedValue({
        heldUnits: 0,
        deliveryUnits: 50,
      })
      const acceptSpy = jest.spyOn(service, 'acceptDelivery')

      await service.submitDeliveryEvent(
        {
          deliveryId: 'del-1',
          eventType: EnumDeliveryEventType.ACCEPTED,
          courierId: 'courier-target',
        },
        'Admin assigned directly'
      )

      expect(mockDeliveryEventService.refuseIfCourierInSos).toHaveBeenCalledWith('courier-target')
      expect(mockDeliveryEventService.offerDeliveryToCourierAsAdmin).toHaveBeenCalledWith(
        'del-1',
        'courier-target',
        'Admin assigned directly',
        false,
        null
      )
      expect(acceptSpy).not.toHaveBeenCalled()
    })
  })

  describe('Courier step methods: tap and occurredAt (Spec 0009, AC-4, AC-9)', () => {
    const deliveryId = 'del-step-100'
    const courierId = 'courier-1'
    const tap = { receivedAt: new Date('2026-10-31T12:00:00.000Z'), tapAgeMs: 5000 }
    const computedOccurredAt = new Date('2026-10-31T11:59:55.000Z')

    beforeEach(() => {
      mockDeliveryEventService.occurredAtForCourierTap.mockResolvedValue(computedOccurredAt)
    })

    test('markAsDispatched puts occurredAt on event when tap provided, omits when absent', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.ACCEPTED,
      } as any)

      // With tap
      await service.markAsDispatched(deliveryId, tap)
      expect(mockDeliveryEventService.occurredAtForCourierTap).toHaveBeenCalledWith(
        expect.objectContaining({ id: deliveryId }),
        tap
      )
      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.DISPATCHED,
          occurredAt: computedOccurredAt,
        })
      )

      // Without tap
      mockDeliveryEventService.processDeliveryEvent.mockClear()
      mockDeliveryEventService.occurredAtForCourierTap.mockClear()
      await service.markAsDispatched(deliveryId)
      expect(mockDeliveryEventService.occurredAtForCourierTap).not.toHaveBeenCalled()
      const eventWithoutTap = mockDeliveryEventService.processDeliveryEvent.mock.calls[0]?.[0]
      expect(eventWithoutTap?.occurredAt).toBeUndefined()
    })

    test('markAsDispatched on a delivery not ACCEPTED throws CantUpdateDeliveryStatusError and does NOT call occurredAtForCourierTap', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.PICKED_UP,
      } as any)
      mockDeliveryEventService.occurredAtForCourierTap.mockClear()
      mockDeliveryEventService.processDeliveryEvent.mockClear()

      await expect(service.markAsDispatched(deliveryId, tap)).rejects.toThrow(
        CantUpdateDeliveryStatusError
      )

      expect(mockDeliveryEventService.occurredAtForCourierTap).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    test('courierArrivedAtPickup puts occurredAt on event when tap provided, omits when absent', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.DISPATCHED,
      } as any)

      // With tap
      await service.courierArrivedAtPickup(deliveryId, tap)
      expect(mockDeliveryEventService.occurredAtForCourierTap).toHaveBeenCalledWith(
        expect.objectContaining({ id: deliveryId }),
        tap
      )
      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: computedOccurredAt,
        })
      )

      // Without tap
      mockDeliveryEventService.processDeliveryEvent.mockClear()
      mockDeliveryEventService.occurredAtForCourierTap.mockClear()
      await service.courierArrivedAtPickup(deliveryId)
      expect(mockDeliveryEventService.occurredAtForCourierTap).not.toHaveBeenCalled()
      const eventWithoutTap = mockDeliveryEventService.processDeliveryEvent.mock.calls[0]?.[0]
      expect(eventWithoutTap?.occurredAt).toBeUndefined()
    })

    test('markAsPickedUp puts occurredAt on event when tap provided, omits when absent', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      } as any)

      // With tap
      await service.markAsPickedUp(deliveryId, tap)
      expect(mockDeliveryEventService.occurredAtForCourierTap).toHaveBeenCalledWith(
        expect.objectContaining({ id: deliveryId }),
        tap
      )
      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.PICKED_UP,
          occurredAt: computedOccurredAt,
        })
      )

      // Without tap
      mockDeliveryEventService.processDeliveryEvent.mockClear()
      mockDeliveryEventService.occurredAtForCourierTap.mockClear()
      await service.markAsPickedUp(deliveryId)
      expect(mockDeliveryEventService.occurredAtForCourierTap).not.toHaveBeenCalled()
      const eventWithoutTap = mockDeliveryEventService.processDeliveryEvent.mock.calls[0]?.[0]
      expect(eventWithoutTap?.occurredAt).toBeUndefined()
    })

    test('courierArrivedAtDropOff puts occurredAt on event when tap provided, omits when absent', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.PICKED_UP,
      } as any)

      // With tap
      await service.courierArrivedAtDropOff(deliveryId, tap)
      expect(mockDeliveryEventService.occurredAtForCourierTap).toHaveBeenCalledWith(
        expect.objectContaining({ id: deliveryId }),
        tap
      )
      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.ARRIVED_AT_DROPOFF_LOCATION,
          occurredAt: computedOccurredAt,
        })
      )

      // Without tap
      mockDeliveryEventService.processDeliveryEvent.mockClear()
      mockDeliveryEventService.occurredAtForCourierTap.mockClear()
      await service.courierArrivedAtDropOff(deliveryId)
      expect(mockDeliveryEventService.occurredAtForCourierTap).not.toHaveBeenCalled()
      const eventWithoutTap = mockDeliveryEventService.processDeliveryEvent.mock.calls[0]?.[0]
      expect(eventWithoutTap?.occurredAt).toBeUndefined()
    })

    describe('arrivalHow helper (Spec 0021 AC-4)', () => {
      it('returns " (detected by the app)" when detected is true', () => {
        expect(arrivalHow(true)).toBe(' (detected by the app)')
      })

      it('returns " (tapped by the rider)" when detected is false', () => {
        expect(arrivalHow(false)).toBe(' (tapped by the rider)')
      })

      it('returns " (tapped by the rider)" when detected is undefined', () => {
        expect(arrivalHow(undefined)).toBe(' (tapped by the rider)')
        expect(arrivalHow()).toBe(' (tapped by the rider)')
      })
    })

    describe('courierArrivedAtPickup and courierArrivedAtDropOff detected suffix (Spec 0021 AC-4)', () => {
      test('courierArrivedAtPickup includes " (detected by the app)" when detected is true', async () => {
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
          id: deliveryId,
          courierId,
          status: EnumDeliveryStatus.DISPATCHED,
        } as any)

        await service.courierArrivedAtPickup(deliveryId, undefined, true)

        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
            message: `Delivery ${deliveryId} was status changed: courier arrived at pickup location: ${courierId} (detected by the app)`,
          })
        )
      })

      test('courierArrivedAtPickup includes " (tapped by the rider)" when detected is false or omitted', async () => {
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
          id: deliveryId,
          courierId,
          status: EnumDeliveryStatus.DISPATCHED,
        } as any)

        // false
        await service.courierArrivedAtPickup(deliveryId, undefined, false)
        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenLastCalledWith(
          expect.objectContaining({
            type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
            message: `Delivery ${deliveryId} was status changed: courier arrived at pickup location: ${courierId} (tapped by the rider)`,
          })
        )

        // omitted
        await service.courierArrivedAtPickup(deliveryId)
        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenLastCalledWith(
          expect.objectContaining({
            type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
            message: `Delivery ${deliveryId} was status changed: courier arrived at pickup location: ${courierId} (tapped by the rider)`,
          })
        )
      })

      test('courierArrivedAtPickup preserves tap occurredAt alongside detected true', async () => {
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
          id: deliveryId,
          courierId,
          status: EnumDeliveryStatus.DISPATCHED,
        } as any)

        await service.courierArrivedAtPickup(deliveryId, tap, true)

        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
            occurredAt: computedOccurredAt,
            message: `Delivery ${deliveryId} was status changed: courier arrived at pickup location: ${courierId} (detected by the app)`,
          })
        )
      })

      test('courierArrivedAtDropOff includes " (detected by the app)" when detected is true', async () => {
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
          id: deliveryId,
          courierId,
          status: EnumDeliveryStatus.PICKED_UP,
        } as any)

        await service.courierArrivedAtDropOff(deliveryId, undefined, true)

        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: EnumDeliveryEventType.ARRIVED_AT_DROPOFF_LOCATION,
            message: `Delivery ${deliveryId} was status changed: courier arrived at dropoff location: ${courierId} (detected by the app)`,
          })
        )
      })

      test('courierArrivedAtDropOff includes " (tapped by the rider)" when detected is false or omitted', async () => {
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
          id: deliveryId,
          courierId,
          status: EnumDeliveryStatus.PICKED_UP,
        } as any)

        // false
        await service.courierArrivedAtDropOff(deliveryId, undefined, false)
        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenLastCalledWith(
          expect.objectContaining({
            type: EnumDeliveryEventType.ARRIVED_AT_DROPOFF_LOCATION,
            message: `Delivery ${deliveryId} was status changed: courier arrived at dropoff location: ${courierId} (tapped by the rider)`,
          })
        )

        // omitted
        await service.courierArrivedAtDropOff(deliveryId)
        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenLastCalledWith(
          expect.objectContaining({
            type: EnumDeliveryEventType.ARRIVED_AT_DROPOFF_LOCATION,
            message: `Delivery ${deliveryId} was status changed: courier arrived at dropoff location: ${courierId} (tapped by the rider)`,
          })
        )
      })

      test('courierArrivedAtDropOff preserves tap occurredAt alongside detected true', async () => {
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
          id: deliveryId,
          courierId,
          status: EnumDeliveryStatus.PICKED_UP,
        } as any)

        await service.courierArrivedAtDropOff(deliveryId, tap, true)

        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: EnumDeliveryEventType.ARRIVED_AT_DROPOFF_LOCATION,
            occurredAt: computedOccurredAt,
            message: `Delivery ${deliveryId} was status changed: courier arrived at dropoff location: ${courierId} (detected by the app)`,
          })
        )
      })
    })

    test('markAsDelivered puts occurredAt on event when tap provided, omits when absent', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      } as any)

      const deliveredData = { note: 'Left at doorstep' }

      // With tap
      await service.markAsDelivered(deliveryId, deliveredData, tap)
      expect(mockDeliveryEventService.occurredAtForCourierTap).toHaveBeenCalledWith(
        expect.objectContaining({ id: deliveryId }),
        tap
      )
      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.DROPPED_OFF,
          occurredAt: computedOccurredAt,
          deliveredData,
        })
      )

      // Without tap
      mockDeliveryEventService.processDeliveryEvent.mockClear()
      mockDeliveryEventService.occurredAtForCourierTap.mockClear()
      await service.markAsDelivered(deliveryId, deliveredData)
      expect(mockDeliveryEventService.occurredAtForCourierTap).not.toHaveBeenCalled()
      const eventWithoutTap = mockDeliveryEventService.processDeliveryEvent.mock.calls[0]?.[0]
      expect(eventWithoutTap?.occurredAt).toBeUndefined()
    })
  })

  describe('Step methods return delivery read again after processDeliveryEvent (Spec 0009, AC-6 server side)', () => {
    const deliveryId = 'del-reread-100'
    const courierId = 'courier-1'

    test('markAsDispatched returns updated delivery read after event, not stale copy read before', async () => {
      const initialDelivery = { id: deliveryId, courierId, status: EnumDeliveryStatus.ACCEPTED }
      const updatedDelivery = { id: deliveryId, courierId, status: EnumDeliveryStatus.DISPATCHED }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(updatedDelivery as any)

      const result = await service.markAsDispatched(deliveryId)

      expect(mockDeliveryRepository.findByIdOrThrow).toHaveBeenCalledTimes(2)
      expect(result).toBe(updatedDelivery)
      expect(result.status).toBe(EnumDeliveryStatus.DISPATCHED)
    })

    test('courierArrivedAtPickup returns updated delivery read after event, not stale copy read before', async () => {
      const initialDelivery = { id: deliveryId, courierId, status: EnumDeliveryStatus.DISPATCHED }
      const updatedDelivery = { id: deliveryId, courierId, status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(updatedDelivery as any)

      const result = await service.courierArrivedAtPickup(deliveryId)

      expect(mockDeliveryRepository.findByIdOrThrow).toHaveBeenCalledTimes(2)
      expect(result).toBe(updatedDelivery)
      expect(result.status).toBe(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)
    })

    test('markAsPickedUp returns updated delivery read after event, not stale copy read before', async () => {
      const initialDelivery = { id: deliveryId, courierId, status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION }
      const updatedDelivery = { id: deliveryId, courierId, status: EnumDeliveryStatus.PICKED_UP }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(updatedDelivery as any)

      const result = await service.markAsPickedUp(deliveryId)

      expect(mockDeliveryRepository.findByIdOrThrow).toHaveBeenCalledTimes(2)
      expect(result).toBe(updatedDelivery)
      expect(result.status).toBe(EnumDeliveryStatus.PICKED_UP)
    })

    test('courierArrivedAtDropOff returns updated delivery read after event, not stale copy read before', async () => {
      const initialDelivery = { id: deliveryId, courierId, status: EnumDeliveryStatus.PICKED_UP }
      const updatedDelivery = { id: deliveryId, courierId, status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(updatedDelivery as any)

      const result = await service.courierArrivedAtDropOff(deliveryId)

      expect(mockDeliveryRepository.findByIdOrThrow).toHaveBeenCalledTimes(2)
      expect(result).toBe(updatedDelivery)
      expect(result.status).toBe(EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION)
    })

    test('markAsDelivered returns updated delivery read after event, not stale copy read before', async () => {
      const initialDelivery = { id: deliveryId, courierId, status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION }
      // Say the delivery was actually CANCELED by admin meanwhile
      const updatedDelivery = { id: deliveryId, courierId, status: EnumDeliveryStatus.CANCELED }

      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initialDelivery as any)
        .mockResolvedValueOnce(updatedDelivery as any)

      const result = await service.markAsDelivered(deliveryId, {})

      expect(mockDeliveryRepository.findByIdOrThrow).toHaveBeenCalledTimes(2)
      expect(result).toBe(updatedDelivery)
      expect(result.status).toBe(EnumDeliveryStatus.CANCELED)
    })
  })

  describe('Cancellation and cancelledBy (Spec 0015 AC-5, AC-6)', () => {
    const deliveryId = 'del-cancel-test'
    const partnerId = 'partner-1'

    beforeEach(() => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: deliveryId,
        partnerId,
        status: EnumDeliveryStatus.ACCEPTED,
        courierId: 'courier-1',
      } as any)
    })

    describe('cancelDelivery', () => {
      it('defaults cancelledBy to RESTAURANT when omitted', async () => {
        await service.cancelDelivery(deliveryId)

        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            deliveryId,
            type: EnumDeliveryEventType.CANCELED,
            actor: EnumEventActor.PARTNER,
            source: EnumDeliveryEventSource.PARTNER_APP,
            cancelledBy: EnumCancelledBy.RESTAURANT,
            message: `Delivery ${deliveryId} was canceled by partner ${partnerId} (cancelled by: RESTAURANT)`,
          })
        )
      })

      it('turns null requestedBy into RESTAURANT (??, never COOP) on emitted CANCELED event (row 32 review)', async () => {
        await service.cancelDelivery(deliveryId, null as any)

        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            deliveryId,
            type: EnumDeliveryEventType.CANCELED,
            actor: EnumEventActor.PARTNER,
            source: EnumDeliveryEventSource.PARTNER_APP,
            cancelledBy: EnumCancelledBy.RESTAURANT,
            message: `Delivery ${deliveryId} was canceled by partner ${partnerId} (cancelled by: RESTAURANT)`,
          })
        )
      })

      it('turns undefined requestedBy into RESTAURANT on emitted CANCELED event', async () => {
        await service.cancelDelivery(deliveryId, undefined)

        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            deliveryId,
            type: EnumDeliveryEventType.CANCELED,
            actor: EnumEventActor.PARTNER,
            source: EnumDeliveryEventSource.PARTNER_APP,
            cancelledBy: EnumCancelledBy.RESTAURANT,
            message: `Delivery ${deliveryId} was canceled by partner ${partnerId} (cancelled by: RESTAURANT)`,
          })
        )
      })

      it('accepts explicit cancelledBy CUSTOMER', async () => {
        await service.cancelDelivery(deliveryId, EnumCancelledBy.CUSTOMER)

        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            deliveryId,
            type: EnumDeliveryEventType.CANCELED,
            cancelledBy: EnumCancelledBy.CUSTOMER,
            message: `Delivery ${deliveryId} was canceled by partner ${partnerId} (cancelled by: CUSTOMER)`,
          })
        )
      })

      it('returns the delivery read again after processDeliveryEvent (status CANCELED), not the read from before it', async () => {
        // Spec 0015 / agy review: cancelDelivery must return the freshly re-read delivery after processDeliveryEvent
        const initialDelivery = {
          id: deliveryId,
          partnerId,
          status: EnumDeliveryStatus.ACCEPTED,
          courierId: 'courier-1',
        }
        const updatedDelivery = {
          id: deliveryId,
          partnerId,
          status: EnumDeliveryStatus.CANCELED,
          courierId: 'courier-1',
          cancelledBy: EnumCancelledBy.RESTAURANT,
        }

        mockDeliveryRepository.findByIdOrThrow
          .mockResolvedValueOnce(initialDelivery as any)
          .mockResolvedValueOnce(updatedDelivery as any)

        const result = await service.cancelDelivery(deliveryId)

        // Must query findByIdOrThrow twice: once before event, once after
        expect(mockDeliveryRepository.findByIdOrThrow).toHaveBeenCalledTimes(2)
        // Must return the second findByIdOrThrow result with status CANCELED, not the stale initial read
        expect(result).toBe(updatedDelivery)
        expect(result.status).toBe(EnumDeliveryStatus.CANCELED)

        // Verify the re-read happens after processDeliveryEvent in invocation call order
        const [firstFindOrder, secondFindOrder] = mockDeliveryRepository.findByIdOrThrow.mock.invocationCallOrder
        const [processEventOrder] = mockDeliveryEventService.processDeliveryEvent.mock.invocationCallOrder

        expect(firstFindOrder).toBeDefined()
        expect(secondFindOrder).toBeDefined()
        expect(processEventOrder).toBeDefined()
        expect(firstFindOrder!).toBeLessThan(processEventOrder!)
        expect(secondFindOrder!).toBeGreaterThan(processEventOrder!)
      })
    })

    describe('submitDeliveryEvent', () => {
      it('throws BadRequestException (400) if cancelledBy is sent with an eventType other than CANCELED', async () => {
        await expect(
          service.submitDeliveryEvent({
            deliveryId,
            eventType: EnumDeliveryEventType.ACCEPTED,
            cancelledBy: EnumCancelledBy.CUSTOMER,
          } as any)
        ).rejects.toThrow(new BadRequestException('cancelledBy can only be sent with eventType CANCELED'))

        expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      })

      it('defaults cancelledBy to COOP when admin cancels with eventType CANCELED and no cancelledBy', async () => {
        await service.submitDeliveryEvent({
          deliveryId,
          eventType: EnumDeliveryEventType.CANCELED,
        })

        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            deliveryId,
            type: EnumDeliveryEventType.CANCELED,
            actor: EnumEventActor.ADMIN,
            source: EnumDeliveryEventSource.OPENCOURIER,
            cancelledBy: EnumCancelledBy.COOP,
            message: 'order canceled by admin (cancelled by: COOP)',
          })
        )
      })

      it('uses provided cancelledBy when admin cancels with eventType CANCELED', async () => {
        await service.submitDeliveryEvent({
          deliveryId,
          eventType: EnumDeliveryEventType.CANCELED,
          cancelledBy: EnumCancelledBy.CUSTOMER,
        })

        expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            deliveryId,
            type: EnumDeliveryEventType.CANCELED,
            actor: EnumEventActor.ADMIN,
            cancelledBy: EnumCancelledBy.CUSTOMER,
            message: 'order canceled by admin (cancelled by: CUSTOMER)',
          })
        )
      })
    })

    describe('getPartnerCharge', () => {
      it('delegates to deliveryRepository.findPartnerCharge', async () => {
        const mockCharge = { id: 'charge-1', amount: 1500, currencyCode: 'EUR' }
        ;(mockDeliveryRepository as any).findPartnerCharge.mockResolvedValue(mockCharge)

        const result = await service.getPartnerCharge(deliveryId)

        expect((mockDeliveryRepository as any).findPartnerCharge).toHaveBeenCalledWith(deliveryId)
        expect(result).toBe(mockCharge)
      })
    })

    describe('getCourierWaitRules (Spec 0033)', () => {
      it('returns wait rules with payOn false when delay pay is off', async () => {
        const config = (mockConfigDomainService as any).instanceConfig
        config.getWaitLimitMinutes = jest.fn().mockResolvedValue(10)
        config.getWaitPayFreeMinutes = jest.fn().mockResolvedValue(10)
        config.getWaitPayEnabled = jest.fn().mockResolvedValue(false)
        config.getWaitPayCentsPerMinute = jest.fn().mockResolvedValue(15)

        const rules = await service.getCourierWaitRules()
        expect(rules).toEqual({
          leaveMinutes: 10,
          freeMinutes: 10,
          payOn: false,
        })
      })

      it('returns wait rules with payOn false when rate is 0', async () => {
        const config = (mockConfigDomainService as any).instanceConfig
        config.getWaitLimitMinutes = jest.fn().mockResolvedValue(15)
        config.getWaitPayFreeMinutes = jest.fn().mockResolvedValue(5)
        config.getWaitPayEnabled = jest.fn().mockResolvedValue(true)
        config.getWaitPayCentsPerMinute = jest.fn().mockResolvedValue(0)

        const rules = await service.getCourierWaitRules()
        expect(rules).toEqual({
          leaveMinutes: 15,
          freeMinutes: 5,
          payOn: false,
        })
      })

      it('returns wait rules with payOn true when enabled and rate > 0', async () => {
        const config = (mockConfigDomainService as any).instanceConfig
        config.getWaitLimitMinutes = jest.fn().mockResolvedValue(10)
        config.getWaitPayFreeMinutes = jest.fn().mockResolvedValue(10)
        config.getWaitPayEnabled = jest.fn().mockResolvedValue(true)
        config.getWaitPayCentsPerMinute = jest.fn().mockResolvedValue(10)

        const rules = await service.getCourierWaitRules()
        expect(rules).toEqual({
          leaveMinutes: 10,
          freeMinutes: 10,
          payOn: true,
        })
      })
    })

    describe('getWaitCharges (Spec 0033 decision 23.20)', () => {
      it('delegates to deliveryRepository.findWaitCharges', async () => {
        const mockCharges = [{ amount: 150, currencyCode: 'EUR', createdAt: new Date() }]
        ;(mockDeliveryRepository as any).findWaitCharges = jest.fn().mockResolvedValue(mockCharges)

        const result = await service.getWaitCharges('del-1')

        expect((mockDeliveryRepository as any).findWaitCharges).toHaveBeenCalledWith('del-1')
        expect(result).toBe(mockCharges)
      })
    })
  })
})
