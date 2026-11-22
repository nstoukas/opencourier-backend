import { Injectable } from '@nestjs/common'
import { OfferReason, Prisma } from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { OfferReasonInput } from 'src/domains/matching/offer-reason'

// Spec 0044 (AC-6): one OfferReason per OFFERED event. Written after the event (pay first: an offer
// whose reason cannot be written is still made, and the caller logs the failure).
@Injectable()
export class OfferReasonRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async create(
    deliveryEventId: string,
    deliveryId: string,
    courierId: string,
    reason: OfferReasonInput
  ): Promise<OfferReason> {
    return this.prisma.offerReason.create({
      data: {
        deliveryEventId,
        deliveryId,
        courierId,
        strategy: reason.strategy,
        // `as Prisma.InputJsonValue`: Prisma's JSON input type; these are plain numbers and strings.
        weights: (reason.weights ?? undefined) as Prisma.InputJsonValue | undefined,
        values: reason.values as Prisma.InputJsonValue,
        score: reason.score ?? null,
        candidateCount: reason.candidateCount ?? 0,
        ridersInRange: reason.ridersInRange ?? 0,
        candidates: (reason.candidates ?? undefined) as Prisma.InputJsonValue | undefined,
        // Spec 0048: STACK or ADD_ON; a single offer keeps the column's default, SINGLE.
        kind: reason.kind ?? 'SINGLE',
      },
    })
  }

  // AC-8: a delivery's offer reasons, oldest first, for the admin delivery page.
  async findByDeliveryId(deliveryId: string): Promise<OfferReason[]> {
    // agy review: the id breaks a tie between two reasons written in the same millisecond.
    return this.prisma.offerReason.findMany({ where: { deliveryId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  }

  // Spec 0045 (AC-1, cross check 4): the reason a rider read for their own job: the latest one for this
  // rider and delivery written up to `upTo` (their accept). Never selects `candidates` (AC-5): other
  // riders' figures must not even be loaded on a courier path.
  async findOwnLatest(courierId: string, deliveryId: string, upTo: Date) {
    return this.prisma.offerReason.findFirst({
      where: { courierId, deliveryId, createdAt: { lte: upTo } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { strategy: true, kind: true, values: true, weights: true },
    })
  }
}
