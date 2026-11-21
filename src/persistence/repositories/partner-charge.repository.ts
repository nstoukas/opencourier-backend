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
  // On a WAITING row (spec 0036): the paid minutes, copied from the rider's award.
  waitMinutes?: number | null
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

  // Spec 0047 (AC-3): the split wait's charge, once per split request.
  async createSplitWaitChargeOnce(input: IPartnerChargeCreateInput & { splitWaitOf: string }): Promise<PartnerCharge> {
    try {
      return await this.prisma.partnerCharge.create({ data: input })
    } catch (error) {
      if (error instanceof Error && isUniqueConstraintError(error)) {
        const existing = await this.prisma.partnerCharge.findUnique({ where: { splitWaitOf: input.splitWaitOf } })
        if (existing) return existing
      }
      throw error
    }
  }

  // Spec 0047 (cross check 5): a new leg's charge is taken back when the leg ends without ever being
  // accepted, unless it was already billed: then it stays, and `kept` names it so the caller can log it
  // (an admin undoes the bill to take it back, spec 0036). `removed` is the row taken back, or null.
  async deleteUnbilledSplitLegCharge(
    legDeliveryId: string
  ): Promise<{ removed: PartnerCharge | null; kept: PartnerCharge | null }> {
    const charge = await this.prisma.partnerCharge.findUnique({ where: { splitLegOf: legDeliveryId } })
    if (!charge) return { removed: null, kept: null }
    if (charge.billId) return { removed: null, kept: charge }
    const removed = await this.prisma.partnerCharge.deleteMany({ where: { id: charge.id, billId: null } })
    // Billed between the read and the delete: it stays.
    return removed.count === 1 ? { removed: charge, kept: null } : { removed: null, kept: charge }
  }

  // Spec 0035: one approved removal's charge, once.
  async createRemovalChargeOnce(input: IPartnerChargeCreateInput & { removalOf: string }): Promise<PartnerCharge> {
    try {
      return await this.prisma.partnerCharge.create({ data: input })
    } catch (error) {
      if (error instanceof Error && isUniqueConstraintError(error)) {
        const existing = await this.prisma.partnerCharge.findUnique({ where: { removalOf: input.removalOf } })
        if (existing) return existing
      }
      throw error
    }
  }
}
