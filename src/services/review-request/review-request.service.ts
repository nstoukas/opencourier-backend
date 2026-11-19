import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import { EnumCourierStatus, EnumReviewOutcome, EnumReviewRequestStatus, EnumReviewTopic } from '@prisma/types'
import { PaginatedResult } from 'src/core/models/Pagination'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { NotFoundException } from 'src/errors'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import {
  ReviewRequestRecord,
  ReviewRequestRepository,
} from 'src/persistence/repositories/review-request.repository'
import { OfferPushService } from 'src/services/pushNotification/offer-push.service'

// The sentences a rider or an admin reads. Fixed, never built from what anyone wrote (AC-4).
export const REVIEW_NOT_FOUND_MESSAGE = 'Review request not found'
export const REVIEW_NOT_OPEN_MESSAGE = 'This review request has already been answered or withdrawn.'
export const REVIEW_NOTE_MESSAGE = 'Write what you want looked at again, in 1 to 1000 characters.'
export const REVIEW_ANSWER_MESSAGE = 'Write the reason for the answer, in 1 to 2000 characters.'
export const REVIEW_CORRECTION_NOT_ALLOWED_MESSAGE =
  'A pay correction can only be added when the answer is "changed" and the request is about a delivery.'
export const REVIEW_NOTE_MAX = 1000
export const REVIEW_ANSWER_MAX = 2000

export const reviewAlreadyOpenMessage = (openId: string) =>
  `You already have an open review request about this delivery (${openId}).`
export const reviewCorrectionRangeMessage = (maxCents: number) =>
  `A pay correction must be a whole number of cents above 0 and at most ${maxCents}.`

const DAY_MS = 24 * 60 * 60 * 1000

export type SendReviewInput = { topic: EnumReviewTopic; note: string; deliveryId?: string | null }
export type AnswerReviewInput = { outcome: EnumReviewOutcome; answer: string; correctionCents?: number | null }

// Spec 0038: a rider asks a person to look again at a decision the app took about their work, and a
// person answers in writing by a known date. Nothing here, or anywhere, answers or closes a request on
// its own: a request past its due date stays open and flagged until a person answers it (AC-6).
@Injectable()
export class ReviewRequestService {
  private readonly logger = new Logger(ReviewRequestService.name)

  constructor(
    private readonly reviewRequestRepository: ReviewRequestRepository,
    private readonly courierRepository: CourierRepository,
    private readonly configDomainService: ConfigDomainService,
    private readonly offerPushService: OfferPushService
  ) {}

  // --- The rider's side ---------------------------------------------------------------------

  // AC-1 to AC-4. A delivery the rider was never offered and never held is the same 404 as one that
  // does not exist (AC-2), so a rider cannot learn which deliveries exist.
  async send(courierId: string, input: SendReviewInput): Promise<ReviewRequestRecord> {
    const note = input.note.trim()
    if (note.length < 1 || note.length > REVIEW_NOTE_MAX) throw new BadRequestException(REVIEW_NOTE_MESSAGE)

    const deliveryId = input.deliveryId || null
    if (deliveryId && !(await this.reviewRequestRepository.wasOfferedOrHeldBy(deliveryId, courierId))) {
      throw new NotFoundException('Delivery not found')
    }

    // AC-3: fixed now, from the setting now; a later change of the setting never moves it.
    const answerDays = await this.configDomainService.instanceConfig.getReviewAnswerDays()
    const dueAt = new Date(Date.now() + answerDays * DAY_MS)

    const created = await this.reviewRequestRepository.create({
      courierId,
      deliveryId,
      topic: input.topic,
      note,
      dueAt,
    })
    if (created) return created

    // The unique `openFor` refused it: this rider has an open request on this delivery already.
    const open = deliveryId ? await this.reviewRequestRepository.findOpenFor(courierId, deliveryId) : null
    throw new ConflictException(reviewAlreadyOpenMessage(open?.id ?? 'unknown'))
  }

  async listForCourier(
    courierId: string,
    options: { page?: number; perPage?: number }
  ): Promise<PaginatedResult<ReviewRequestRecord>> {
    return this.reviewRequestRepository.findPageForCourier(courierId, options)
  }

  // AC-8: another rider's request is the same 404 as one that does not exist.
  async withdraw(id: string, courierId: string): Promise<ReviewRequestRecord> {
    if (await this.reviewRequestRepository.withdrawIfOpen(id, courierId)) {
      return this.getOwn(id, courierId)
    }
    await this.getOwn(id, courierId)
    throw new ConflictException(REVIEW_NOT_OPEN_MESSAGE)
  }

  private async getOwn(id: string, courierId: string): Promise<ReviewRequestRecord> {
    const request = await this.reviewRequestRepository.findById(id)
    if (!request || request.courierId !== courierId) throw new NotFoundException(REVIEW_NOT_FOUND_MESSAGE)
    return request
  }

  // --- The admin's side ---------------------------------------------------------------------

  async listForAdmin(
    status: EnumReviewRequestStatus,
    options: { page?: number; perPage?: number }
  ): Promise<PaginatedResult<ReviewRequestRecord>> {
    return this.reviewRequestRepository.findPageForAdmin(status, options)
  }

  async countOpen(): Promise<{ open: number; overdue: number }> {
    return this.reviewRequestRepository.countOpen(new Date())
  }

  async get(id: string): Promise<ReviewRequestRecord> {
    const request = await this.reviewRequestRepository.findById(id)
    if (!request) throw new NotFoundException(REVIEW_NOT_FOUND_MESSAGE)
    return request
  }

  // AC-6, AC-7, AC-9. Every rule is checked before anything is written; the answer, its event and any
  // correction then go in one transaction, and the push only after it committed.
  async answer(id: string, answeredByUserId: string, input: AnswerReviewInput): Promise<ReviewRequestRecord> {
    const request = await this.get(id)

    const answer = input.answer.trim()
    if (answer.length < 1 || answer.length > REVIEW_ANSWER_MAX) throw new BadRequestException(REVIEW_ANSWER_MESSAGE)

    const correctionCents = input.correctionCents ?? null
    let correction: { amountCents: number; currencyCode: string; deliveryId: string } | null = null
    if (correctionCents !== null) {
      // Only on a "changed" answer about a delivery: a correction needs a delivery to be paid on.
      if (input.outcome !== EnumReviewOutcome.CHANGED || !request.deliveryId) {
        throw new BadRequestException(REVIEW_CORRECTION_NOT_ALLOWED_MESSAGE)
      }
      // Only adds, and never more than the co-op's cap at answer time (no review can lower pay).
      const maxCents = await this.configDomainService.instanceConfig.getReviewCorrectionMaxCents()
      if (!Number.isInteger(correctionCents) || correctionCents <= 0 || correctionCents > maxCents) {
        throw new BadRequestException(reviewCorrectionRangeMessage(maxCents))
      }
      const currencyCode = await this.reviewRequestRepository.findDeliveryCurrency(request.deliveryId)
      if (!currencyCode) throw new NotFoundException('Delivery not found')
      correction = { amountCents: correctionCents, currencyCode, deliveryId: request.deliveryId }
    }

    if (request.status !== EnumReviewRequestStatus.OPEN) throw new ConflictException(REVIEW_NOT_OPEN_MESSAGE)

    const answered = await this.reviewRequestRepository.answer(id, {
      outcome: input.outcome,
      answer,
      answeredByUserId,
      correction,
    })
    // Another admin answered it, or the rider withdrew it, after it was read above.
    if (!answered) throw new ConflictException(REVIEW_NOT_OPEN_MESSAGE)

    await this.pushAnswerUnlessOffline(answered.courierId, id)
    return this.get(id)
  }

  // AC-9: only while the rider is not Offline at this moment; an Offline rider never gets a push for
  // this answer, it is always on their page. Never throws: the answer is already saved.
  private async pushAnswerUnlessOffline(courierId: string, requestId: string): Promise<void> {
    try {
      const courier = await this.courierRepository.findById(courierId)
      if (!courier || courier.status === EnumCourierStatus.OFFLINE) return
      this.offerPushService.reviewAnswered(courierId, requestId)
    } catch (error) {
      this.logger.error(`Could not push the answer to review request ${requestId}: ${error}`)
    }
  }
}
