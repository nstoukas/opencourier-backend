import { Injectable } from '@nestjs/common'
import { EnumPartnerAvailabilityAction, EnumUserRole, Prisma } from '@prisma/types'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

export type PartnerAvailabilityChangeData = {
  action: EnumPartnerAvailabilityAction
  actorRole: EnumUserRole
  actorUserId: string
  extraMinutes?: number
  pausedUntil?: Date
  reason?: string
}

@Injectable()
export class PartnerAvailabilityChangeRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  // Spec 0029, AC-10: the change and its record are one transaction, so neither exists without the other.
  async applyChange(
    partnerId: string,
    partnerData: Prisma.PartnerUncheckedUpdateInput,
    change: PartnerAvailabilityChangeData
  ): Promise<PartnerEntity> {
    const [partner] = await this.prisma.$transaction([
      // The same relations the page's read loads, so an admin's answer keeps the email and the pickup.
      this.prisma.partner.update({
        where: { id: partnerId },
        data: partnerData,
        include: { user: { select: { email: true } }, pickupLocation: true },
      }),
      this.prisma.partnerAvailabilityChange.create({ data: { ...change, partnerId } }),
    ])
    return new PartnerEntity(partner)
  }

  // The newest changes, each with the sign in email of who made it (AC-9).
  async findLatest(partnerId: string, take: number) {
    const rows = await this.prisma.partnerAvailabilityChange.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
      take,
    })
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.actorUserId))] } },
      select: { id: true, email: true },
    })
    const emailOf = new Map(users.map((user) => [user.id, user.email]))
    return rows.map((row) => ({ ...row, actorEmail: emailOf.get(row.actorUserId) ?? null }))
  }
}
