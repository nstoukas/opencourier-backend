import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { isTransactionConflictError } from 'src/prisma.util'

// Spec 0036: what each restaurant owes, and the bills admins make of it by hand.

// The columns a charge line needs, and nothing about the customer (AC-13).
export const BILLING_CHARGE_SELECT = {
  id: true,
  partnerId: true,
  deliveryId: true,
  amount: true,
  currencyCode: true,
  reason: true,
  createdAt: true,
  billId: true,
  waitOf: true,
  removalOf: true,
  // Spec 0047 (cross check 3): a split wait's key, so its line has its own words.
  splitWaitOf: true,
  waitMinutes: true,
  partner: { select: { name: true } },
  delivery: { select: { orderReference: true, cancelledAt: true } },
  bill: { select: { id: true, reference: true, createdAt: true } },
} satisfies Prisma.PartnerChargeSelect

// `GetPayload` turns the select above into the exact type Prisma returns for it.
export type BillingChargeRow = Prisma.PartnerChargeGetPayload<{ select: typeof BILLING_CHARGE_SELECT }>

// A bill, with the amount and currency of every charge it covered (its lines never change).
export const BILL_INCLUDE = {
  lines: { select: { charge: { select: { id: true, amount: true, currencyCode: true } } } },
} satisfies Prisma.PartnerBillInclude

export type BillRow = Prisma.PartnerBillGetPayload<{ include: typeof BILL_INCLUDE }>

export type UndoBillResult = 'UNDONE' | 'NOT_FOUND' | 'ALREADY_UNDONE'

@Injectable()
export class PartnerBillingRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  // Every charge written in [start, end), oldest first; one restaurant's when partnerId is given.
  async findChargesWrittenBetween(start: Date, end: Date, partnerId?: string): Promise<BillingChargeRow[]> {
    return this.prisma.partnerCharge.findMany({
      where: { createdAt: { gte: start, lt: end }, ...(partnerId ? { partnerId } : {}) },
      select: BILLING_CHARGE_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  }

  // When each unbilled charge written before this instant was written (for "earlier months").
  async findUnbilledWrittenBefore(before: Date, partnerId?: string): Promise<Date[]> {
    const rows = await this.prisma.partnerCharge.findMany({
      where: { billId: null, createdAt: { lt: before }, ...(partnerId ? { partnerId } : {}) },
      select: { createdAt: true },
    })
    return rows.map((row) => row.createdAt)
  }

  // These charges, by id, with what a bill must check about them.
  async findChargesByIds(ids: string[]): Promise<{ id: string; partnerId: string; createdAt: Date; billId: string | null }[]> {
    return this.prisma.partnerCharge.findMany({
      where: { id: { in: ids } },
      select: { id: true, partnerId: true, createdAt: true, billId: true },
    })
  }

  // When each of these events happened (the event that ended a wait).
  async findEventTimes(eventIds: string[]): Promise<Map<string, Date>> {
    if (eventIds.length === 0) return new Map()
    const rows = await this.prisma.deliveryEvent.findMany({
      where: { id: { in: eventIds } },
      select: { id: true, occurredAt: true },
    })
    return new Map(rows.map((row) => [row.id, row.occurredAt]))
  }

  // The approval time and the reason's own label of each removal request.
  async findRemovalRequests(ids: string[]): Promise<Map<string, { decidedAt: Date | null; label: string }>> {
    if (ids.length === 0) return new Map()
    const rows = await this.prisma.deliveryRemovalRequest.findMany({
      where: { id: { in: ids } },
      select: { id: true, decidedAt: true, label: true },
    })
    return new Map(rows.map((row) => [row.id, { decidedAt: row.decidedAt, label: row.label }]))
  }

  async findPartner(partnerId: string) {
    return this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: {
        id: true,
        name: true,
        pickupLocation: { select: { formattedAddress: true, addressLine1: true, city: true, zipCode: true } },
      },
    })
  }

  // A restaurant's bills for a month, newest first, undone ones included (AC-8).
  async findBills(partnerId: string, month: string): Promise<BillRow[]> {
    return this.prisma.partnerBill.findMany({
      where: { partnerId, month },
      include: BILL_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
  }

  async findBill(id: string): Promise<BillRow | null> {
    return this.prisma.partnerBill.findUnique({ where: { id }, include: BILL_INCLUDE })
  }

  // The full rows of the charges a bill covered, oldest first (for its statement).
  async findBillCharges(billId: string): Promise<BillingChargeRow[]> {
    return this.prisma.partnerCharge.findMany({
      where: { billLines: { some: { billId } } },
      select: BILLING_CHARGE_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  }

  // AC-5, AC-6. Writes the bill, one line per charge, and points each charge at it, all in one
  // transaction. The charges are claimed with one conditional update (only those still unbilled):
  // if another bill took any of them first, the update counts short, everything rolls back and
  // this answers null. Postgres makes the second of two racing updates wait for the first and
  // check `billId is null` again, so a charge can only ever land in one open bill. Two bills claiming
  // overlapping charges in a different order can deadlock instead: Postgres aborts one transaction
  // (Prisma's P2034), nothing of it is written, and it is answered like a lost race (decision 109.6).
  async createBillIfAllUnbilled(input: {
    partnerId: string
    month: string
    reference: string | null
    chargeIds: string[]
    billedByUserId: string
    billedByLabel: string
  }): Promise<BillRow | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const bill = await tx.partnerBill.create({
          data: {
            partnerId: input.partnerId,
            month: input.month,
            reference: input.reference,
            billedByUserId: input.billedByUserId,
            billedByLabel: input.billedByLabel,
            lines: { create: input.chargeIds.map((chargeId) => ({ chargeId })) },
          },
        })
        const claimed = await tx.partnerCharge.updateMany({
          where: { id: { in: input.chargeIds }, billId: null },
          data: { billId: bill.id },
        })
        if (claimed.count !== input.chargeIds.length) throw new ChargesAlreadyBilledError()
        return tx.partnerBill.findUniqueOrThrow({ where: { id: bill.id }, include: BILL_INCLUDE })
      })
    } catch (error) {
      if (error instanceof ChargesAlreadyBilledError || isTransactionConflictError(error)) return null
      throw error
    }
  }

  // AC-7. Stamps the undo only on a bill that is still open, then frees the charges that still point
  // at it. Its lines stay. One transaction, so a bill is never half undone.
  async undoBill(input: {
    billId: string
    undoneByUserId: string
    undoneByLabel: string
    undoReason: string
  }): Promise<UndoBillResult> {
    return this.prisma.$transaction(async (tx) => {
      const stamped = await tx.partnerBill.updateMany({
        where: { id: input.billId, undoneAt: null },
        data: {
          undoneAt: new Date(),
          undoneByUserId: input.undoneByUserId,
          undoneByLabel: input.undoneByLabel,
          undoReason: input.undoReason,
        },
      })
      if (stamped.count === 0) {
        const exists = await tx.partnerBill.findUnique({ where: { id: input.billId }, select: { id: true } })
        return exists ? 'ALREADY_UNDONE' : 'NOT_FOUND'
      }
      await tx.partnerCharge.updateMany({ where: { billId: input.billId }, data: { billId: null } })
      return 'UNDONE'
    })
  }
}

// Thrown inside the bill transaction only, to roll it back when a charge was already billed.
class ChargesAlreadyBilledError extends Error {}
