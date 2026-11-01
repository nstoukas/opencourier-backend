import { Injectable } from '@nestjs/common'
import { EnumPartnerChargeReason, PartnerCharge } from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { isUniqueConstraintError } from 'src/prisma.util'

export interface IPartnerChargeCreateInput {
  partnerId: string
  deliveryId: string
  amount: number // cents
  currencyCode: string
  reason: EnumPartnerChargeReason
}

// What restaurants owe the co-op (spec 0015). Written here, invoiced later by the payments rows.
@Injectable()
export class PartnerChargeRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async findByDeliveryId(deliveryId: string): Promise<PartnerCharge | null> {
    return this.prisma.partnerCharge.findUnique({ where: { deliveryId } })
  }

  // One charge per delivery: a second writer hits the unique key and gets the existing row.
  async createOnce(input: IPartnerChargeCreateInput): Promise<PartnerCharge> {
    try {
      return await this.prisma.partnerCharge.create({ data: input })
    } catch (error) {
      if (error instanceof Error && isUniqueConstraintError(error)) {
        const existing = await this.findByDeliveryId(input.deliveryId)
        if (existing) return existing
      }
      throw error
    }
  }
}
