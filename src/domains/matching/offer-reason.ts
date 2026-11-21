import { EnumCourierMatcherType } from 'src/shared-types/courier-matching'

// Spec 0044 (AC-6, cross check 10): why an offer went to its rider, as numbers. Every matcher returns
// one with its pick, and the two admin paths write one; it is saved beside the OFFERED event in an
// OfferReason row. Specs 0045 (the rider's own why) and 0049 (shift priority) read these shapes, so a
// key is only ever added, never renamed.

// The strategy names stored: the matcher types, plus ADMIN for a hand offer or a reassign.
export const OFFER_REASON_ADMIN = 'ADMIN'
export type OfferReasonStrategy = EnumCourierMatcherType | typeof OFFER_REASON_ADMIN

export interface OfferReasonInput {
  strategy: OfferReasonStrategy
  // Fairness only: the weights that applied, { roadTime, earnings, waiting, shift? }.
  weights?: Record<string, number> | null
  // The chosen rider's values. Fairness: raw values, `scaled` and `score`; Nearest: straightMetres and
  // roadSeconds; Seniority: memberSince; admin: adminUserId; Static: {}.
  values: Record<string, unknown>
  score?: number | null
  // How many riders were scored, and how many passed every filter.
  candidateCount?: number
  ridersInRange?: number
  // Fairness only, admin only: every scored rider's raw values, scaled values and score.
  candidates?: Record<string, unknown>[] | null
}

// The reason an admin's offer carries (a hand offer, or a reassign to a named rider).
export function adminOfferReason(adminUserId: string | null | undefined): OfferReasonInput {
  return { strategy: OFFER_REASON_ADMIN, values: { adminUserId: adminUserId ?? null } }
}
