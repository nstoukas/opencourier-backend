import { Partner } from '@prisma/types'
import { clock } from 'src/domains/dispatch-stop/dispatch-stop-time'

// Spec 0029: a restaurant's busy mode, pause and an admin's disable. The rules live here as plain
// values and functions, so the routes stay thin and each rule is tested on its own.

// Tap targets for a busy kitchen (decision 34.2).
export const BUSY_EXTRA_MINUTES = [5, 10, 15, 20, 30]
export const PAUSE_MINUTES = [15, 30, 60, 120]
export const DISABLED_REASON_MAX_LENGTH = 200

type AvailabilityFields = Pick<Partner, 'busyExtraMinutes' | 'pausedUntil' | 'disabledAt' | 'disabledReason'>

// A pause counts only while its end is still ahead; nothing runs when it ends (decision 34.5).
export function pauseInForce(pausedUntil: Date | null, now: Date): Date | null {
  return pausedUntil && pausedUntil.getTime() > now.getTime() ? pausedUntil : null
}

export function disabledSentence(reason: string | null): string {
  return `The co-op has disabled this restaurant: ${reason ?? 'no reason given'}`
}

// Why this restaurant cannot place an order right now, or null when it can (AC-4). Disabled comes first.
export function partnerAvailabilityRefusal(partner: AvailabilityFields, now: Date): string | null {
  if (partner.disabledAt) return disabledSentence(partner.disabledReason)
  const until = pauseInForce(partner.pausedUntil, now)
  return until ? `Ordering is paused until ${clock(until)}.` : null
}

// The six fields of AC-7, the same for a restaurant and for an admin.
export function availabilityOf(partner: AvailabilityFields, now: Date) {
  const notAcceptingReason = partnerAvailabilityRefusal(partner, now)
  return {
    busyExtraMinutes: partner.busyExtraMinutes,
    pausedUntil: pauseInForce(partner.pausedUntil, now),
    disabledAt: partner.disabledAt,
    disabledReason: partner.disabledReason,
    acceptingOrders: notAcceptingReason === null,
    notAcceptingReason,
  }
}
