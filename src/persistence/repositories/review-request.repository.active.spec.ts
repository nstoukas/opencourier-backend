import {
  EnumCourierCompensationReason,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumEventActor,
  EnumReviewOutcome,
  EnumReviewRequestStatus,
  EnumReviewTopic,
} from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { ReviewRequestRepository } from './review-request.repository'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

describe('ReviewRequestRepository (spec 0038, AC-1 to AC-7, AC-16)', () => {
  let repository: ReviewRequestRepository
  let mockPrisma: any
  let mockTx: any

  const courierId = 'courier-r1'
  const deliveryId = 'del-101'
  const adminId = 'admin-user-1'
  const dueAt = new Date('2026-12-03T10:00:00.000Z')

  beforeEach(() => {
    mockTx = {
      reviewRequest: {
        create: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findUnique: jest.fn(),
      },
      deliveryEvent: {
        create: jest.fn(),
      },
      courierCompensation: {
        create: jest.fn(),
      },
    }

    mockPrisma = {
      $transaction: jest.fn((callback) => callback(mockTx)),
      delivery: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      deliveryEvent: {
        findFirst: jest.fn(),
      },
      reviewRequest: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn(),
      },
      courierCompensation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    }

    repository = new ReviewRequestRepository(mockPrisma as unknown as PrismaService)
  })

  describe('wasOfferedOrHeldBy (AC-2)', () => {
    it('returns true when courier held the delivery (courierId matches)', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValue({ id: deliveryId })

      const result = await repository.wasOfferedOrHeldBy(deliveryId, courierId)

      expect(result).toBe(true)
      expect(mockPrisma.delivery.findFirst).toHaveBeenCalledWith({
        where: { id: deliveryId, OR: [{ courierId }, { matchedCourierId: courierId }] },
        select: { id: true },
      })
    })

    it('returns true when courier had an event on the delivery', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValue(null)
      mockPrisma.deliveryEvent.findFirst.mockResolvedValue({ id: 'evt-1' })

      const result = await repository.wasOfferedOrHeldBy(deliveryId, courierId)

      expect(result).toBe(true)
      expect(mockPrisma.deliveryEvent.findFirst).toHaveBeenCalledWith({
        where: { deliveryId, courierId },
        select: { id: true },
      })
    })

    it('returns false when courier was never offered and never held the delivery', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValue(null)
      mockPrisma.deliveryEvent.findFirst.mockResolvedValue(null)

      const result = await repository.wasOfferedOrHeldBy(deliveryId, courierId)

      expect(result).toBe(false)
    })
  })

  describe('create (AC-1, AC-4)', () => {
    it('creates delivery-linked review request with REVIEW_REQUESTED event in one transaction', async () => {
      const requestId = 'req-1'
      mockTx.reviewRequest.create.mockResolvedValue({ id: requestId })
      jest.spyOn(repository, 'findById').mockResolvedValue({ id: requestId } as any)

      const result = await repository.create({
        courierId,
        deliveryId,
        topic: EnumReviewTopic.PAY,
        note: 'Pay seems incorrect for 5 km',
        dueAt,
      })

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
      expect(mockTx.reviewRequest.create).toHaveBeenCalledWith({
        data: {
          courierId,
          deliveryId,
          topic: EnumReviewTopic.PAY,
          note: 'Pay seems incorrect for 5 km',
          dueAt,
          status: EnumReviewRequestStatus.OPEN,
          openFor: `${courierId}:${deliveryId}`,
        },
      })

      // AC-4, AC-16: review event must have oldStatus and newStatus null, courierId set, and no rider note
      expect(mockTx.deliveryEvent.create).toHaveBeenCalledWith({
        data: {
          deliveryId,
          courierId,
          type: EnumDeliveryEventType.REVIEW_REQUESTED,
          actor: EnumEventActor.COURIER,
          eventSource: EnumDeliveryEventSource.OPENCOURIER,
          transitionSuccessful: true,
          oldStatus: null,
          newStatus: null,
          message: 'Review requested: PAY',
        },
      })
      const eventMsg = mockTx.deliveryEvent.create.mock.calls[0][0].data.message
      expect(eventMsg).not.toContain('Pay seems incorrect')

      expect(result).toEqual({ id: requestId })
    })

    it('creates general review request (deliveryId null) with openFor null and NO DeliveryEvent', async () => {
      const requestId = 'req-gen-1'
      mockTx.reviewRequest.create.mockResolvedValue({ id: requestId })
      jest.spyOn(repository, 'findById').mockResolvedValue({ id: requestId } as any)

      const result = await repository.create({
        courierId,
        deliveryId: null,
        topic: EnumReviewTopic.OTHER,
        note: 'General question about matching rules',
        dueAt,
      })

      expect(mockTx.reviewRequest.create).toHaveBeenCalledWith({
        data: {
          courierId,
          deliveryId: null,
          topic: EnumReviewTopic.OTHER,
          note: 'General question about matching rules',
          dueAt,
          status: EnumReviewRequestStatus.OPEN,
          openFor: null,
        },
      })
      expect(mockTx.deliveryEvent.create).not.toHaveBeenCalled()
      expect(result).toEqual({ id: requestId })
    })

    it('returns null when unique constraint on openFor fails (duplicate open request)', async () => {
      const error = new PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.3.1',
      })
      mockTx.reviewRequest.create.mockRejectedValue(error)

      const result = await repository.create({
        courierId,
        deliveryId,
        topic: EnumReviewTopic.PAY,
        note: 'Duplicate request',
        dueAt,
      })

      expect(result).toBeNull()
    })
  })

  describe('answer (AC-6, AC-7, AC-16)', () => {
    it('answers request with STANDS: conditional update WHERE status = OPEN, clears openFor, writes REVIEW_ANSWERED', async () => {
      mockTx.reviewRequest.updateMany.mockResolvedValue({ count: 1 })
      mockTx.reviewRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'req-1',
        courierId,
        deliveryId,
      })

      const result = await repository.answer('req-1', {
        outcome: EnumReviewOutcome.STANDS,
        answer: 'The pay calculation was correct according to distance.',
        answeredByUserId: adminId,
        correction: null,
      })

      expect(mockTx.reviewRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', status: EnumReviewRequestStatus.OPEN },
        data: expect.objectContaining({
          status: EnumReviewRequestStatus.ANSWERED,
          outcome: EnumReviewOutcome.STANDS,
          answer: 'The pay calculation was correct according to distance.',
          answeredByUserId: adminId,
          openFor: null,
        }),
      })

      // AC-4: REVIEW_ANSWERED with null statuses, courierId set, outcome in message, no answer text
      expect(mockTx.deliveryEvent.create).toHaveBeenCalledWith({
        data: {
          deliveryId,
          courierId,
          type: EnumDeliveryEventType.REVIEW_ANSWERED,
          actor: EnumEventActor.ADMIN,
          eventSource: EnumDeliveryEventSource.OPENCOURIER,
          transitionSuccessful: true,
          oldStatus: null,
          newStatus: null,
          message: 'Review answered: STANDS',
        },
      })
      const eventMsg = mockTx.deliveryEvent.create.mock.calls[0][0].data.message
      expect(eventMsg).not.toContain('The pay calculation was correct')

      expect(mockTx.courierCompensation.create).not.toHaveBeenCalled()
      expect(result).toEqual({ courierId })
    })

    it('answers request with CHANGED and correction: writes status, REVIEW_ANSWERED, compensation and COURIER_PAID_FOR_REVIEW in one transaction', async () => {
      mockTx.reviewRequest.updateMany.mockResolvedValue({ count: 1 })
      mockTx.reviewRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'req-1',
        courierId,
        deliveryId,
      })

      const result = await repository.answer('req-1', {
        outcome: EnumReviewOutcome.CHANGED,
        answer: 'GPS glitch caused distance undercount. Adding €1.50.',
        answeredByUserId: adminId,
        correction: {
          amountCents: 150,
          currencyCode: 'EUR',
          deliveryId,
        },
      })

      expect(mockTx.reviewRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', status: EnumReviewRequestStatus.OPEN },
        data: expect.objectContaining({
          status: EnumReviewRequestStatus.ANSWERED,
          outcome: EnumReviewOutcome.CHANGED,
          openFor: null,
        }),
      })

      // AC-7: CourierCompensation created with reason REVIEW and unique reviewOf
      expect(mockTx.courierCompensation.create).toHaveBeenCalledWith({
        data: {
          amount: 150,
          currencyCode: 'EUR',
          reason: EnumCourierCompensationReason.REVIEW,
          policy: 'REVIEW',
          message: 'Review correction',
          courierId,
          deliveryId,
          reviewOf: 'req-1',
        },
      })

      // AC-4, AC-7: COURIER_PAID_FOR_REVIEW event with null statuses and courierId
      expect(mockTx.deliveryEvent.create).toHaveBeenCalledWith({
        data: {
          deliveryId,
          courierId,
          type: EnumDeliveryEventType.COURIER_PAID_FOR_REVIEW,
          actor: EnumEventActor.ADMIN,
          eventSource: EnumDeliveryEventSource.OPENCOURIER,
          transitionSuccessful: true,
          oldStatus: null,
          newStatus: null,
          message: `Courier ${courierId} paid 150 EUR (cents) for review req-1`,
        },
      })

      expect(result).toEqual({ courierId })
    })

    it('guard test: returns null and writes NO events and NO compensation when status is not OPEN (count = 0)', async () => {
      // Someone already answered or rider withdrew (lost race)
      mockTx.reviewRequest.updateMany.mockResolvedValue({ count: 0 })

      const result = await repository.answer('req-already-answered', {
        outcome: EnumReviewOutcome.CHANGED,
        answer: 'Second answer attempting to write',
        answeredByUserId: adminId,
        correction: {
          amountCents: 200,
          currencyCode: 'EUR',
          deliveryId,
        },
      })

      expect(result).toBeNull()
      expect(mockTx.deliveryEvent.create).not.toHaveBeenCalled()
      expect(mockTx.courierCompensation.create).not.toHaveBeenCalled()
    })
  })

  describe('withdrawIfOpen (AC-8, AC-16)', () => {
    it('sets status to WITHDRAWN and clears openFor conditionally when OPEN and courierId matches', async () => {
      mockPrisma.reviewRequest.updateMany.mockResolvedValue({ count: 1 })

      const result = await repository.withdrawIfOpen('req-1', courierId)

      expect(mockPrisma.reviewRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', courierId, status: EnumReviewRequestStatus.OPEN },
        data: expect.objectContaining({
          status: EnumReviewRequestStatus.WITHDRAWN,
          openFor: null,
        }),
      })
      expect(result).toBe(true)
    })

    it('returns false when request is no longer OPEN or belongs to another courier (count = 0)', async () => {
      mockPrisma.reviewRequest.updateMany.mockResolvedValue({ count: 0 })

      const result = await repository.withdrawIfOpen('req-1', 'other-courier')

      expect(result).toBe(false)
    })
  })

  describe('countOpen (AC-5)', () => {
    it('counts open requests and overdue requests where dueAt < now', async () => {
      const now = new Date('2026-11-19T10:00:00Z')
      mockPrisma.reviewRequest.count
        .mockResolvedValueOnce(5) // total open
        .mockResolvedValueOnce(2) // overdue

      const result = await repository.countOpen(now)

      expect(mockPrisma.reviewRequest.count).toHaveBeenNthCalledWith(1, {
        where: { status: EnumReviewRequestStatus.OPEN },
      })
      expect(mockPrisma.reviewRequest.count).toHaveBeenNthCalledWith(2, {
        where: { status: EnumReviewRequestStatus.OPEN, dueAt: { lt: now } },
      })
      expect(result).toEqual({ open: 5, overdue: 2 })
    })
  })

  describe('admin ordering (AC-5)', () => {
    it('orders OPEN requests by dueAt asc so overdue requests appear first', async () => {
      mockPrisma.reviewRequest.findMany.mockResolvedValue([])

      await repository.findPageForAdmin(EnumReviewRequestStatus.OPEN, { page: 1, perPage: 10 })

      expect(mockPrisma.reviewRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: EnumReviewRequestStatus.OPEN },
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        })
      )
    })

    it('orders ANSWERED requests by answeredAt desc', async () => {
      mockPrisma.reviewRequest.findMany.mockResolvedValue([])

      await repository.findPageForAdmin(EnumReviewRequestStatus.ANSWERED, { page: 1, perPage: 10 })

      expect(mockPrisma.reviewRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: EnumReviewRequestStatus.ANSWERED },
          orderBy: [{ answeredAt: 'desc' }, { id: 'desc' }],
        })
      )
    })
  })
})
