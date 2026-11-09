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

  // The charge for this delivery's cancellation, or null.
  async findByDeliveryId(deliveryId: string): Promise<PartnerCharge | null> {
    return this.prisma.partnerCharge.findUnique({ where: { cancellationOf: deliveryId } })
  }

  // One cancellation charge per delivery: a second writer hits the unique key and gets the existing row.
  async createOnce(input: IPartnerChargeCreateInput): Promise<PartnerCharge> {
    try {
      return await this.prisma.partnerCharge.create({ data: { ...input, cancellationOf: input.deliveryId } })
    } catch (error) {
      if (error instanceof Error && isUniqueConstraintError(error)) {
        const existing = await this.findByDeliveryId(input.deliveryId)
        if (existing) return existing
      }
      throw error
    }
  }

  // Spec 0033: one wait's charge, once.
  async createWaitChargeOnce(input: IPartnerChargeCreateInput & { waitOf: string }): Promise<PartnerCharge> {
    try {
      return await this.prisma.partnerCharge.create({ data: input })
    } catch (error) {
      if (error instanceof Error && isUniqueConstraintError(error)) {
        const existing = await this.prisma.partnerCharge.findUnique({ where: { waitOf: input.waitOf } })
        if (existing) return existing
      }
      throw error
    }
  }
}
