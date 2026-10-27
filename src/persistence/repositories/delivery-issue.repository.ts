import { Injectable } from '@nestjs/common'
import { EnumDeliveryIssueReason } from '@prisma/types'

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
  async findForDelivery(deliveryId: string): Promise<DeliveryIssueWithCourier[]> {
    return this.prisma.deliveryIssue.findMany({
      where: { deliveryId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { courier: { select: { firstName: true, lastName: true } } },
    })
  }
}
