import { EnumDeliveryStatus, Prisma } from '@prisma/types'
import { PARTNER_ENDED_STATUSES } from 'src/domains/delivery/ready-signals'

export { PARTNER_ENDED_STATUSES }

// Order history (spec 0017). A restaurant sees a delivery of its own when it was created within the
// co-op's period (restaurantHistoryDays, rolling 24 h days back from now) or is still open, whatever
// its age, so it never loses sight of an order it may still act on (decision 28.2). Older ended
// deliveries hold a customer's name, phone and address the restaurant no longer needs.

const DAY_MS = 24 * 60 * 60 * 1000

// The oldest creation time a restaurant still sees for an ended delivery.
export function partnerHistoryCutoff(days: number, now: Date): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

// The list's where: this restaurant's deliveries in the period, or still open. Compared in the database.
export function partnerHistoryWhere(partnerId: string, days: number, now: Date): Prisma.DeliveryWhereInput {
  return {
    partnerId,
    OR: [{ createdAt: { gte: partnerHistoryCutoff(days, now) } }, { status: { notIn: PARTNER_ENDED_STATUSES } }],
  }
}

// The same rule for one delivery already read (the routes that take a delivery id).
export function isInPartnerHistory(
  delivery: { createdAt: Date; status: EnumDeliveryStatus },
  days: number,
  now: Date
): boolean {
  return !PARTNER_ENDED_STATUSES.includes(delivery.status) || delivery.createdAt >= partnerHistoryCutoff(days, now)
}

// What the restaurant reads for its own order past the period (AC-3).
export function olderThanHistoryMessage(days: number): string {
  return `This order is older than ${days} ${days === 1 ? 'day' : 'days'}. The co-op can look it up for you.`
}
