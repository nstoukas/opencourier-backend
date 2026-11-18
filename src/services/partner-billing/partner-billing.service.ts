import { Injectable, Logger } from '@nestjs/common'
import { EnumPartnerChargeReason } from '@prisma/types'
import * as errors from 'src/errors'
import {
  AmountTotal,
  ChargeTotals,
  adminLabel,
  amountsByCurrency,
  athensMonthOf,
  athensMonthRange,
  chargeHappenedAt,
  countByAthensMonth,
  isBillingMonth,
  pickupAddressText,
  totalsByCurrency,
  waitEndEventId,
} from 'src/domains/partner-billing/billing-month'
import {
  BillRow,
  BillingChargeRow,
  PartnerBillingRepository,
} from 'src/persistence/repositories/partner-billing.repository'

// The most charges one bill may cover (spec 0036, API surface).
export const PARTNER_BILL_MAX_CHARGES = 500
export const PARTNER_BILL_REFERENCE_MAX = 60
export const PARTNER_BILL_UNDO_REASON_MAX = 300

// One charge as the admin pages, the statement and the CSV show it (AC-3). Nothing about the
// customer: no name, phone or drop off address (AC-13).
export interface ChargeLine {
  id: string
  createdAt: Date // when the charge was written: decides its month
  happenedAt: Date // when the cancellation, the wait or the removal happened: shown on the line
  reason: EnumPartnerChargeReason
  waitMinutes: number | null
  removalLabel: string | null
  amount: number // cents
  currencyCode: string
  deliveryId: string
  orderReference: string | null
}

// A line on the admin pages also says which open bill covers it, if any.
export interface BilledChargeLine extends ChargeLine {
  billId: string | null
  bill: { id: string; reference: string | null; createdAt: Date } | null
}

export interface OverviewChargeLine extends BilledChargeLine {
  partnerId: string
  partnerName: string
}

export interface BillView {
  id: string
  month: string
  reference: string | null
  createdAt: Date
  billedByLabel: string
  lineCount: number
  totals: AmountTotal[]
  undoneAt: Date | null
  undoneByLabel: string | null
  undoReason: string | null
  chargeIds: string[]
}

export interface MonthOverview {
  month: string
  restaurants: { partnerId: string; partnerName: string; count: number; totals: ChargeTotals[] }[]
  charges: OverviewChargeLine[]
  earlierUnbilled: { month: string; count: number }[]
}

export interface PartnerMonth {
  partner: { id: string; name: string }
  month: string
  charges: BilledChargeLine[]
  bills: BillView[]
  totals: ChargeTotals[]
}

export interface BillStatement {
  partner: { name: string; pickupAddress: string | null }
  month: string
  bill: BillView
  lines: ChargeLine[]
  totals: AmountTotal[]
}

// The admin who bills or undoes; only what the stored label needs.
export interface BillingAdmin {
  id: string
  email: string | null
  username: string | null
}

// Spec 0036: what each restaurant owes, per Athens month, and the bills admins make of it by hand.
// Billing is its own record, not a DeliveryEvent: no rider's pay or assignment changes (decision 109.1).
@Injectable()
export class PartnerBillingService {
  private readonly logger = new Logger(PartnerBillingService.name)

  constructor(private readonly partnerBillingRepository: PartnerBillingRepository) {}

  // AC-1, AC-2, AC-4, AC-11. Every restaurant with a charge this month, its lines (for the CSV),
  // and the earlier months that still hold unbilled charges. partnerId narrows all three to one
  // restaurant (the line on the restaurant's own page).
  async getMonthOverview(month: string, partnerId?: string): Promise<MonthOverview> {
    this.refuseBadMonth(month)
    const { start, end } = athensMonthRange(month)
    const rows = await this.partnerBillingRepository.findChargesWrittenBetween(start, end, partnerId)
    const toLine = await this.lineBuilder(rows)

    const byPartner = new Map<string, { partnerName: string; charges: BillingChargeRow[] }>()
    for (const row of rows) {
      const group = byPartner.get(row.partnerId) ?? { partnerName: row.partner.name, charges: [] }
      group.charges.push(row)
      byPartner.set(row.partnerId, group)
    }
    const restaurants = [...byPartner.entries()].map(([id, group]) => ({
      partnerId: id,
      partnerName: group.partnerName,
      count: group.charges.length,
      totals: totalsByCurrency(group.charges),
    }))
    // Most unbilled first, then by name. The sum across currencies is only an order, never shown.
    const unbilledOf = (totals: ChargeTotals[]) => totals.reduce((sum, total) => sum + total.unbilled, 0)
    restaurants.sort(
      (a, b) => unbilledOf(b.totals) - unbilledOf(a.totals) || a.partnerName.localeCompare(b.partnerName)
    )

    const earlier = await this.partnerBillingRepository.findUnbilledWrittenBefore(start, partnerId)
    return {
      month,
      restaurants,
      charges: rows.map((row) => ({
        ...withBill(toLine(row), row),
        partnerId: row.partnerId,
        partnerName: row.partner.name,
      })),
      earlierUnbilled: countByAthensMonth(earlier),
    }
  }

  // AC-3, AC-4, AC-8. One restaurant's month: every line oldest first, its bills newest first.
  async getPartnerMonth(month: string, partnerId: string): Promise<PartnerMonth> {
    this.refuseBadMonth(month)
    const partner = await this.partnerBillingRepository.findPartner(partnerId)
    if (!partner) throw new errors.NotFoundException('Restaurant not found')
    const { start, end } = athensMonthRange(month)
    const rows = await this.partnerBillingRepository.findChargesWrittenBetween(start, end, partnerId)
    const toLine = await this.lineBuilder(rows)
    const bills = await this.partnerBillingRepository.findBills(partnerId, month)
    return {
      partner: { id: partner.id, name: partner.name },
      month,
      charges: rows.map((row) => withBill(toLine(row), row)),
      bills: bills.map(toBillView),
      totals: totalsByCurrency(rows),
    }
  }

  // AC-5, AC-6, AC-14. All or nothing: a charge that is unknown, of another restaurant or of
  // another month answers 400; one already in an open bill answers 409 with the ids already billed.
  // 400 wins when both happen. Nothing is written in either case.
  async createBill(
    input: { partnerId: string; month: string; chargeIds: string[]; reference?: string | null },
    admin: BillingAdmin
  ): Promise<BillView> {
    this.refuseBadMonth(input.month)
    const chargeIds = input.chargeIds
    if (chargeIds.length === 0 || chargeIds.length > PARTNER_BILL_MAX_CHARGES) {
      throw new errors.BadRequestException(`A bill covers 1 to ${PARTNER_BILL_MAX_CHARGES} charges.`)
    }
    if (new Set(chargeIds).size !== chargeIds.length) {
      throw new errors.BadRequestException('A charge is listed twice.')
    }
    const reference = input.reference?.trim() || null
    if (reference !== null && reference.length > PARTNER_BILL_REFERENCE_MAX) {
      throw new errors.BadRequestException(`The reference is at most ${PARTNER_BILL_REFERENCE_MAX} characters.`)
    }

    const partner = await this.partnerBillingRepository.findPartner(input.partnerId)
    if (!partner) throw new errors.NotFoundException('Restaurant not found')

    // A charge's restaurant and the moment it was written never change, so this check holds for the
    // transaction below too.
    const charges = await this.partnerBillingRepository.findChargesByIds(chargeIds)
    const outOfScope =
      charges.length !== chargeIds.length ||
      charges.some((charge) => charge.partnerId !== input.partnerId || athensMonthOf(charge.createdAt) !== input.month)
    if (outOfScope) {
      throw new errors.BadRequestException("Some of these charges are not this restaurant's charges for this month.")
    }
    const billedBefore = charges.filter((charge) => charge.billId !== null).map((charge) => charge.id)
    if (billedBefore.length > 0) throw new errors.PartnerChargesAlreadyBilledException(billedBefore)

    const bill = await this.partnerBillingRepository.createBillIfAllUnbilled({
      partnerId: input.partnerId,
      month: input.month,
      reference,
      chargeIds,
      billedByUserId: admin.id,
      billedByLabel: adminLabel(admin),
    })
    if (!bill) {
      // Another bill took some of them between the check and the write; nothing was written.
      const now = await this.partnerBillingRepository.findChargesByIds(chargeIds)
      throw new errors.PartnerChargesAlreadyBilledException(
        now.filter((charge) => charge.billId !== null).map((charge) => charge.id)
      )
    }

    this.logger.log(
      `PARTNER_BILL_CREATED ${JSON.stringify({
        billId: bill.id,
        partnerId: bill.partnerId,
        adminUserId: admin.id,
        lineCount: bill.lines.length,
      })}`
    )
    return toBillView(bill)
  }

  // AC-7, AC-14. Undoing needs a reason; the charges become unbilled again and the lines stay.
  async undoBill(billId: string, reason: string, admin: BillingAdmin): Promise<BillView> {
    const trimmed = typeof reason === 'string' ? reason.trim() : ''
    if (trimmed.length === 0 || trimmed.length > PARTNER_BILL_UNDO_REASON_MAX) {
      throw new errors.BadRequestException(`Say why, in 1 to ${PARTNER_BILL_UNDO_REASON_MAX} characters.`)
    }
    const result = await this.partnerBillingRepository.undoBill({
      billId,
      undoneByUserId: admin.id,
      undoneByLabel: adminLabel(admin),
      undoReason: trimmed,
    })
    if (result === 'NOT_FOUND') throw new errors.NotFoundException('Bill not found')
    if (result === 'ALREADY_UNDONE') throw new errors.PartnerBillAlreadyUndoneException()

    const bill = await this.partnerBillingRepository.findBill(billId)
    if (!bill) throw new errors.NotFoundException('Bill not found')
    this.logger.log(
      `PARTNER_BILL_UNDONE ${JSON.stringify({
        billId: bill.id,
        partnerId: bill.partnerId,
        adminUserId: admin.id,
        lineCount: bill.lines.length,
      })}`
    )
    return toBillView(bill)
  }

  // AC-9. One bill's own lines, never another bill's, with no billId on them: a charge billed again
  // after an undo never shows through on this statement.
  async getStatement(billId: string): Promise<BillStatement> {
    const bill = await this.partnerBillingRepository.findBill(billId)
    if (!bill) throw new errors.NotFoundException('Bill not found')
    const partner = await this.partnerBillingRepository.findPartner(bill.partnerId)
    if (!partner) throw new errors.NotFoundException('Restaurant not found')
    const rows = await this.partnerBillingRepository.findBillCharges(bill.id)
    const view = toBillView(bill)
    const toLine = await this.lineBuilder(rows)
    return {
      partner: { name: partner.name, pickupAddress: pickupAddressText(partner.pickupLocation) },
      month: bill.month,
      bill: view,
      lines: rows.map(toLine),
      totals: view.totals,
    }
  }

  // Reads, in two queries, what these rows' lines need beyond the row itself (the time a wait's
  // event happened, a removal's approval time and label), and returns a function that turns one
  // row into its line (Value sourcing).
  private async lineBuilder(rows: BillingChargeRow[]): Promise<(row: BillingChargeRow) => ChargeLine> {
    const waitEventIds = rows
      .filter((row) => row.reason === EnumPartnerChargeReason.WAITING)
      .map((row) => waitEndEventId(row.waitOf))
      .filter((id): id is string => id !== null)
    const removalIds = rows
      .filter((row) => row.reason === EnumPartnerChargeReason.REMOVAL && row.removalOf !== null)
      .map((row) => row.removalOf as string)
    const eventTimes = await this.partnerBillingRepository.findEventTimes(waitEventIds)
    const removals = await this.partnerBillingRepository.findRemovalRequests(removalIds)

    return (row) => {
      const eventId = waitEndEventId(row.waitOf)
      const removal = row.removalOf ? removals.get(row.removalOf) : undefined
      return {
        id: row.id,
        createdAt: row.createdAt,
        happenedAt: chargeHappenedAt(row, {
          cancelledAt: row.delivery.cancelledAt,
          waitEndedAt: eventId ? eventTimes.get(eventId) ?? null : null,
          removalDecidedAt: removal?.decidedAt ?? null,
        }),
        reason: row.reason,
        waitMinutes: row.waitMinutes,
        removalLabel: row.reason === EnumPartnerChargeReason.REMOVAL ? removal?.label ?? null : null,
        amount: row.amount,
        currencyCode: row.currencyCode,
        deliveryId: row.deliveryId,
        orderReference: row.delivery.orderReference,
      }
    }
  }

  private refuseBadMonth(month: string): void {
    if (!isBillingMonth(month)) throw new errors.BadRequestException('The month is written YYYY-MM.')
  }
}

function withBill(line: ChargeLine, row: BillingChargeRow): BilledChargeLine {
  return { ...line, billId: row.billId, bill: row.bill }
}

function toBillView(bill: BillRow): BillView {
  const charges = bill.lines.map((line) => line.charge)
  return {
    id: bill.id,
    month: bill.month,
    reference: bill.reference,
    createdAt: bill.createdAt,
    billedByLabel: bill.billedByLabel,
    lineCount: charges.length,
    totals: amountsByCurrency(charges),
    undoneAt: bill.undoneAt,
    undoneByLabel: bill.undoneByLabel,
    undoReason: bill.undoReason,
    chargeIds: charges.map((charge) => charge.id),
  }
}
