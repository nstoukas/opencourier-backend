import { BadRequestException, NotFoundException } from '@nestjs/common'
import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumCourierCompensationReason,
} from '@prisma/types'
import { DeliveryDomainService } from './delivery.domain.service'
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
      create: jest.fn(),
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
      offerDeliveryToCourierAsAdmin: jest.fn(),
    } as unknown as jest.Mocked<DeliveryEventService>

    mockCourierRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'courier-new' }),
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
      },
    } as unknown as jest.Mocked<ConfigDomainService>

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

  describe('reassignDelivery', () => {
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
      const expectedMessage =
        'Admin reassigned delivery from courier courier-old to courier courier-new; ' +
        'payout policy FULL_COMPENSATION awards 350 EUR (cents) to the dropped courier: Admin note'

      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith({
        deliveryId: 'del-happy',
        type: EnumDeliveryEventType.REASSIGNED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: 'courier-new',
        message: expectedMessage,
      })

      // Case 9: Assert award row message and event message are character-identical
      const createCallArg = mockCourierCompensationRepository.create.mock.calls[0]![0]
      const processEventCallArg = mockDeliveryEventService.processDeliveryEvent.mock.calls[0]![0] as any
      expect(createCallArg.message).toEqual(processEventCallArg.message)

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

  // Test Plan Item 10: rejectDelivery is unaffected
  describe('rejectDelivery', () => {
    test('adds courier to rejected list and processes REJECTED event', async () => {
      const delivery = {
        id: 'del-reject',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: 'courier-1',
      }
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce(delivery as any)
      mockDeliveryRepository.update.mockResolvedValueOnce(delivery as any)

      await service.rejectDelivery('del-reject', 'courier-1')

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
  })
})
