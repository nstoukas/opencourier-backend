import { Injectable } from '@nestjs/common'
import { EnumSplitRequestStatus, Prisma, SplitRequest } from '@prisma/types'
import { isUniqueConstraintError } from 'src/prisma.util'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

// What the admin queue reads beside the request: the rider's name and the delivery (spec 0047, AC-4).
const QUEUE_INCLUDE = {
  courier: { select: { firstName: true, lastName: true } },
  delivery: {
    select: { orderReference: true, pickupBusinessName: true, boxSize: true, legNumber: true, legCount: true, status: true },
  },
} satisfies Prisma.SplitRequestInclude

export type SplitRequestForQueue = Prisma.SplitRequestGetPayload<{ include: typeof QUEUE_INCLUDE }>

// Spec 0047: split requests. One open per delivery through `openFor` (the delivery id while OPEN, null
// after), like removal requests. Every status change is one write conditional on OPEN, so two admins
// answering at once, or an answer racing the rider's leave, have exactly one winner (AC-9).
@Injectable()
export class SplitRequestRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  // Null when an open request already exists for the delivery (the unique `openFor` key).
  async createOpen(input: { deliveryId: string; courierId: string; proposedLegs: Prisma.InputJsonValue }) {
    try {
      return await this.prisma.splitRequest.create({
        data: { ...input, status: EnumSplitRequestStatus.OPEN, openFor: input.deliveryId },
      })
    } catch (error) {
      if (error instanceof Error && isUniqueConstraintError(error)) return null
      throw error
    }
  }

  async findById(id: string): Promise<SplitRequest | null> {
    return this.prisma.splitRequest.findUnique({ where: { id } })
  }

  async findOpenForDelivery(deliveryId: string): Promise<SplitRequest | null> {
    return this.prisma.splitRequest.findUnique({ where: { openFor: deliveryId } })
  }

  // Whether THIS call closed the open request with `data` (status and answer fields). `tx` lets a confirm
  // claim it inside the transaction that creates the legs, so a refusal rolls the claim back too.
  async closeIfOpen(
    id: string,
    data: Omit<Prisma.SplitRequestUncheckedUpdateManyInput, 'openFor'>,
    tx: Prisma.TransactionClient = this.prisma
  ): Promise<boolean> {
    const updated = await tx.splitRequest.updateMany({
      where: { id, status: EnumSplitRequestStatus.OPEN },
      data: { ...data, openFor: null },
    })
    return updated.count === 1
  }

  // Open requests, oldest first, for the admin queue (AC-4).
  async findOpenForQueue(): Promise<SplitRequestForQueue[]> {
    return this.prisma.splitRequest.findMany({
      where: { status: EnumSplitRequestStatus.OPEN },
      include: QUEUE_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
  }

  async countOpen(): Promise<number> {
    return this.prisma.splitRequest.count({ where: { status: EnumSplitRequestStatus.OPEN } })
  }

  // The newest request on each of these deliveries by this rider, for the job list (AC-2, AC-7).
  async findNewestByCourierForDeliveries(courierId: string, deliveryIds: string[]): Promise<SplitRequest[]> {
    if (deliveryIds.length === 0) return []
    const rows = await this.prisma.splitRequest.findMany({
      where: { courierId, deliveryId: { in: deliveryIds } },
      orderBy: { createdAt: 'desc' },
    })
    const newest = new Map<string, SplitRequest>()
    for (const row of rows) if (!newest.has(row.deliveryId)) newest.set(row.deliveryId, row)
    return [...newest.values()]
  }

  // The newest request that ended this delivery by the rider leaving, for the restaurant (AC-8, AC-10).
  async findOutcomesForDeliveries(deliveryIds: string[]): Promise<{ deliveryId: string; status: EnumSplitRequestStatus }[]> {
    if (deliveryIds.length === 0) return []
    return this.prisma.splitRequest.findMany({
      where: {
        deliveryId: { in: deliveryIds },
        status: { in: [EnumSplitRequestStatus.CONFIRMED, EnumSplitRequestStatus.LEFT] },
      },
      select: { deliveryId: true, status: true },
    })
  }
}
