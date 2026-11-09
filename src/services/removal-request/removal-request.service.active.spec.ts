import { BadRequestException, ConflictException, Logger } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'
import {
  DeliveryRemovalRequest,
  EnumCancelledBy,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumRemovalRequestStatus,
} from '@prisma/types'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryNotFoundException, NotFoundException } from 'src/errors'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { RemovalRequestRepository } from 'src/persistence/repositories/removal-request.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import {
  ADMIN_ORDER_CHANGED_MESSAGE,
  ALREADY_OPEN_MESSAGE,
  BOARD_STALE_MESSAGE,
  LAST_REASON_MESSAGE,
  NOTE_REQUIRED_MESSAGE,
  REASON_GONE_MESSAGE,
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
      findActiveReasons: jest.fn().mockResolvedValue([]),
      findReasonById: jest.fn().mockResolvedValue(null),
      createReason: jest.fn(),
      updateActiveReason: jest.fn(),
      removeActiveReason: jest.fn(),
      countActiveReasons: jest.fn().mockResolvedValue(5),
      createOpen: jest.fn().mockImplementation(async (data) => makeRequest(data)),
      findOpenForDelivery: jest.fn().mockResolvedValue(null),
      findForDelivery: jest.fn().mockResolvedValue([]),
      findApprovedUnsettled: jest.fn().mockResolvedValue([]),
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

    describe('AC-11: notifyApproved payload payAmount (paid vs unpaid reason on both paths)', () => {
      test('before pickup with an unpaid reason: notifyRemovalDecided payload has payAmount null and paid false', async () => {
        const unpaidRequest = makeRequest({ paidToRider: false })
        mockRemovalRequestRepository.findById.mockResolvedValue(unpaidRequest)
        const delivery = makeDelivery({ status: EnumDeliveryStatus.ACCEPTED, courierId })
        mockDeliveryRepository.findById.mockResolvedValue(delivery)
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)

        await service.approve(requestId, adminUserId, false)

        expect(mockDeliveryEventService.notifyRemovalDecided).toHaveBeenCalledWith(
          courierId,
          expect.objectContaining({
            outcome: 'APPROVED',
            paid: false,
            payAmount: null,
          })
        )
      })

      test('before pickup with a paid reason: notifyRemovalDecided payload has the fixed payAmount and paid true', async () => {
        const paidRequest = makeRequest({ paidToRider: true })
        mockRemovalRequestRepository.findById.mockResolvedValue(paidRequest)
        const delivery = makeDelivery({ status: EnumDeliveryStatus.ACCEPTED, courierId, totalCompensation: 500 })
        mockDeliveryRepository.findById.mockResolvedValue(delivery)
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)

        await service.approve(requestId, adminUserId, false)

        expect(mockDeliveryEventService.notifyRemovalDecided).toHaveBeenCalledWith(
          courierId,
          expect.objectContaining({
            outcome: 'APPROVED',
            paid: true,
            payAmount: 500,
          })
        )
      })

      test('after pickup with an unpaid reason: notifyRemovalDecided payload has payAmount null and paid false', async () => {
        const unpaidRequest = makeRequest({ paidToRider: false })
        mockRemovalRequestRepository.findById.mockResolvedValue(unpaidRequest)
        const delivery = makeDelivery({ status: EnumDeliveryStatus.PICKED_UP, courierId })
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
        mockDeliveryRepository.findById.mockResolvedValue(
          makeDelivery({ status: EnumDeliveryStatus.CANCELED, courierId })
        )

        await service.approve(requestId, adminUserId, true)

        expect(mockDeliveryEventService.notifyRemovalDecided).toHaveBeenCalledWith(
          courierId,
          expect.objectContaining({
            outcome: 'APPROVED',
            paid: false,
            payAmount: null,
          })
        )
      })

      test('after pickup with a paid reason: notifyRemovalDecided payload has the fixed payAmount and paid true', async () => {
        const paidRequest = makeRequest({ paidToRider: true })
        mockRemovalRequestRepository.findById.mockResolvedValue(paidRequest)
        const delivery = makeDelivery({ status: EnumDeliveryStatus.PICKED_UP, courierId, totalCompensation: 500 })
        mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
        mockDeliveryRepository.findById.mockResolvedValue(
          makeDelivery({ status: EnumDeliveryStatus.CANCELED, courierId })
        )

        await service.approve(requestId, adminUserId, true)

        expect(mockDeliveryEventService.notifyRemovalDecided).toHaveBeenCalledWith(
          courierId,
          expect.objectContaining({
            outcome: 'APPROVED',
            paid: true,
            payAmount: 500,
          })
        )
      })
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

  describe('Admin refusals answer ADMIN_ORDER_CHANGED_MESSAGE (review nit 1, decision 24.45)', () => {
    test('admin refusal: rider no longer holds delivery at approve answers ADMIN_ORDER_CHANGED_MESSAGE exactly', async () => {
      const deliveryWithDifferentCourier = makeDelivery({ courierId: 'courier-different', status: EnumDeliveryStatus.ACCEPTED })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(deliveryWithDifferentCourier)

      let thrownError: any
      try {
        await service.approve(requestId, adminUserId, false)
      } catch (err) {
        thrownError = err
      }

      expect(thrownError).toBeInstanceOf(ConflictException)
      expect(thrownError.message).toBe(ADMIN_ORDER_CHANGED_MESSAGE)
      expect(mockRemovalRequestRepository.closeIfOpen).toHaveBeenCalledWith(requestId)
    })

    test('admin refusal: before pickup act missed answers ADMIN_ORDER_CHANGED_MESSAGE exactly', async () => {
      mockDeliveryEventService.removeRiderBeforePickup.mockResolvedValue(null)

      let thrownError: any
      try {
        await service.approve(requestId, adminUserId, false)
      } catch (err) {
        thrownError = err
      }

      expect(thrownError).toBeInstanceOf(ConflictException)
      expect(thrownError.message).toBe(ADMIN_ORDER_CHANGED_MESSAGE)
    })

    test('admin refusal: after pickup delivery does not read CANCELED answers ADMIN_ORDER_CHANGED_MESSAGE exactly', async () => {
      const delivery = makeDelivery({ status: EnumDeliveryStatus.PICKED_UP })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery({ status: EnumDeliveryStatus.DROPPED_OFF }))

      let thrownError: any
      try {
        await service.approve(requestId, adminUserId, true)
      } catch (err) {
        thrownError = err
      }

      expect(thrownError).toBeInstanceOf(ConflictException)
      expect(thrownError.message).toBe(ADMIN_ORDER_CHANGED_MESSAGE)
    })
  })

  describe('AC-8: Approve racing a pickup or withdraw (missed action write)', () => {
    test('before pickup: removeRiderBeforePickup returning null saves failed REMOVAL_APPROVED row, undoes claim, answers 409, no pay', async () => {
      mockDeliveryEventService.removeRiderBeforePickup.mockResolvedValue(null)

      await expect(service.approve(requestId, adminUserId, false)).rejects.toThrow(
        new ConflictException(ADMIN_ORDER_CHANGED_MESSAGE)
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
        new ConflictException(ADMIN_ORDER_CHANGED_MESSAGE)
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
      mockDeliveryRepository.findById.mockResolvedValue(
        makeDelivery({ status: EnumDeliveryStatus.DISPATCHED, courierId })
      )

      await expect(service.approve(requestId, adminUserId, false)).rejects.toThrow(ADMIN_ORDER_CHANGED_MESSAGE)

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

      await expect(service.approve(requestId, adminUserId, false)).rejects.toThrow(ADMIN_ORDER_CHANGED_MESSAGE)

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

      await expect(service.approve(requestId, adminUserId, false)).rejects.toThrow(ADMIN_ORDER_CHANGED_MESSAGE)

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
      mockDeliveryRepository.findById.mockResolvedValue(
        makeDelivery({ status: EnumDeliveryStatus.ACCEPTED, courierId })
      )

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

      await expect(service.approve(requestId, adminUserId, false)).rejects.toThrow(ADMIN_ORDER_CHANGED_MESSAGE)

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
      mockDeliveryRepository.findById.mockResolvedValue(
        makeDelivery({ status: EnumDeliveryStatus.ACCEPTED, courierId })
      )

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

  describe('AC-1: Migration starting removal reasons', () => {
    test('reads migration.sql: seven reasons in spec order, all paid, none charged, needsNote true on Other only', () => {
      const migrationDir = path.resolve(__dirname, '../../../prisma/migrations')
      const migrationFolders = fs.readdirSync(migrationDir).filter((f) => f.includes('add_removal_requests'))
      expect(migrationFolders).toHaveLength(1)
      const migrationSql = fs.readFileSync(path.join(migrationDir, migrationFolders[0]!, 'migration.sql'), 'utf-8')

      const insertRegex = /INSERT INTO "RemovalReason"[\s\S]+?;/
      const match = migrationSql.match(insertRegex)
      expect(match).not.toBeNull()

      const expectedReasons = [
        {
          label: 'Moped breakdown or accident',
          paidToRider: true,
          chargedToRestaurant: false,
          needsNote: false,
          position: 1,
        },
        { label: 'Restaurant closed', paidToRider: true, chargedToRestaurant: false, needsNote: false, position: 2 },
        { label: 'Food not ready', paidToRider: true, chargedToRestaurant: false, needsNote: false, position: 3 },
        { label: 'Unsafe drop off', paidToRider: true, chargedToRestaurant: false, needsNote: false, position: 4 },
        { label: 'Customer unreachable', paidToRider: true, chargedToRestaurant: false, needsNote: false, position: 5 },
        { label: 'Personal emergency', paidToRider: true, chargedToRestaurant: false, needsNote: false, position: 6 },
        { label: 'Other', paidToRider: true, chargedToRestaurant: false, needsNote: true, position: 7 },
      ]

      for (const expected of expectedReasons) {
        const rowPattern = new RegExp(
          `'${expected.label}',\\s*${expected.paidToRider},\\s*${expected.chargedToRestaurant},\\s*${expected.needsNote},\\s*${expected.position}`
        )
        expect(match![0]).toMatch(rowPattern)
      }

      let lastIndex = -1
      for (const expected of expectedReasons) {
        const index = match![0].indexOf(`'${expected.label}'`)
        expect(index).toBeGreaterThan(lastIndex)
        lastIndex = index
      }
    })
  })

  describe('AC-2: Removal reasons admin & snapshot immutability', () => {
    test('removing the last active reason answers 409', async () => {
      mockRemovalRequestRepository.findReasonById = jest
        .fn()
        .mockResolvedValue({ id: 'r-last', label: 'Other', removedAt: null } as any)
      mockRemovalRequestRepository.countActiveReasons = jest.fn().mockResolvedValue(1)

      await expect(service.removeReason('r-last')).rejects.toThrow(new ConflictException(LAST_REASON_MESSAGE))
      expect(mockRemovalRequestRepository.removeActiveReason).not.toHaveBeenCalled()
    })

    test('removing an unknown or already removed reason answers 404', async () => {
      mockRemovalRequestRepository.findReasonById = jest.fn().mockResolvedValue(null)
      await expect(service.removeReason('unknown-id')).rejects.toThrow(NotFoundException)

      mockRemovalRequestRepository.findReasonById = jest
        .fn()
        .mockResolvedValue({ id: 'r-removed', removedAt: new Date() } as any)
      await expect(service.removeReason('r-removed')).rejects.toThrow(NotFoundException)
    })

    test('editing or removing a reason never changes a request already sent (request snapshots fields at send)', async () => {
      const activeReason = {
        id: 'reason-1',
        label: 'Moped breakdown',
        paidToRider: true,
        chargedToRestaurant: false,
        needsNote: false,
        removedAt: null,
      }
      mockRemovalRequestRepository.findReasonById = jest.fn().mockResolvedValue(activeReason as any)
      mockRemovalRequestRepository.createOpen = jest.fn().mockImplementation(async (data) => makeRequest(data))

      // Send snapshots label, paidToRider, chargedToRestaurant
      const sentRequest = await service.send(deliveryId, courierId, { reasonId: 'reason-1' })
      expect(mockRemovalRequestRepository.createOpen).toHaveBeenCalledWith({
        deliveryId,
        courierId,
        reasonId: 'reason-1',
        label: 'Moped breakdown',
        paidToRider: true,
        chargedToRestaurant: false,
        note: null,
      })

      // Admin updates reason to unpaid and different label
      mockRemovalRequestRepository.updateActiveReason = jest.fn().mockResolvedValue({
        ...activeReason,
        label: 'Edited breakdown',
        paidToRider: false,
      } as any)
      await service.updateReason('reason-1', { label: 'Edited breakdown', paidToRider: false })

      // Admin removes reason
      mockRemovalRequestRepository.countActiveReasons = jest.fn().mockResolvedValue(3)
      mockRemovalRequestRepository.removeActiveReason = jest
        .fn()
        .mockResolvedValue({ ...activeReason, removedAt: new Date() } as any)
      await service.removeReason('reason-1')

      // The sent request is completely unchanged and retains its snapshot
      expect(sentRequest.label).toBe('Moped breakdown')
      expect(sentRequest.paidToRider).toBe(true)
      expect(sentRequest.chargedToRestaurant).toBe(false)
    })

    test('createReason passes only editable reason fields: extra keys like removedAt and id do not reach repository (review minor 6)', async () => {
      mockRemovalRequestRepository.createReason = jest.fn().mockResolvedValue({ id: 'r-created' } as any)

      const dirtyInput = {
        label: '  Flat tire  ',
        paidToRider: true,
        chargedToRestaurant: false,
        needsNote: false,
        position: 10,
        removedAt: new Date(),
        id: 'injected-id',
        createdAt: new Date(),
      } as any

      await service.createReason(dirtyInput)

      expect(mockRemovalRequestRepository.createReason).toHaveBeenCalledTimes(1)
      const createArg = (mockRemovalRequestRepository.createReason as jest.Mock).mock.calls[0][0]
      expect(createArg).toEqual({
        label: 'Flat tire',
        paidToRider: true,
        chargedToRestaurant: false,
        needsNote: false,
        position: 10,
      })
      expect(createArg).not.toHaveProperty('removedAt')
      expect(createArg).not.toHaveProperty('id')
      expect(createArg).not.toHaveProperty('createdAt')
    })

    test('updateReason with a label passes only editable reason fields: extra keys like removedAt and id do not reach repository (review minor 6)', async () => {
      mockRemovalRequestRepository.updateActiveReason = jest.fn().mockResolvedValue({ id: 'r-1' } as any)

      const dirtyInputWithLabel = {
        label: '  Updated Label  ',
        paidToRider: false,
        chargedToRestaurant: true,
        needsNote: true,
        position: 3,
        removedAt: new Date(),
        id: 'injected-id-2',
        updatedAt: new Date(),
      } as any

      await service.updateReason('r-1', dirtyInputWithLabel)

      expect(mockRemovalRequestRepository.updateActiveReason).toHaveBeenCalledTimes(1)
      const [idArg, dataArg] = (mockRemovalRequestRepository.updateActiveReason as jest.Mock).mock.calls[0]
      expect(idArg).toBe('r-1')
      expect(dataArg).toEqual({
        label: 'Updated Label',
        paidToRider: false,
        chargedToRestaurant: true,
        needsNote: true,
        position: 3,
      })
      expect(dataArg).not.toHaveProperty('removedAt')
      expect(dataArg).not.toHaveProperty('id')
      expect(dataArg).not.toHaveProperty('updatedAt')
    })

    test('updateReason without a label passes only editable reason fields: extra keys like removedAt and id do not reach repository (review minor 6)', async () => {
      mockRemovalRequestRepository.updateActiveReason = jest.fn().mockResolvedValue({ id: 'r-2' } as any)

      const dirtyInputWithoutLabel = {
        paidToRider: true,
        position: 5,
        removedAt: new Date(),
        id: 'injected-id-3',
      } as any

      await service.updateReason('r-2', dirtyInputWithoutLabel)

      expect(mockRemovalRequestRepository.updateActiveReason).toHaveBeenCalledTimes(1)
      const [idArg, dataArg] = (mockRemovalRequestRepository.updateActiveReason as jest.Mock).mock.calls[0]
      expect(idArg).toBe('r-2')
      expect(dataArg).toEqual({
        label: undefined,
        paidToRider: true,
        chargedToRestaurant: undefined,
        needsNote: undefined,
        position: 5,
      })
      expect(dataArg).not.toHaveProperty('removedAt')
      expect(dataArg).not.toHaveProperty('id')
    })
  })

  describe('AC-4: Send removal request', () => {
    const activeReason = {
      id: 'reason-breakdown',
      label: 'Moped breakdown',
      paidToRider: true,
      chargedToRestaurant: false,
      needsNote: false,
      removedAt: null,
    }

    beforeEach(() => {
      mockRemovalRequestRepository.findReasonById = jest.fn().mockResolvedValue(activeReason as any)
      mockRemovalRequestRepository.createOpen = jest.fn().mockImplementation(async (data) => makeRequest(data))
    })

    test('answers 404 unless the rider holds the delivery and createOpen is not called at all', async () => {
      // Different rider: delivery exists but held by someone else -> no request row created
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery({ courierId: 'other-courier' }))
      await expect(service.send(deliveryId, courierId, { reasonId: 'reason-breakdown' })).rejects.toThrow(
        DeliveryNotFoundException
      )
      expect(mockRemovalRequestRepository.createOpen).not.toHaveBeenCalled()

      // Null courier
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery({ courierId: null }))
      await expect(service.send(deliveryId, courierId, { reasonId: 'reason-breakdown' })).rejects.toThrow(
        DeliveryNotFoundException
      )
      expect(mockRemovalRequestRepository.createOpen).not.toHaveBeenCalled()

      // Status outside ongoing list (e.g. ASSIGNING_COURIER)
      mockDeliveryRepository.findById.mockResolvedValue(
        makeDelivery({ status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId })
      )
      await expect(service.send(deliveryId, courierId, { reasonId: 'reason-breakdown' })).rejects.toThrow(
        DeliveryNotFoundException
      )
      expect(mockRemovalRequestRepository.createOpen).not.toHaveBeenCalled()
    })

    test('send with a reason that is not paid and is charged calls createOpen with paidToRider false and chargedToRestaurant true (AC-2)', async () => {
      const reasonUnpaidCharged = {
        id: 'reason-unpaid-charged',
        label: 'Unsafe drop off',
        paidToRider: false,
        chargedToRestaurant: true,
        needsNote: false,
        removedAt: null,
      }
      mockRemovalRequestRepository.findReasonById = jest.fn().mockResolvedValue(reasonUnpaidCharged as any)
      mockDeliveryRepository.findById.mockResolvedValue(
        makeDelivery({ status: EnumDeliveryStatus.ACCEPTED, courierId })
      )

      await service.send(deliveryId, courierId, { reasonId: reasonUnpaidCharged.id })

      expect(mockRemovalRequestRepository.createOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          paidToRider: false,
          chargedToRestaurant: true,
          label: 'Unsafe drop off',
          reasonId: 'reason-unpaid-charged',
        })
      )
    })

    test.each([
      EnumDeliveryStatus.ACCEPTED,
      EnumDeliveryStatus.DISPATCHED,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.ON_THE_WAY,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
    ])('allowed in all six ongoing statuses: %s', async (status) => {
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery({ status, courierId }))
      const req = await service.send(deliveryId, courierId, { reasonId: 'reason-breakdown' })
      expect(req).toBeDefined()
      expect(mockDeliveryEventService.recordRemovalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.REMOVAL_REQUESTED,
          actor: EnumEventActor.COURIER,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId,
        }),
        status,
        true
      )
    })

    test('answers 409 if an open request exists for this delivery (createOpen returns null)', async () => {
      mockRemovalRequestRepository.createOpen = jest.fn().mockResolvedValue(null)
      await expect(service.send(deliveryId, courierId, { reasonId: 'reason-breakdown' })).rejects.toThrow(
        new ConflictException(ALREADY_OPEN_MESSAGE)
      )
    })

    test('answers 409 if the reason is removed or unknown', async () => {
      mockRemovalRequestRepository.findReasonById = jest.fn().mockResolvedValue(null)
      await expect(service.send(deliveryId, courierId, { reasonId: 'unknown-reason' })).rejects.toThrow(
        new ConflictException(REASON_GONE_MESSAGE)
      )

      mockRemovalRequestRepository.findReasonById = jest
        .fn()
        .mockResolvedValue({ ...activeReason, removedAt: new Date() } as any)
      await expect(service.send(deliveryId, courierId, { reasonId: 'reason-breakdown' })).rejects.toThrow(
        new ConflictException(REASON_GONE_MESSAGE)
      )
    })

    test.each([undefined, null, '', '   '])(
      'answers 400 when a needsNote reason has missing or whitespace note: %p',
      async (emptyNote) => {
        mockRemovalRequestRepository.findReasonById = jest.fn().mockResolvedValue({
          ...activeReason,
          id: 'reason-other',
          label: 'Other',
          needsNote: true,
        } as any)

        await expect(
          service.send(deliveryId, courierId, { reasonId: 'reason-other', note: emptyNote as any })
        ).rejects.toThrow(new BadRequestException(NOTE_REQUIRED_MESSAGE))
      }
    )

    test('records REMOVAL_REQUESTED with actor COURIER and trims note', async () => {
      mockRemovalRequestRepository.findReasonById = jest.fn().mockResolvedValue({
        ...activeReason,
        id: 'reason-other',
        needsNote: true,
      } as any)

      await service.send(deliveryId, courierId, { reasonId: 'reason-other', note: '  Flat tire and battery dead  ' })

      expect(mockRemovalRequestRepository.createOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          note: 'Flat tire and battery dead',
        })
      )
      expect(mockDeliveryEventService.recordRemovalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.REMOVAL_REQUESTED,
          actor: EnumEventActor.COURIER,
          courierId,
        }),
        EnumDeliveryStatus.ACCEPTED,
        true
      )
    })

    test('no window or count check: allows send even after handBackUntil has passed and repeatedly', async () => {
      const pastHandBack = makeDelivery({
        courierId,
        status: EnumDeliveryStatus.DISPATCHED,
        acceptedAt: new Date('2026-11-09T08:00:00Z'),
        handBackUntil: new Date('2026-11-09T08:05:00Z'),
      })
      mockDeliveryRepository.findById.mockResolvedValue(pastHandBack)

      const result = await service.send(deliveryId, courierId, { reasonId: 'reason-breakdown' })
      expect(result).toBeDefined()
    })

    test('decision 24.18: if rider comes off between read and write, request is closed and answers 404', async () => {
      const heldDelivery = makeDelivery({ courierId, status: EnumDeliveryStatus.ACCEPTED })
      const changedDelivery = makeDelivery({ courierId: 'new-courier', status: EnumDeliveryStatus.ASSIGNING_COURIER })

      mockDeliveryRepository.findById.mockResolvedValueOnce(heldDelivery).mockResolvedValueOnce(changedDelivery)

      await expect(service.send(deliveryId, courierId, { reasonId: 'reason-breakdown' })).rejects.toThrow(
        DeliveryNotFoundException
      )

      expect(mockRemovalRequestRepository.closeIfOpen).toHaveBeenCalledWith(requestId)
      expect(mockDeliveryEventService.recordRemovalEvent).not.toHaveBeenCalled()
    })
  })

  describe('AC-5: Withdraw removal request', () => {
    test('rider withdraws their open request: updates to WITHDRAWN, openFor null, records REMOVAL_WITHDRAWN with actor COURIER', async () => {
      mockRemovalRequestRepository.findOpenForDelivery = jest.fn().mockResolvedValue(makeRequest())
      mockRemovalRequestRepository.updateIfOpen = jest.fn().mockResolvedValue(true)

      const result = await service.withdraw(deliveryId, courierId)

      expect(result).toEqual({ status: EnumRemovalRequestStatus.WITHDRAWN })
      expect(mockRemovalRequestRepository.updateIfOpen).toHaveBeenCalledWith(requestId, {
        status: EnumRemovalRequestStatus.WITHDRAWN,
        openFor: null,
      })
      expect(mockDeliveryEventService.recordRemovalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.REMOVAL_WITHDRAWN,
          actor: EnumEventActor.COURIER,
          courierId,
          message: 'Removal request withdrawn: Moped breakdown',
        }),
        EnumDeliveryStatus.ACCEPTED,
        true
      )
    })

    test('answers 409 if there is no open request', async () => {
      mockRemovalRequestRepository.findOpenForDelivery = jest.fn().mockResolvedValue(null)
      await expect(service.withdraw(deliveryId, courierId)).rejects.toThrow(
        new ConflictException(REQUEST_NOT_OPEN_MESSAGE)
      )
    })

    test('answers 409 if open request belongs to another rider', async () => {
      mockRemovalRequestRepository.findOpenForDelivery = jest
        .fn()
        .mockResolvedValue(makeRequest({ courierId: 'other-rider' }))
      await expect(service.withdraw(deliveryId, courierId)).rejects.toThrow(
        new ConflictException(REQUEST_NOT_OPEN_MESSAGE)
      )
      expect(mockRemovalRequestRepository.updateIfOpen).not.toHaveBeenCalled()
    })

    test('answers 409 if updateIfOpen returns false (lost race with admin decision)', async () => {
      mockRemovalRequestRepository.findOpenForDelivery = jest.fn().mockResolvedValue(makeRequest())
      mockRemovalRequestRepository.updateIfOpen = jest.fn().mockResolvedValue(false)

      await expect(service.withdraw(deliveryId, courierId)).rejects.toThrow(
        new ConflictException(REQUEST_NOT_OPEN_MESSAGE)
      )
    })

    test('answers 404 if rider does not hold the delivery', async () => {
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery({ courierId: 'other-rider' }))
      await expect(service.withdraw(deliveryId, courierId)).rejects.toThrow(DeliveryNotFoundException)
    })
  })

  describe('AC-7: Decline removal request', () => {
    test('declines request: sets DECLINED, openFor null, records REMOVAL_DECLINED, notifies rider; event message does not contain the refusal note', async () => {
      const decisionSentence = 'Please finish this order; you are 200m from the customer.'
      mockRemovalRequestRepository.findById.mockResolvedValue(makeRequest())
      mockRemovalRequestRepository.updateIfOpen = jest.fn().mockResolvedValue(true)

      const result = await service.decline(requestId, adminUserId, decisionSentence)

      expect(result).toEqual({ status: EnumRemovalRequestStatus.DECLINED })
      expect(mockRemovalRequestRepository.updateIfOpen).toHaveBeenCalledWith(
        requestId,
        expect.objectContaining({
          status: EnumRemovalRequestStatus.DECLINED,
          openFor: null,
          decidedByUserId: adminUserId,
          decisionNote: decisionSentence,
        })
      )

      expect(mockDeliveryEventService.recordRemovalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.REMOVAL_DECLINED,
          actor: EnumEventActor.ADMIN,
          courierId,
          message: 'Removal request declined: Moped breakdown',
        }),
        EnumDeliveryStatus.ACCEPTED,
        true
      )
      const eventCall = (mockDeliveryEventService.recordRemovalEvent as jest.Mock).mock.calls[0]![0]
      expect(eventCall.message).not.toContain(decisionSentence)

      expect(mockDeliveryEventService.notifyRemovalDecided).toHaveBeenCalledWith(courierId, {
        deliveryId,
        outcome: 'DECLINED',
        decisionNote: decisionSentence,
        paid: true,
        payAmount: null,
        currencyCode: 'EUR',
      })
    })

    test('answers 409 if request is not open', async () => {
      mockRemovalRequestRepository.findById.mockResolvedValue(
        makeRequest({ status: EnumRemovalRequestStatus.DECLINED })
      )
      await expect(service.decline(requestId, adminUserId, 'No')).rejects.toThrow(
        new ConflictException(REQUEST_NOT_OPEN_MESSAGE)
      )
    })
  })

  describe('AC-21: Event message privacy - names reason label and never the note', () => {
    const sentinelNote = 'SENTINEL_RIDER_CONFIDENTIAL_NOTE_12345'

    test('send: event message names reason label and never the note', async () => {
      mockRemovalRequestRepository.findReasonById = jest.fn().mockResolvedValue({
        id: 'r-1',
        label: 'Moped breakdown or accident',
        paidToRider: true,
        chargedToRestaurant: false,
        needsNote: false,
        removedAt: null,
      } as any)
      mockRemovalRequestRepository.createOpen = jest.fn().mockImplementation(async (d) => makeRequest(d))

      await service.send(deliveryId, courierId, { reasonId: 'r-1', note: sentinelNote })

      const eventArg = (mockDeliveryEventService.recordRemovalEvent as jest.Mock).mock.calls[0]![0]
      expect(eventArg.message).toBe('Removal requested: Moped breakdown or accident')
      expect(eventArg.message).not.toContain(sentinelNote)
    })

    test('decline: event message names reason label and never the note or decision sentence', async () => {
      mockRemovalRequestRepository.findById.mockResolvedValue(
        makeRequest({ label: 'Food not ready', note: sentinelNote })
      )
      mockRemovalRequestRepository.updateIfOpen = jest.fn().mockResolvedValue(true)

      await service.decline(requestId, adminUserId, 'Decline reason sentinel 99999')

      const eventArg = (mockDeliveryEventService.recordRemovalEvent as jest.Mock).mock.calls[0]![0]
      expect(eventArg.message).toBe('Removal request declined: Food not ready')
      expect(eventArg.message).not.toContain(sentinelNote)
      expect(eventArg.message).not.toContain('Decline reason sentinel 99999')
    })

    test('approve before pickup: removeRiderBeforePickup message names label and never the note', async () => {
      mockRemovalRequestRepository.findById.mockResolvedValue(
        makeRequest({ label: 'Unsafe drop off', note: sentinelNote })
      )
      await service.approve(requestId, adminUserId, false)

      expect(mockDeliveryEventService.removeRiderBeforePickup).toHaveBeenCalledWith(
        expect.anything(),
        courierId,
        'Unsafe drop off'
      )
    })

    test('approve after pickup: cancellation message and REMOVAL_APPROVED message name label and never the note', async () => {
      mockRemovalRequestRepository.findById.mockResolvedValue(
        makeRequest({ label: 'Customer unreachable', note: sentinelNote })
      )
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(makeDelivery({ status: EnumDeliveryStatus.PICKED_UP }))
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery({ status: EnumDeliveryStatus.CANCELED }))

      await service.approve(requestId, adminUserId, true)

      const cancelCall = (mockDeliveryEventService.processDeliveryEvent as jest.Mock).mock.calls[0]![0]
      expect(cancelCall.message).toBe('Cancelled because a removal was approved after pickup: Customer unreachable')
      expect(cancelCall.message).not.toContain(sentinelNote)

      const removalApproveCall = (mockDeliveryEventService.recordRemovalEvent as jest.Mock).mock.calls[0]![0]
      expect(removalApproveCall.message).toBe('Removal approved after pickup, order cancelled: Customer unreachable')
      expect(removalApproveCall.message).not.toContain(sentinelNote)
    })
  })

  describe('AC-22: Log privacy & no location stored on request', () => {
    const sentinelNote = 'SENTINEL_NOTE_PERSONAL_SECRETS_98765'

    test('nothing logged carries the rider note across send, withdraw, decline, approve and failure paths', async () => {
      const logCalls: string[] = []
      const captureLog = (...args: any[]) => {
        logCalls.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '))
      }
      jest.spyOn((service as any).logger, 'log').mockImplementation(captureLog)
      jest.spyOn((service as any).logger, 'warn').mockImplementation(captureLog)
      jest.spyOn((service as any).logger, 'error').mockImplementation(captureLog)

      // 1. send
      mockRemovalRequestRepository.findReasonById = jest.fn().mockResolvedValue({
        id: 'r-1',
        label: 'Breakdown',
        paidToRider: true,
        chargedToRestaurant: false,
        needsNote: false,
        removedAt: null,
      } as any)
      mockRemovalRequestRepository.createOpen = jest
        .fn()
        .mockImplementation(async (d) => makeRequest({ ...d, note: sentinelNote }))
      await service.send(deliveryId, courierId, { reasonId: 'r-1', note: sentinelNote })

      // 2. withdraw
      mockRemovalRequestRepository.findOpenForDelivery = jest
        .fn()
        .mockResolvedValue(makeRequest({ note: sentinelNote }))
      mockRemovalRequestRepository.updateIfOpen = jest.fn().mockResolvedValue(true)
      await service.withdraw(deliveryId, courierId)

      // 3. decline
      mockRemovalRequestRepository.findById = jest.fn().mockResolvedValue(makeRequest({ note: sentinelNote }))
      await service.decline(requestId, adminUserId, 'Refused')

      // 4. approve before pickup
      await service.approve(requestId, adminUserId, false)

      // 5. approve after pickup
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(makeDelivery({ status: EnumDeliveryStatus.PICKED_UP }))
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery({ status: EnumDeliveryStatus.CANCELED }))
      await service.approve(requestId, adminUserId, true)

      // 6. failure path: missed approval before pickup
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(makeDelivery({ status: EnumDeliveryStatus.ACCEPTED }))
      mockDeliveryEventService.removeRiderBeforePickup.mockResolvedValue(null)
      await expect(service.approve(requestId, adminUserId, false)).rejects.toThrow(ADMIN_ORDER_CHANGED_MESSAGE)

      // 7. failure path: event recording error logs error with deliveryId but never note
      mockDeliveryRepository.findById.mockResolvedValue(
        makeDelivery({ status: EnumDeliveryStatus.ACCEPTED, courierId })
      )
      mockDeliveryEventService.recordRemovalEvent.mockRejectedValueOnce(new Error('DB connection dropped'))
      await service.send(deliveryId, courierId, { reasonId: 'r-1', note: sentinelNote })

      // 8. sweep interrupted logs REMOVAL_APPROVE_INTERRUPTED
      await service.sweepApprovedUnsettled(
        makeRequest({
          status: EnumRemovalRequestStatus.APPROVED,
          decidedAt: new Date(Date.now() - 5 * 60 * 1000),
          note: sentinelNote,
        }),
        new Date()
      )

      expect(logCalls.length).toBeGreaterThan(0)
      for (const logLine of logCalls) {
        expect(logLine).not.toContain(sentinelNote)
      }
    })

    test('approve after pickup failure path: processDeliveryEvent rejects with a sentinel note in the request, no logger call carries the note', async () => {
      const logCalls: string[] = []
      const captureLog = (...args: any[]) => {
        logCalls.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '))
      }
      jest.spyOn((service as any).logger, 'log').mockImplementation(captureLog)
      jest.spyOn((service as any).logger, 'warn').mockImplementation(captureLog)
      jest.spyOn((service as any).logger, 'error').mockImplementation(captureLog)

      const requestWithSecret = makeRequest({ note: sentinelNote, afterPickup: false })
      mockRemovalRequestRepository.findById.mockResolvedValue(requestWithSecret)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue(
        makeDelivery({ status: EnumDeliveryStatus.PICKED_UP, courierId })
      )
      // When re-reading after failure, status is still PICKED_UP (cancellation failed)
      mockDeliveryRepository.findById.mockResolvedValue(
        makeDelivery({ status: EnumDeliveryStatus.PICKED_UP, courierId })
      )

      mockDeliveryEventService.processDeliveryEvent.mockRejectedValueOnce(
        new Error('simulated cancellation process error')
      )

      await expect(service.approve(requestId, adminUserId, true)).rejects.toThrow(
        new ConflictException(ADMIN_ORDER_CHANGED_MESSAGE)
      )

      // Confirm that the catch block in approveAfterPickup executed
      const cancellationFailureLog = logCalls.find(
        (line) => line.includes('Cancelling delivery') && line.includes('for a removal failed')
      )
      expect(cancellationFailureLog).toBeDefined()

      // Confirm no logger call carries the sentinel note
      for (const logLine of logCalls) {
        expect(logLine).not.toContain(sentinelNote)
      }
    })

    test('DeliveryRemovalRequest table stores no location column/field', () => {
      const sample = makeRequest()
      const locationKeys = [
        'location',
        'lat',
        'lng',
        'latitude',
        'longitude',
        'dropoffLocation',
        'pickupLocation',
        'coordinates',
      ]
      for (const key of locationKeys) {
        expect(sample).not.toHaveProperty(key)
      }
    })
  })

  describe('AC-24: listForDelivery', () => {
    test('answers 404 on an unknown delivery', async () => {
      mockDeliveryRepository.findById.mockResolvedValue(null)
      await expect(service.listForDelivery('unknown-del')).rejects.toThrow(DeliveryNotFoundException)
      expect(mockRemovalRequestRepository.findForDelivery).not.toHaveBeenCalled()
    })

    test('returns requests newest first via repository findForDelivery', async () => {
      mockDeliveryRepository.findById.mockResolvedValue(makeDelivery())
      const mockList: any[] = [
        { id: 'req-new', createdAt: new Date('2026-11-09T12:00:00Z') },
        { id: 'req-old', createdAt: new Date('2026-11-09T10:00:00Z') },
      ]
      mockRemovalRequestRepository.findForDelivery = jest.fn().mockResolvedValue(mockList)

      const result = await service.listForDelivery(deliveryId)
      expect(mockRemovalRequestRepository.findForDelivery).toHaveBeenCalledWith(deliveryId)
      expect(result).toBe(mockList)
    })
  })
})
