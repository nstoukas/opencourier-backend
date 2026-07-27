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
    // Test Plan Case 16: Non-ongoing status (e.g. DROPPED_OFF, CREATED, ASSIGNING_COURIER)
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

    // Test Plan Case 17: Reassigning to the currently assigned courier
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

    // Gap 1: Ongoing status with null courierId
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

    // Gap 2: Unknown newCourierId
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


    // Test Plan Case 18: Happy path reassignment with DeliveryEvent assertion and pre-reassignment compensation calculation
    test('successfully reassigns delivery, emits DeliveryReassignedEvent, adds dropped rider to rejected list, and records compensation', async () => {
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

      // Assert DeliveryEvent emission (processDeliveryEvent called with REASSIGNED event)
      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith({
        deliveryId: 'del-happy',
        type: EnumDeliveryEventType.REASSIGNED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: 'courier-new',
        message: expect.stringContaining(
          'Admin reassigned delivery from courier courier-old to courier courier-new; payout policy FULL_COMPENSATION awards 350 EUR (cents) to the dropped courier: Admin note'
        ),
      })

      // Assert dropped courier added to rejected list (Redis cache)
      expect(mockCacheService.save).toHaveBeenCalledWith(
        expect.stringContaining('del-happy'),
        ['courier-old'],
        1200
      )

      // Assert CourierCompensation created with PRE-reassignment amount (350), NOT recomputed 400
      expect(mockCourierCompensationRepository.create).toHaveBeenCalledWith({
        amount: 350,
        currencyCode: 'EUR',
        reason: EnumCourierCompensationReason.REASSIGNMENT,
        policy: 'FULL_COMPENSATION',
        message: expect.stringContaining('Admin reassigned delivery'),
        courierId: 'courier-old',
        deliveryId: 'del-happy',
      })

      // Assert returned delivery is the reloaded entity
      expect(result).toEqual(reloadedDelivery)
    })

    // Test Plan Case 19: Anti-silent-drop guard when state transition does not take effect
    test('throws CantUpdateDeliveryStatusError and refrains from writing compensation row if processDeliveryEvent does not update status/matchedCourierId', async () => {
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
      // But compensation create was NOT called because transition didn't take effect!
      expect(mockCourierCompensationRepository.create).not.toHaveBeenCalled()
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
