import { BadRequestException, ConflictException } from '@nestjs/common'
import {
  EnumCourierStatus,
  EnumReviewOutcome,
  EnumReviewRequestStatus,
  EnumReviewTopic,
} from '@prisma/types'
import { NotFoundException } from 'src/errors'
import {
  ReviewRequestService,
  REVIEW_ANSWER_MESSAGE,
  REVIEW_CORRECTION_NOT_ALLOWED_MESSAGE,
  REVIEW_NOT_FOUND_MESSAGE,
  REVIEW_NOT_OPEN_MESSAGE,
  REVIEW_NOTE_MESSAGE,
  reviewAlreadyOpenMessage,
  reviewCorrectionRangeMessage,
} from './review-request.service'
import { ReviewRequestRepository } from 'src/persistence/repositories/review-request.repository'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { OfferPushService } from 'src/services/pushNotification/offer-push.service'

describe('ReviewRequestService (spec 0038, AC-1 to AC-9, AC-16)', () => {
  let service: ReviewRequestService
  let mockReviewRequestRepository: jest.Mocked<ReviewRequestRepository>
  let mockCourierRepository: jest.Mocked<CourierRepository>
  let mockConfigDomainService: jest.Mocked<ConfigDomainService>
  let mockOfferPushService: jest.Mocked<OfferPushService>

  const courierId = 'courier-r1'
  const deliveryId = 'del-101'
  const adminId = 'admin-user-1'
  const requestId = 'req-1'

  beforeEach(() => {
    mockReviewRequestRepository = {
      wasOfferedOrHeldBy: jest.fn().mockResolvedValue(true),
      findDeliveryCurrency: jest.fn().mockResolvedValue('EUR'),
      create: jest.fn(),
      answer: jest.fn(),
      withdrawIfOpen: jest.fn(),
      findById: jest.fn(),
      findOpenFor: jest.fn(),
      findPageForCourier: jest.fn(),
      findPageForAdmin: jest.fn(),
      countOpen: jest.fn(),
    } as unknown as jest.Mocked<ReviewRequestRepository>

    mockCourierRepository = {
      findById: jest.fn().mockResolvedValue({ id: courierId, status: EnumCourierStatus.ONLINE } as any),
    } as unknown as jest.Mocked<CourierRepository>

    mockConfigDomainService = {
      instanceConfig: {
        getReviewAnswerDays: jest.fn().mockResolvedValue(14),
        getReviewCorrectionMaxCents: jest.fn().mockResolvedValue(5000),
      },
    } as unknown as jest.Mocked<ConfigDomainService>

    mockOfferPushService = {
      reviewAnswered: jest.fn(),
    } as unknown as jest.Mocked<OfferPushService>

    service = new ReviewRequestService(
      mockReviewRequestRepository,
      mockCourierRepository,
      mockConfigDomainService,
      mockOfferPushService
    )
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('send (AC-1, AC-2, AC-3)', () => {
    it('validates note length: rejects empty note after trimming', async () => {
      await expect(
        service.send(courierId, { topic: EnumReviewTopic.PAY, note: '   ' })
      ).rejects.toThrow(new BadRequestException(REVIEW_NOTE_MESSAGE))
    })

    it('validates note length: rejects note > 1000 chars', async () => {
      const longNote = 'a'.repeat(1001)
      await expect(
        service.send(courierId, { topic: EnumReviewTopic.PAY, note: longNote })
      ).rejects.toThrow(new BadRequestException(REVIEW_NOTE_MESSAGE))
    })

    it('refuses delivery-linked request with 404 if rider was never offered or held the delivery (AC-2)', async () => {
      mockReviewRequestRepository.wasOfferedOrHeldBy.mockResolvedValue(false)

      await expect(
        service.send(courierId, { deliveryId: 'del-unknown', topic: EnumReviewTopic.PAY, note: 'Valid note' })
      ).rejects.toThrow(new NotFoundException('Delivery not found'))

      expect(mockReviewRequestRepository.wasOfferedOrHeldBy).toHaveBeenCalledWith('del-unknown', courierId)
      expect(mockReviewRequestRepository.create).not.toHaveBeenCalled()
    })

    it('fixes dueAt from reviewAnswerDays setting at send time (AC-3)', async () => {
      const before = Date.now()
      mockReviewRequestRepository.create.mockResolvedValue({ id: requestId } as any)

      await service.send(courierId, { deliveryId, topic: EnumReviewTopic.PAY, note: 'Valid note' })

      expect(mockConfigDomainService.instanceConfig.getReviewAnswerDays).toHaveBeenCalledTimes(1)
      expect(mockReviewRequestRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          courierId,
          deliveryId,
          topic: EnumReviewTopic.PAY,
          note: 'Valid note',
          dueAt: expect.any(Date),
        })
      )

      const dueAt: Date = mockReviewRequestRepository.create.mock.calls[0]![0].dueAt
      const expectedMin = before + 14 * 24 * 60 * 60 * 1000
      expect(dueAt.getTime()).toBeGreaterThanOrEqual(expectedMin)
    })

    it('calculates dueAt as send time plus reviewAnswerDays (3 days) times 24 hours (AC-3)', async () => {
      const fixedNow = 1700000000000
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow)
      ;(mockConfigDomainService.instanceConfig.getReviewAnswerDays as jest.Mock).mockResolvedValue(3)
      mockReviewRequestRepository.create.mockResolvedValue({ id: requestId } as any)

      await service.send(courierId, { deliveryId, topic: EnumReviewTopic.PAY, note: 'Valid note' })

      const dueAt: Date = mockReviewRequestRepository.create.mock.calls[0]![0].dueAt
      expect(dueAt.getTime()).toBe(fixedNow + 3 * 24 * 60 * 60 * 1000)
    })

    it('refuses duplicate open request on same delivery with 409 naming the open one (AC-2)', async () => {
      mockReviewRequestRepository.create.mockResolvedValue(null) // unique constraint failure
      mockReviewRequestRepository.findOpenFor.mockResolvedValue({ id: 'open-req-999' })

      await expect(
        service.send(courierId, { deliveryId, topic: EnumReviewTopic.PAY, note: 'Another note' })
      ).rejects.toThrow(new ConflictException(reviewAlreadyOpenMessage('open-req-999')))
    })

    it('allows general request with no deliveryId (AC-1)', async () => {
      mockReviewRequestRepository.create.mockResolvedValue({ id: 'req-gen' } as any)

      const result = await service.send(courierId, { topic: EnumReviewTopic.OTHER, note: 'General question' })

      expect(mockReviewRequestRepository.wasOfferedOrHeldBy).not.toHaveBeenCalled()
      expect(mockReviewRequestRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          courierId,
          deliveryId: null,
          topic: EnumReviewTopic.OTHER,
          note: 'General question',
        })
      )
      expect(result).toEqual({ id: 'req-gen' })
    })
  })

  describe('withdraw (AC-8, AC-16)', () => {
    it('successfully withdraws own open request and returns updated request', async () => {
      mockReviewRequestRepository.withdrawIfOpen.mockResolvedValue(true)
      mockReviewRequestRepository.findById.mockResolvedValue({
        id: requestId,
        courierId,
        status: EnumReviewRequestStatus.WITHDRAWN,
      } as any)

      const result = await service.withdraw(requestId, courierId)

      expect(mockReviewRequestRepository.withdrawIfOpen).toHaveBeenCalledWith(requestId, courierId)
      expect(result.status).toBe(EnumReviewRequestStatus.WITHDRAWN)
    })

    it('throws 404 when request belongs to another courier (AC-8)', async () => {
      mockReviewRequestRepository.withdrawIfOpen.mockResolvedValue(false)
      mockReviewRequestRepository.findById.mockResolvedValue({
        id: requestId,
        courierId: 'other-courier',
      } as any)

      await expect(service.withdraw(requestId, courierId)).rejects.toThrow(
        new NotFoundException(REVIEW_NOT_FOUND_MESSAGE)
      )
    })

    it('throws 409 when request is no longer OPEN (already answered or withdrawn) (AC-8, AC-16)', async () => {
      mockReviewRequestRepository.withdrawIfOpen.mockResolvedValue(false)
      mockReviewRequestRepository.findById.mockResolvedValue({
        id: requestId,
        courierId,
        status: EnumReviewRequestStatus.ANSWERED,
      } as any)

      await expect(service.withdraw(requestId, courierId)).rejects.toThrow(
        new ConflictException(REVIEW_NOT_OPEN_MESSAGE)
      )
    })
  })

  describe('answer (AC-6, AC-7, AC-9, AC-16)', () => {
    const validSampleRequest = {
      id: requestId,
      courierId,
      deliveryId,
      status: EnumReviewRequestStatus.OPEN,
    }

    it('rejects answer text that is empty after trim', async () => {
      mockReviewRequestRepository.findById.mockResolvedValue(validSampleRequest as any)

      await expect(
        service.answer(requestId, adminId, { outcome: EnumReviewOutcome.STANDS, answer: '   ' })
      ).rejects.toThrow(new BadRequestException(REVIEW_ANSWER_MESSAGE))
    })

    it('rejects answer text > 2000 chars', async () => {
      mockReviewRequestRepository.findById.mockResolvedValue(validSampleRequest as any)

      await expect(
        service.answer(requestId, adminId, { outcome: EnumReviewOutcome.STANDS, answer: 'x'.repeat(2001) })
      ).rejects.toThrow(new BadRequestException(REVIEW_ANSWER_MESSAGE))
    })

    it('guard test: rejects correction when outcome is STANDS (AC-7, AC-16)', async () => {
      mockReviewRequestRepository.findById.mockResolvedValue(validSampleRequest as any)

      await expect(
        service.answer(requestId, adminId, {
          outcome: EnumReviewOutcome.STANDS,
          answer: 'The decision was correct',
          correctionCents: 100,
        })
      ).rejects.toThrow(new BadRequestException(REVIEW_CORRECTION_NOT_ALLOWED_MESSAGE))
      expect(mockReviewRequestRepository.answer).not.toHaveBeenCalled()
    })

    it('guard test: rejects correction on general request with no delivery (AC-7, AC-16)', async () => {
      mockReviewRequestRepository.findById.mockResolvedValue({
        ...validSampleRequest,
        deliveryId: null,
      } as any)

      await expect(
        service.answer(requestId, adminId, {
          outcome: EnumReviewOutcome.CHANGED,
          answer: 'General rule change',
          correctionCents: 100,
        })
      ).rejects.toThrow(new BadRequestException(REVIEW_CORRECTION_NOT_ALLOWED_MESSAGE))
      expect(mockReviewRequestRepository.answer).not.toHaveBeenCalled()
    })

    it('guard test: rejects correction of 0 (AC-7, AC-16)', async () => {
      mockReviewRequestRepository.findById.mockResolvedValue(validSampleRequest as any)

      await expect(
        service.answer(requestId, adminId, {
          outcome: EnumReviewOutcome.CHANGED,
          answer: 'Decision changed',
          correctionCents: 0,
        })
      ).rejects.toThrow(new BadRequestException(reviewCorrectionRangeMessage(5000)))
      expect(mockReviewRequestRepository.answer).not.toHaveBeenCalled()
    })

    it('guard test: rejects negative correction (AC-7, AC-16)', async () => {
      mockReviewRequestRepository.findById.mockResolvedValue(validSampleRequest as any)

      await expect(
        service.answer(requestId, adminId, {
          outcome: EnumReviewOutcome.CHANGED,
          answer: 'Attempting negative pay',
          correctionCents: -500,
        })
      ).rejects.toThrow(new BadRequestException(reviewCorrectionRangeMessage(5000)))
      expect(mockReviewRequestRepository.answer).not.toHaveBeenCalled()
    })

    it('guard test: rejects correction above reviewCorrectionMaxCents cap (AC-7, AC-16)', async () => {
      mockReviewRequestRepository.findById.mockResolvedValue(validSampleRequest as any)

      await expect(
        service.answer(requestId, adminId, {
          outcome: EnumReviewOutcome.CHANGED,
          answer: 'Too large correction',
          correctionCents: 5001,
        })
      ).rejects.toThrow(new BadRequestException(reviewCorrectionRangeMessage(5000)))
      expect(mockReviewRequestRepository.answer).not.toHaveBeenCalled()
    })

    it('guard test: rejects fractional correction (must be whole cents)', async () => {
      mockReviewRequestRepository.findById.mockResolvedValue(validSampleRequest as any)

      await expect(
        service.answer(requestId, adminId, {
          outcome: EnumReviewOutcome.CHANGED,
          answer: 'Fractional pay',
          correctionCents: 150.5,
        })
      ).rejects.toThrow(new BadRequestException(reviewCorrectionRangeMessage(5000)))
    })

    it('throws 409 when request is not in OPEN status', async () => {
      mockReviewRequestRepository.findById.mockResolvedValue({
        ...validSampleRequest,
        status: EnumReviewRequestStatus.ANSWERED,
      } as any)

      await expect(
        service.answer(requestId, adminId, {
          outcome: EnumReviewOutcome.STANDS,
          answer: 'Second answer',
        })
      ).rejects.toThrow(new ConflictException(REVIEW_NOT_OPEN_MESSAGE))
    })

    it('throws 409 when repository.answer returns null (lost race)', async () => {
      mockReviewRequestRepository.findById.mockResolvedValue(validSampleRequest as any)
      mockReviewRequestRepository.answer.mockResolvedValue(null)

      await expect(
        service.answer(requestId, adminId, {
          outcome: EnumReviewOutcome.STANDS,
          answer: 'Racing answer',
        })
      ).rejects.toThrow(new ConflictException(REVIEW_NOT_OPEN_MESSAGE))
    })

    it('successful answer sends push notification when rider is Online (AC-9)', async () => {
      mockReviewRequestRepository.findById
        .mockResolvedValueOnce(validSampleRequest as any)
        .mockResolvedValueOnce({ ...validSampleRequest, status: EnumReviewRequestStatus.ANSWERED } as any)
      mockReviewRequestRepository.answer.mockResolvedValue({ courierId })
      mockCourierRepository.findById.mockResolvedValue({ id: courierId, status: EnumCourierStatus.ONLINE } as any)

      await service.answer(requestId, adminId, {
        outcome: EnumReviewOutcome.STANDS,
        answer: 'Decision stands',
      })

      expect(mockOfferPushService.reviewAnswered).toHaveBeenCalledWith(courierId, requestId)
    })

    it('successful answer sends NO push notification when rider is Offline (AC-9)', async () => {
      mockReviewRequestRepository.findById
        .mockResolvedValueOnce(validSampleRequest as any)
        .mockResolvedValueOnce({ ...validSampleRequest, status: EnumReviewRequestStatus.ANSWERED } as any)
      mockReviewRequestRepository.answer.mockResolvedValue({ courierId })
      mockCourierRepository.findById.mockResolvedValue({ id: courierId, status: EnumCourierStatus.OFFLINE } as any)

      await service.answer(requestId, adminId, {
        outcome: EnumReviewOutcome.STANDS,
        answer: 'Decision stands',
      })

      expect(mockOfferPushService.reviewAnswered).not.toHaveBeenCalled()
    })
  })
})
