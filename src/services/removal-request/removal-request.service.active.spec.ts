import { ConflictException } from '@nestjs/common'
import {
  DeliveryRemovalRequest,
  EnumCancelledBy,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumRemovalRequestStatus,
} from '@prisma/types'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { RemovalRequestRepository } from 'src/persistence/repositories/removal-request.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import {
  BOARD_STALE_MESSAGE,
  ORDER_CHANGED_MESSAGE,
  REQUEST_NOT_OPEN_MESSAGE,
  RemovalRequestService,
} from './removal-request.service'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

describe('RemovalRequestService - Approve & Sweep (Spec 0035 AC-8, AC-10, AC-13)', () => {
  let service: RemovalRequestService
  let mockRemovalRequestRepository: jest.Mocked<RemovalRequestRepository>
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>
  let mockDeliveryEventRepository: jest.Mocked<DeliveryEventRepository>
  let mockDeliveryEventService: jest.Mocked<DeliveryEventService>
  let mockConfigDomainService: any

  const requestId = 'req-100'
  const deliveryId = 'del-200'
  const courierId = 'courier-rider-1'
  const adminUserId = 'admin-user-1'

  const makeDelivery = (overrides: Partial<any> = {}): DeliveryEntity =>
    new DeliveryEntity({
      id: deliveryId,
      status: EnumDeliveryStatus.ACCEPTED,
      courierId,
      partnerId: 'partner-1',
      totalCompensation: 500,
      currencyCode: 'EUR',
      ...overrides,
    } as any)

  const makeRequest = (overrides: Partial<DeliveryRemovalRequest> = {}): DeliveryRemovalRequest => ({
    id: requestId,
    deliveryId,
    courierId,
    reasonId: 'reason-breakdown',
    label: 'Moped breakdown',
    paidToRider: true,
    chargedToRestaurant: false,
    note: 'Engine died',
    status: EnumRemovalRequestStatus.OPEN,
    openFor: deliveryId,
    createdAt: new Date('2026-11-09T10:00:00.000Z'),
    decidedAt: null,
    decidedByUserId: null,
    decisionNote: null,
    payAmount: null,
    payPolicy: null,
    afterPickup: false,
    settledAt: null,
    ...overrides,
  })

  beforeEach(() => {
    mockRemovalRequestRepository = {
      findById: jest.fn().mockResolvedValue(makeRequest()),
      updateIfOpen: jest.fn().mockResolvedValue(true),
      updateIfApproved: jest.fn().mockResolvedValue(true),
      closeIfOpen: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<RemovalRequestRepository>

    mockDeliveryRepository = {
      findById: jest.fn().mockResolvedValue(makeDelivery()),
      findByIdOrThrow: jest.fn().mockResolvedValue(makeDelivery()),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockDeliveryEventRepository = {
      hasSuccessfulRemovalApprovedSince: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<DeliveryEventRepository>

    mockDeliveryEventService = {
      removeRiderBeforePickup: jest.fn().mockResolvedValue({
        id: 'evt-appr-1',
        deliveryId,
        type: EnumDeliveryEventType.REMOVAL_APPROVED,
        courierId,
        occurredAt: new Date(),
        message: 'Removal approved: Moped breakdown',
      } as any),
      finishRemovalBeforePickup: jest.fn().mockResolvedValue(undefined),
      processDeliveryEvent: jest.fn().mockResolvedValue(undefined),
      recordRemovalEvent: jest.fn().mockResolvedValue(undefined),
      settleRemoval: jest.fn().mockResolvedValue(undefined),
      notifyRemovalDecided: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeliveryEventService>

    mockConfigDomainService = {
      instanceConfig: {
        getReassignmentPayoutPolicies: jest.fn().mockResolvedValue({ FULL_COMPENSATION: 100 }),
        getReassignmentPayoutDefaultPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
        getCancellationPayoutPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
      },
    }

    service = new RemovalRequestService(
      mockRemovalRequestRepository,
      mockDeliveryRepository,
      mockDeliveryEventRepository,
      mockDeliveryEventService,
      mockConfigDomainService
    )
  })

  describe('AC-8: Approve status branching (before pickup vs after pickup)', () => {
    test.each([
      EnumDeliveryStatus.ACCEPTED,
      EnumDeliveryStatus.DISPATCHED,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
    ])('from %s the rider comes off (before pickup path)', async (status) => {
      const delivery = makeDelivery({ status })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)

      const result = await service.approve(requestId, adminUserId, false)

      // Rider comes off, order is returned to ASSIGNING_COURIER
      expect(result).toEqual({
        status: EnumRemovalRequestStatus.APPROVED,
        deliveryStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      })
      expect(mockDeliveryEventService.removeRiderBeforePickup).toHaveBeenCalledWith(
        delivery,
        courierId,
        'Moped breakdown'
      )
      expect(mockDeliveryEventService.settleRemoval).toHaveBeenCalledWith(requestId)
      expect(mockDeliveryEventService.finishRemovalBeforePickup).toHaveBeenCalled()
      // Cancellation event is NOT called on the before pickup path
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    test.each([
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.ON_THE_WAY,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
    ])('from %s the order is cancelled (after pickup path)', async (status) => {
      const delivery = makeDelivery({ status })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      // When re-reading after cancellation, delivery is CANCELED
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery({ status: EnumDeliveryStatus.CANCELED }))

      const result = await service.approve(requestId, adminUserId, true)

      expect(result).toEqual({
        status: EnumRemovalRequestStatus.APPROVED,
        deliveryStatus: EnumDeliveryStatus.CANCELED,
      })
      // Emits CANCELED event with cancelledBy: COOP
      expect(mockDeliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.CANCELED,
          cancelledBy: EnumCancelledBy.COOP,
          actor: EnumEventActor.ADMIN,
        })
      )
      // Records REMOVAL_APPROVED on the CANCELED delivery
      expect(mockDeliveryEventService.recordRemovalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.REMOVAL_APPROVED,
          deliveryId,
          courierId,
        }),
        EnumDeliveryStatus.CANCELED,
        true
      )
      expect(mockDeliveryEventService.settleRemoval).toHaveBeenCalledWith(requestId)
      // removeRiderBeforePickup is NOT called on after pickup path
      expect(mockDeliveryEventService.removeRiderBeforePickup).not.toHaveBeenCalled()
    })
  })

  describe('AC-8: pickedUp mismatch (stale board)', () => {
    test('answers 409 before anything is written when delivery is picked up but board saw false', async () => {
      const delivery = makeDelivery({ status: EnumDeliveryStatus.PICKED_UP })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)

      await expect(service.approve(requestId, adminUserId, false)).rejects.toThrow(
        new ConflictException(BOARD_STALE_MESSAGE)
      )

      expect(mockRemovalRequestRepository.updateIfOpen).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.removeRiderBeforePickup).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    test('answers 409 before anything is written when delivery is before pickup but board saw true', async () => {
      const delivery = makeDelivery({ status: EnumDeliveryStatus.DISPATCHED })
      mockDeliveryRepository.findById.mockResolvedValue(delivery)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)

      await expect(service.approve(requestId, adminUserId, true)).rejects.toThrow(
        new ConflictException(BOARD_STALE_MESSAGE)
      )

      expect(mockRemovalRequestRepository.updateIfOpen).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.removeRiderBeforePickup).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })
  })

  describe('AC-8: Request no longer open', () => {
    test.each([
      EnumRemovalRequestStatus.WITHDRAWN,
      EnumRemovalRequestStatus.DECLINED,
      EnumRemovalRequestStatus.APPROVED,
      EnumRemovalRequestStatus.CLOSED,
    ])('answers 409 and writes nothing when request is %s', async (status) => {
      mockRemovalRequestRepository.findById.mockResolvedValue(makeRequest({ status }))

      await expect(service.approve(requestId, adminUserId, false)).rejects.toThrow(
        new ConflictException(REQUEST_NOT_OPEN_MESSAGE)
      )

      expect(mockRemovalRequestRepository.updateIfOpen).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.findByIdOrThrow).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.removeRiderBeforePickup).not.toHaveBeenCalled()
    })
  })

  describe('AC-8: Second admin race (lost claim)', () => {
    test('when updateIfOpen returns false, answers 409 and removes no rider, sends no CANCELED event, and pays nothing', async () => {
      mockRemovalRequestRepository.updateIfOpen.mockResolvedValue(false)

      await expect(service.approve(requestId, adminUserId, false)).rejects.toThrow(
        new ConflictException(REQUEST_NOT_OPEN_MESSAGE)
      )

      expect(mockDeliveryEventService.removeRiderBeforePickup).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.settleRemoval).not.toHaveBeenCalled()
    })
  })

  describe('AC-8: Approve racing a pickup or withdraw (missed action write)', () => {
    test('before pickup: removeRiderBeforePickup returning null saves failed REMOVAL_APPROVED row, undoes claim, answers 409, no pay', async () => {
      mockDeliveryEventService.removeRiderBeforePickup.mockResolvedValue(null)

      await expect(service.approve(requestId, adminUserId, false)).rejects.toThrow(
        new ConflictException(ORDER_CHANGED_MESSAGE)
      )

      // Step 5: Failed REMOVAL_APPROVED row is saved
      expect(mockDeliveryEventService.recordRemovalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.REMOVAL_APPROVED,
          message: expect.stringContaining('Approval did not take'),
        }),
        EnumDeliveryStatus.ACCEPTED,
        false
      )
      // Claim is undone via updateIfApproved
      expect(mockRemovalRequestRepository.updateIfApproved).toHaveBeenCalledWith(
        requestId,
        expect.objectContaining({
          status: EnumRemovalRequestStatus.OPEN,
          openFor: deliveryId,
          decidedAt: null,
          payAmount: null,
        })
      )
      expect(mockDeliveryEventService.settleRemoval).not.toHaveBeenCalled()
    })

    test('after pickup: delivery not reading CANCELED saves failed REMOVAL_APPROVED row, undoes claim, answers 409, no pay', async () => {
      const delivery = makeDelivery({ status: EnumDeliveryStatus.PICKED_UP })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      // Delivery did not become CANCELED (e.g. was dropped off under it)
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery({ status: EnumDeliveryStatus.DROPPED_OFF }))

      await expect(service.approve(requestId, adminUserId, true)).rejects.toThrow(
        new ConflictException(ORDER_CHANGED_MESSAGE)
      )

      expect(mockDeliveryEventService.recordRemovalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.REMOVAL_APPROVED,
          message: expect.stringContaining('Approval did not take'),
        }),
        EnumDeliveryStatus.DROPPED_OFF,
        false
      )
      expect(mockRemovalRequestRepository.updateIfApproved).toHaveBeenCalledWith(
        requestId,
        expect.objectContaining({
          status: EnumRemovalRequestStatus.CLOSED,
          openFor: null,
          decidedAt: null,
        })
      )
      expect(mockDeliveryEventService.settleRemoval).not.toHaveBeenCalled()
    })
  })

  describe('AC-8: undoClaim re-reading delivery at that moment', () => {
    test('goes back to OPEN when the same rider still holds the delivery in an ongoing status', async () => {
      mockDeliveryEventService.removeRiderBeforePickup.mockResolvedValue(null)
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery({ status: EnumDeliveryStatus.DISPATCHED, courierId }))

      await expect(service.approve(requestId, adminUserId, false)).rejects.toThrow(ORDER_CHANGED_MESSAGE)

      expect(mockRemovalRequestRepository.updateIfApproved).toHaveBeenCalledWith(requestId, {
        status: EnumRemovalRequestStatus.OPEN,
        openFor: deliveryId,
        decidedAt: null,
        decidedByUserId: null,
        payAmount: null,
        payPolicy: null,
        afterPickup: false,
      })
    })

    test('goes to CLOSED when a different rider holds the delivery', async () => {
      mockDeliveryEventService.removeRiderBeforePickup.mockResolvedValue(null)
      mockDeliveryRepository.findById.mockResolvedValue(
        makeDelivery({ status: EnumDeliveryStatus.DISPATCHED, courierId: 'courier-other' })
      )

      await expect(service.approve(requestId, adminUserId, false)).rejects.toThrow(ORDER_CHANGED_MESSAGE)

      expect(mockRemovalRequestRepository.updateIfApproved).toHaveBeenCalledWith(requestId, {
        status: EnumRemovalRequestStatus.CLOSED,
        openFor: null,
        decidedAt: null,
        decidedByUserId: null,
        payAmount: null,
        payPolicy: null,
        afterPickup: false,
      })
    })

    test('goes to CLOSED when delivery status is outside DELIVERY_ONGOING_STATUSES', async () => {
      mockDeliveryEventService.removeRiderBeforePickup.mockResolvedValue(null)
      mockDeliveryRepository.findById.mockResolvedValue(
        makeDelivery({ status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId })
      )

      await expect(service.approve(requestId, adminUserId, false)).rejects.toThrow(ORDER_CHANGED_MESSAGE)

      expect(mockRemovalRequestRepository.updateIfApproved).toHaveBeenCalledWith(requestId, {
        status: EnumRemovalRequestStatus.CLOSED,
        openFor: null,
        decidedAt: null,
        decidedByUserId: null,
        payAmount: null,
        payPolicy: null,
        afterPickup: false,
      })
    })

    test('unique constraint error on openFor (new request opened meanwhile) makes it CLOSED and clears decision fields', async () => {
      mockDeliveryEventService.removeRiderBeforePickup.mockResolvedValue(null)
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery({ status: EnumDeliveryStatus.ACCEPTED, courierId }))

      // First call (attempting OPEN) fails with unique constraint error on openFor
      mockRemovalRequestRepository.updateIfApproved
        .mockRejectedValueOnce(
          new PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.x',
            meta: { target: ['openFor'] },
          })
        )
        .mockResolvedValueOnce(true)

      await expect(service.approve(requestId, adminUserId, false)).rejects.toThrow(ORDER_CHANGED_MESSAGE)

      // Fallback sets CLOSED
      expect(mockRemovalRequestRepository.updateIfApproved).toHaveBeenLastCalledWith(requestId, {
        status: EnumRemovalRequestStatus.CLOSED,
        openFor: null,
        decidedAt: null,
        decidedByUserId: null,
        payAmount: null,
        payPolicy: null,
        afterPickup: false,
      })
    })
  })

  describe('AC-8 & AC-18: Minute sweep interrupted approve (sweepApprovedUnsettled)', () => {
    const fixedNow = new Date('2026-11-09T12:00:00.000Z')
    const decidedAt3MinAgo = new Date(fixedNow.getTime() - 3 * 60 * 1000)
    const decidedAt1MinAgo = new Date(fixedNow.getTime() - 1 * 60 * 1000)

    test('APPROVED with no settledAt, over 2 minutes old, no successful REMOVAL_APPROVED: logs REMOVAL_APPROVE_INTERRUPTED and applies undoClaim', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})
      const request = makeRequest({
        status: EnumRemovalRequestStatus.APPROVED,
        decidedAt: decidedAt3MinAgo,
        settledAt: null,
      })
      mockDeliveryEventRepository.hasSuccessfulRemovalApprovedSince.mockResolvedValue(false)
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery({ status: EnumDeliveryStatus.ACCEPTED, courierId }))

      await service.sweepApprovedUnsettled(request, fixedNow)

      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('REMOVAL_APPROVE_INTERRUPTED'))
      expect(mockRemovalRequestRepository.updateIfApproved).toHaveBeenCalledWith(
        request.id,
        expect.objectContaining({ status: EnumRemovalRequestStatus.OPEN })
      )
      expect(mockDeliveryEventService.settleRemoval).not.toHaveBeenCalled()
    })

    test('APPROVED with no settledAt, under 2 minutes old: does nothing', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})
      const request = makeRequest({
        status: EnumRemovalRequestStatus.APPROVED,
        decidedAt: decidedAt1MinAgo,
        settledAt: null,
      })
      mockDeliveryEventRepository.hasSuccessfulRemovalApprovedSince.mockResolvedValue(false)

      await service.sweepApprovedUnsettled(request, fixedNow)

      expect(loggerSpy).not.toHaveBeenCalled()
      expect(mockRemovalRequestRepository.updateIfApproved).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.settleRemoval).not.toHaveBeenCalled()
    })

    test('APPROVED with no settledAt, with event on the trail: calls settleRemoval, no undo', async () => {
      const request = makeRequest({
        status: EnumRemovalRequestStatus.APPROVED,
        decidedAt: decidedAt3MinAgo,
        settledAt: null,
      })
      mockDeliveryEventRepository.hasSuccessfulRemovalApprovedSince.mockResolvedValue(true)

      await service.sweepApprovedUnsettled(request, fixedNow)

      expect(mockDeliveryEventService.settleRemoval).toHaveBeenCalledWith(request.id)
      expect(mockRemovalRequestRepository.updateIfApproved).not.toHaveBeenCalled()
    })
  })

  describe('AC-13: Amount fixed at the approve', () => {
    test('before pickup: applies reassignmentPayoutDefaultPolicy to totalCompensation', async () => {
      mockConfigDomainService.instanceConfig.getReassignmentPayoutPolicies.mockResolvedValue({
        HALF: 50,
        FULL: 100,
      })
      mockConfigDomainService.instanceConfig.getReassignmentPayoutDefaultPolicy.mockResolvedValue('HALF')
      const delivery = makeDelivery({ totalCompensation: 400 })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.findById.mockResolvedValue(delivery)

      await service.approve(requestId, adminUserId, false)

      // HALF policy gives 50% of 400 = 200 cents
      expect(mockRemovalRequestRepository.updateIfOpen).toHaveBeenCalledWith(
        requestId,
        expect.objectContaining({
          status: EnumRemovalRequestStatus.APPROVED,
          payAmount: 200,
          payPolicy: 'HALF',
          afterPickup: false,
        })
      )
    })

    test('after pickup: applies cancellationPayoutPolicy to totalCompensation', async () => {
      mockConfigDomainService.instanceConfig.getReassignmentPayoutPolicies.mockResolvedValue({
        THIRD: 33,
        FULL_COMPENSATION: 100,
      })
      mockConfigDomainService.instanceConfig.getCancellationPayoutPolicy.mockResolvedValue('THIRD')
      const delivery = makeDelivery({ status: EnumDeliveryStatus.PICKED_UP, totalCompensation: 600 })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery({ status: EnumDeliveryStatus.CANCELED }))

      await service.approve(requestId, adminUserId, true)

      // THIRD policy gives 33% of 600 = 198 cents
      expect(mockRemovalRequestRepository.updateIfOpen).toHaveBeenCalledWith(
        requestId,
        expect.objectContaining({
          status: EnumRemovalRequestStatus.APPROVED,
          payAmount: 198,
          payPolicy: 'THIRD',
          afterPickup: true,
        })
      )
    })

    test('broken setting (config domain service throws) never costs the rider: pays in full (FULL_COMPENSATION)', async () => {
      mockConfigDomainService.instanceConfig.getReassignmentPayoutPolicies.mockRejectedValue(
        new Error('Redis config cache unavailable')
      )
      const delivery = makeDelivery({ totalCompensation: 500 })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.findById.mockResolvedValue(delivery)

      await service.approve(requestId, adminUserId, false)

      // Fallback is FULL_COMPENSATION paying 500 cents
      expect(mockRemovalRequestRepository.updateIfOpen).toHaveBeenCalledWith(
        requestId,
        expect.objectContaining({
          status: EnumRemovalRequestStatus.APPROVED,
          payAmount: 500,
          payPolicy: 'FULL_COMPENSATION',
          afterPickup: false,
        })
      )
    })
  })
})
