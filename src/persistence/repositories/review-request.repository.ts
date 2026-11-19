import { Injectable } from '@nestjs/common'
import {
  EnumCourierCompensationReason,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumEventActor,
  EnumReviewOutcome,
  EnumReviewRequestStatus,
  EnumReviewTopic,
  Prisma,
} from '@prisma/types'
import { buildPagination } from 'src/rest-api/Paginator'
import { PaginatedResult } from 'src/core/models/Pagination'
import { isUniqueConstraintError } from 'src/prisma.util'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

// What every reader of a request needs besides the row: the delivery summary, the rider's name, the
// answering admin and the correction, if any (spec 0038, the DTOs). `satisfies` checks the object
// against Prisma's type without widening it.
const REVIEW_INCLUDE = {
  delivery: { select: { id: true, pickupBusinessName: true, createdAt: true } },
  courier: { select: { firstName: true, lastName: true } },
  answeredBy: { select: { id: true, email: true, username: true } },
} satisfies Prisma.ReviewRequestInclude

export type ReviewRequestWithDetails = Prisma.ReviewRequestGetPayload<{ include: typeof REVIEW_INCLUDE }>

// A request as the routes return it: its row plus the correction, read from the REVIEW compensation
// whose `reviewOf` is the request id (null when there is none).
export type ReviewRequestRecord = ReviewRequestWithDetails & { correctionCents: number | null }

// The order a list is read in (Prisma's own name for this type differs between versions).
type ReviewOrder = NonNullable<Prisma.ReviewRequestFindManyArgs['orderBy']>

export type CreateReviewRequestInput = {
  courierId: string
  deliveryId: string | null
  topic: EnumReviewTopic
  note: string
  dueAt: Date
}

export type ReviewCorrectionInput = {
  amountCents: number
  currencyCode: string
  deliveryId: string
}

export type AnswerReviewRequestInput = {
  outcome: EnumReviewOutcome
  answer: string
  answeredByUserId: string
  correction: ReviewCorrectionInput | null
}

// What an answer wrote, for the caller's push (sent only after the transaction commits).
export type AnsweredReview = { courierId: string }

// Spec 0038: riders' review requests. A request leaves OPEN only by an admin's answer or the rider's
// own withdrawal, each one conditional write (`WHERE id = ? AND status = 'OPEN'`), so two admins, or an
// answer and a withdrawal, can race safely: exactly one wins. Nothing else here changes `status`.
//
// The three review DeliveryEvents are written through the same transaction as the request, straight
// to the event table rather than through processDeliveryEvent: they have no transition and no side
// effect, and a review must never be half written (deviation logged in memory.md's ledger). They are
// saved with null statuses, so no reader of drop offs or transitions ever counts them (AC-4, AC-10).
@Injectable()
export class ReviewRequestRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  // Whether the rider was ever offered or held this delivery (AC-2): it names them now as its rider or
  // its open offer, or an event on it names them (OFFERED, OFFER_EXPIRED, REASSIGNED's dropped rider,
  // HANDED_BACK, RETURNED_TO_WAITING, the removal and pay events, and so on).
  async wasOfferedOrHeldBy(deliveryId: string, courierId: string): Promise<boolean> {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, OR: [{ courierId }, { matchedCourierId: courierId }] },
      select: { id: true },
    })
    if (delivery) return true
    const event = await this.prisma.deliveryEvent.findFirst({
      where: { deliveryId, courierId },
      select: { id: true },
    })
    return event !== null
  }

  // The currency a correction is paid in: the delivery's, as every award (AC-7).
  async findDeliveryCurrency(deliveryId: string): Promise<string | null> {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId }, select: { currencyCode: true } })
    return delivery?.currencyCode ?? null
  }

  // Writes the request and, for a delivery linked one, its REVIEW_REQUESTED event in one transaction.
  // Null when this rider already has an open request on this delivery (the unique `openFor`).
  async create(input: CreateReviewRequestInput): Promise<ReviewRequestRecord | null> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const request = await tx.reviewRequest.create({
          data: {
            ...input,
            status: EnumReviewRequestStatus.OPEN,
            openFor: input.deliveryId ? `${input.courierId}:${input.deliveryId}` : null,
          },
        })
        if (input.deliveryId) {
          await tx.deliveryEvent.create({
            data: {
              deliveryId: input.deliveryId,
              courierId: input.courierId,
              type: EnumDeliveryEventType.REVIEW_REQUESTED,
              actor: EnumEventActor.COURIER,
              eventSource: EnumDeliveryEventSource.OPENCOURIER,
              transitionSuccessful: true,
              oldStatus: null,
              newStatus: null,
              // The topic only: the rider's note never goes in an event (AC-4).
              message: `Review requested: ${input.topic}`,
            },
          })
        }
        return request.id
      })
      return this.findById(id)
    } catch (error) {
      if (error instanceof Error && isUniqueConstraintError(error)) return null
      throw error
    }
  }

  // AC-6, AC-7: the answer, its event and any correction with its event, all in one transaction.
  // Null when the request is no longer OPEN (answered, withdrawn, or another admin got there first):
  // then nothing is written.
  async answer(id: string, input: AnswerReviewRequestInput): Promise<AnsweredReview | null> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.reviewRequest.updateMany({
        where: { id, status: EnumReviewRequestStatus.OPEN },
        data: {
          status: EnumReviewRequestStatus.ANSWERED,
          answeredAt: new Date(),
          outcome: input.outcome,
          answer: input.answer,
          answeredByUserId: input.answeredByUserId,
          openFor: null,
        },
      })
      if (count === 0) return null

      const request = await tx.reviewRequest.findUniqueOrThrow({ where: { id } })
      if (request.deliveryId) {
        await tx.deliveryEvent.create({
          data: {
            deliveryId: request.deliveryId,
            courierId: request.courierId,
            type: EnumDeliveryEventType.REVIEW_ANSWERED,
            actor: EnumEventActor.ADMIN,
            eventSource: EnumDeliveryEventSource.OPENCOURIER,
            transitionSuccessful: true,
            oldStatus: null,
            newStatus: null,
            // The outcome only: the admin's answer never goes in an event (AC-4).
            message: `Review answered: ${input.outcome}`,
          },
        })
      }

      if (input.correction) {
        // Paid to the rider who asked, even if another rider holds the delivery now (AC-7). The
        // unique `reviewOf` means one review pays at most once.
        await tx.courierCompensation.create({
          data: {
            amount: input.correction.amountCents,
            currencyCode: input.correction.currencyCode,
            reason: EnumCourierCompensationReason.REVIEW,
            policy: 'REVIEW',
            message: 'Review correction',
            courierId: request.courierId,
            deliveryId: input.correction.deliveryId,
            reviewOf: id,
          },
        })
        await tx.deliveryEvent.create({
          data: {
            deliveryId: input.correction.deliveryId,
            courierId: request.courierId,
            type: EnumDeliveryEventType.COURIER_PAID_FOR_REVIEW,
            actor: EnumEventActor.ADMIN,
            eventSource: EnumDeliveryEventSource.OPENCOURIER,
            transitionSuccessful: true,
            oldStatus: null,
            newStatus: null,
            message: `Courier ${request.courierId} paid ${input.correction.amountCents} ${input.correction.currencyCode} (cents) for review ${id}`,
          },
        })
      }
      return { courierId: request.courierId }
    })
  }

  // AC-8: only the rider's own open request. False when it is not theirs or no longer open.
  async withdrawIfOpen(id: string, courierId: string): Promise<boolean> {
    const { count } = await this.prisma.reviewRequest.updateMany({
      where: { id, courierId, status: EnumReviewRequestStatus.OPEN },
      data: { status: EnumReviewRequestStatus.WITHDRAWN, withdrawnAt: new Date(), openFor: null },
    })
    return count === 1
  }

  async findById(id: string): Promise<ReviewRequestRecord | null> {
    const request = await this.prisma.reviewRequest.findUnique({ where: { id }, include: REVIEW_INCLUDE })
    if (!request) return null
    const [record] = await this.withCorrections([request])
    return record ?? null
  }

  // The open one by this rider on this delivery, to name it in the 409 (AC-2).
  async findOpenFor(courierId: string, deliveryId: string): Promise<{ id: string } | null> {
    return this.prisma.reviewRequest.findUnique({
      where: { openFor: `${courierId}:${deliveryId}` },
      select: { id: true },
    })
  }

  // AC-8: the rider's own requests, newest first, paged.
  async findPageForCourier(
    courierId: string,
    options: { page?: number; perPage?: number }
  ): Promise<PaginatedResult<ReviewRequestRecord>> {
    return this.findPage(
      { courierId },
      [{ createdAt: 'desc' }, { id: 'desc' }],
      options
    )
  }

  // AC-5: open ones by due date, earliest first, so the overdue ones lead; answered and withdrawn
  // ones newest first.
  async findPageForAdmin(
    status: EnumReviewRequestStatus,
    options: { page?: number; perPage?: number }
  ): Promise<PaginatedResult<ReviewRequestRecord>> {
    const orderBy: ReviewOrder =
      status === EnumReviewRequestStatus.OPEN
        ? [{ dueAt: 'asc' }, { id: 'asc' }]
        : status === EnumReviewRequestStatus.ANSWERED
          ? [{ answeredAt: 'desc' }, { id: 'desc' }]
          : [{ withdrawnAt: 'desc' }, { id: 'desc' }]
    return this.findPage({ status }, orderBy, options)
  }

  // AC-5: the sidebar's count, and how many of those are past their due date.
  async countOpen(now: Date): Promise<{ open: number; overdue: number }> {
    const [open, overdue] = await Promise.all([
      this.prisma.reviewRequest.count({ where: { status: EnumReviewRequestStatus.OPEN } }),
      this.prisma.reviewRequest.count({ where: { status: EnumReviewRequestStatus.OPEN, dueAt: { lt: now } } }),
    ])
    return { open, overdue }
  }

  private async findPage(
    where: Prisma.ReviewRequestWhereInput,
    orderBy: ReviewOrder,
    options: { page?: number; perPage?: number }
  ): Promise<PaginatedResult<ReviewRequestRecord>> {
    const page = options.page ?? 1
    const perPage = options.perPage ?? 20
    const [total, rows] = await Promise.all([
      this.prisma.reviewRequest.count({ where }),
      this.prisma.reviewRequest.findMany({
        where,
        orderBy,
        include: REVIEW_INCLUDE,
        take: perPage,
        skip: (page - 1) * perPage,
      }),
    ])
    const result = { data: rows, pagination: buildPagination(total, page, perPage, rows.length) }
    return { ...result, data: await this.withCorrections(result.data) }
  }

  // One query for the corrections of a whole page.
  private async withCorrections(requests: ReviewRequestWithDetails[]): Promise<ReviewRequestRecord[]> {
    if (requests.length === 0) return []
    const corrections = await this.prisma.courierCompensation.findMany({
      where: { reviewOf: { in: requests.map((request) => request.id) } },
      select: { reviewOf: true, amount: true },
    })
    const byRequest = new Map(corrections.map((row) => [row.reviewOf, row.amount]))
    return requests.map((request) => ({ ...request, correctionCents: byRequest.get(request.id) ?? null }))
  }
}
