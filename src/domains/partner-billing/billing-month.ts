import { EnumPartnerChargeReason } from '@prisma/types'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { dayjs } from 'src/core/utils/time'

// Spec 0036. A charge belongs to the calendar month, in Athens, of the moment it was written
// (`PartnerCharge.createdAt`). That moment never moves, so a month that was billed cannot gain or
// lose a charge afterwards. Everything here is a plain function so the month rules can be tested
// without a database.

// `YYYY-MM`, months 01 to 12. The year starts at 1970 only so a typo like 0000 is refused.
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/

// True when the text is a month this API accepts (AC-2: anything else answers 400).
export function isBillingMonth(text: unknown): text is string {
  if (typeof text !== 'string') return false
  const match = MONTH_PATTERN.exec(text)
  return match !== null && Number(match[1]) >= 1970
}

// The month after this one, as `YYYY-MM` (December rolls over to January of the next year).
export function nextBillingMonth(month: string): string {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  return monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}`
}

// The UTC instants a month covers: from Athens midnight on its first day (included) to Athens
// midnight on the first day of the next month (excluded). Athens never skips midnight (its clock
// changes at 03:00 and 04:00), so both ends always exist.
export function athensMonthRange(month: string): { start: Date; end: Date } {
  return {
    start: dayjs.tz(`${month}-01 00:00`, INSTANCE_TIMEZONE).toDate(),
    end: dayjs.tz(`${nextBillingMonth(month)}-01 00:00`, INSTANCE_TIMEZONE).toDate(),
  }
}

// The Athens month an instant falls in, as `YYYY-MM`.
export function athensMonthOf(instant: Date): string {
  return dayjs(instant).tz(INSTANCE_TIMEZONE).format('YYYY-MM')
}

// One total per currency (AC-4): amounts in different currencies are never added together.
export interface ChargeTotals {
  currencyCode: string
  charged: number // cents
  billed: number // cents
  unbilled: number // cents
}

// The totals of a set of charges, in cents, one entry per currency, sorted by currency code.
// Billed means the charge sits in an open bill (`billId` set); unbilled is the rest.
export function totalsByCurrency(
  charges: ReadonlyArray<{ amount: number; currencyCode: string; billId: string | null }>
): ChargeTotals[] {
  const byCurrency = new Map<string, ChargeTotals>()
  for (const charge of charges) {
    const totals = byCurrency.get(charge.currencyCode) ?? {
      currencyCode: charge.currencyCode,
      charged: 0,
      billed: 0,
      unbilled: 0,
    }
    totals.charged += charge.amount
    if (charge.billId === null) totals.unbilled += charge.amount
    else totals.billed += charge.amount
    byCurrency.set(charge.currencyCode, totals)
  }
  return [...byCurrency.values()].sort((a, b) => a.currencyCode.localeCompare(b.currencyCode))
}

// A bill's own total, one entry per currency.
export interface AmountTotal {
  currencyCode: string
  amount: number // cents
}

export function amountsByCurrency(charges: ReadonlyArray<{ amount: number; currencyCode: string }>): AmountTotal[] {
  const byCurrency = new Map<string, number>()
  for (const charge of charges) {
    byCurrency.set(charge.currencyCode, (byCurrency.get(charge.currencyCode) ?? 0) + charge.amount)
  }
  return [...byCurrency.entries()]
    .map(([currencyCode, amount]) => ({ currencyCode, amount }))
    .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode))
}

// How many unbilled charges each earlier month holds (AC-1), oldest month first.
export function countByAthensMonth(instants: ReadonlyArray<Date>): { month: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const instant of instants) {
    const month = athensMonthOf(instant)
    counts.set(month, (counts.get(month) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

// The event that ended a wait, taken from the charge's `waitOf` key (`<deliveryId>:<eventId>`).
export function waitEndEventId(waitOf: string | null): string | null {
  if (!waitOf) return null
  const separator = waitOf.indexOf(':')
  return separator === -1 ? null : waitOf.slice(separator + 1) || null
}

// When the thing a charge is for happened (AC-3, Value sourcing): the cancellation, the end of the
// wait, or the admin's approval of the removal. Falls back to when the charge was written.
export function chargeHappenedAt(
  charge: { reason: EnumPartnerChargeReason; createdAt: Date },
  sources: { cancelledAt: Date | null; waitEndedAt: Date | null; removalDecidedAt: Date | null }
): Date {
  switch (charge.reason) {
    case EnumPartnerChargeReason.CANCELLATION:
      return sources.cancelledAt ?? charge.createdAt
    case EnumPartnerChargeReason.WAITING:
      return sources.waitEndedAt ?? charge.createdAt
    case EnumPartnerChargeReason.REMOVAL:
      return sources.removalDecidedAt ?? charge.createdAt
    default:
      return charge.createdAt
  }
}

// The restaurant's pickup address as one line for its statement (AC-9), or null when there is
// nothing to show (the line is then left out).
export function pickupAddressText(
  location: {
    formattedAddress: string | null
    addressLine1: string | null
    city: string | null
    zipCode: string | null
  } | null
): string | null {
  if (!location) return null
  const formatted = location.formattedAddress?.trim()
  if (formatted) return formatted
  const parts = [location.addressLine1, location.city, location.zipCode]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '')
  return parts.length > 0 ? parts.join(', ') : null
}

// The label stored for the admin who billed or undid a bill: a copy, so it still reads after the
// user is deleted (spec 0035's decidedBy precedent).
export function adminLabel(user: { id: string; email: string | null; username: string | null }): string {
  return user.email ?? user.username ?? user.id
}
