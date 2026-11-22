import { Partner } from '@prisma/types'
import { clock } from 'src/domains/dispatch-stop/dispatch-stop-time'
import { CodedSentence } from 'src/localization/coded-sentence'

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

// The disabled sentence as a code with values (spec 0054, AC-6): the admin's reason is their own words and
// travels as written.
export function disabledCodedSentence(reason: string | null): CodedSentence {
  const message = disabledSentence(reason)
  return reason === null
    ? { code: 'PARTNER_DISABLED_NO_REASON', params: {}, message }
    : { code: 'PARTNER_DISABLED', params: { reason }, message }
}

// Why this restaurant cannot place an order right now, or null when it can (AC-4). Disabled comes first.
// As a code with values plus the English sentence (spec 0054, AC-6), so each app says it in its language.
export function partnerAvailabilitySentence(partner: AvailabilityFields, now: Date): CodedSentence | null {
  if (partner.disabledAt) return disabledCodedSentence(partner.disabledReason)
  const until = pauseInForce(partner.pausedUntil, now)
  return until
    ? { code: 'PARTNER_PAUSED', params: { until: until.toISOString() }, message: `Ordering is paused until ${clock(until)}.` }
    : null
}

// The same, as the English sentence only.
export function partnerAvailabilityRefusal(partner: AvailabilityFields, now: Date): string | null {
  return partnerAvailabilitySentence(partner, now)?.message ?? null
}

// The six fields of AC-7 (and the sentence's code, spec 0054), the same for a restaurant and for an admin.
export function availabilityOf(partner: AvailabilityFields, now: Date) {
  const refusal = partnerAvailabilitySentence(partner, now)
  const notAcceptingReason = refusal?.message ?? null
  return {
    busyExtraMinutes: partner.busyExtraMinutes,
    pausedUntil: pauseInForce(partner.pausedUntil, now),
    disabledAt: partner.disabledAt,
    disabledReason: partner.disabledReason,
    acceptingOrders: notAcceptingReason === null,
    notAcceptingReason,
    // Spec 0054 (AC-6): the same sentence by code (a key of `server.error`) with its values.
    notAcceptingCode: refusal?.code ?? null,
    notAcceptingParams: refusal?.params ?? null,
  }
}
