import { Injectable } from '@nestjs/common'
import { EnumDeliveryIssueReason, Prisma } from '@prisma/types'

import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

// A rider's report and the name of the rider who sent it (decision 66.11).
export type DeliveryIssueWithCourier = {
  id: string
  deliveryId: string
  courierId: string
  reason: EnumDeliveryIssueReason
  note: string | null
  createdAt: Date
  courier: { firstName: string; lastName: string }
}

// What the admin's report list reads besides the report: the rider's name and who marked it handled
// (spec 0034, AC-7). `satisfies` checks the object against Prisma's type without widening it.
const ADMIN_INCLUDE = {
  courier: { select: { firstName: true, lastName: true } },
  handledBy: { select: { id: true, email: true, username: true } },
} satisfies Prisma.DeliveryIssueInclude

export type DeliveryIssueForAdmin = Prisma.DeliveryIssueGetPayload<{ include: typeof ADMIN_INCLUDE }>

// An open report and the delivery it is about, for the Dispatch board's list (spec 0034, AC-7).
const OPEN_INCLUDE = {
  courier: { select: { firstName: true, lastName: true } },
  delivery: {
    select: {
      status: true,
      courierId: true,
      orderReference: true,
      pickupBusinessName: true,
      dropoffName: true,
      dropoffBusinessName: true,
    },
  },
} satisfies Prisma.DeliveryIssueInclude

export type OpenDeliveryIssue = Prisma.DeliveryIssueGetPayload<{ include: typeof OPEN_INCLUDE }>

// Riders' reports about a delivery (wrong address, no signal, order handed over, other), read by
// the admin. Each report is its own row, so several reports keep their rider and time.
@Injectable()
export class DeliveryIssueRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async create(input: {
    deliveryId: string
    courierId: string
    reason: EnumDeliveryIssueReason
    note: string | null
  }): Promise<DeliveryIssueWithCourier> {
    return this.prisma.deliveryIssue.create({
      data: input,
      include: { courier: { select: { firstName: true, lastName: true } } },
    })
  }

  // Oldest first, as a timeline reads.
  async findForDelivery(deliveryId: string): Promise<DeliveryIssueForAdmin[]> {
    return this.prisma.deliveryIssue.findMany({
      where: { deliveryId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: ADMIN_INCLUDE,
    })
  }

  // Every report nobody has handled, whatever the delivery's status (spec 0034, AC-7).
  async findOpen(): Promise<OpenDeliveryIssue[]> {
    return this.prisma.deliveryIssue.findMany({
      where: { handledAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: OPEN_INCLUDE,
    })
  }

  // Spec 0034, AC-7. The update only touches a report still open, so a second click (or a second
  // admin) keeps the first person and time. Null when no such report exists on this delivery.
  async markHandled(
    deliveryId: string,
    issueId: string,
    userId: string,
    now: Date
  ): Promise<DeliveryIssueForAdmin | null> {
    await this.prisma.deliveryIssue.updateMany({
      where: { id: issueId, deliveryId, handledAt: null },
      data: { handledAt: now, handledByUserId: userId },
    })
    return this.prisma.deliveryIssue.findFirst({ where: { id: issueId, deliveryId }, include: ADMIN_INCLUDE })
  }
}
