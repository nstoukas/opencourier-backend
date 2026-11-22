import { EnumCourierMatcherType } from 'src/shared-types/courier-matching'
import type { StackSequence } from 'src/domains/delivery/stack'

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
  // Spec 0048: SINGLE (left out), STACK for one of two orders offered together, ADD_ON for row 81.
  kind?: OfferReasonKind
}

export type OfferReasonKind = 'SINGLE' | 'STACK' | 'ADD_ON'

// The reason an admin's offer carries (a hand offer, or a reassign to a named rider).
export function adminOfferReason(adminUserId: string | null | undefined): OfferReasonInput {
  return { strategy: OFFER_REASON_ADMIN, values: { adminUserId: adminUserId ?? null } }
}

// Spec 0048 (AC-4): the reason one delivery of a stack carries. The matcher's reason for the rider (scored on
// the first delivery's pickup; with two restaurants, slice 2, the second pickup passed its own distance
// filter), marked STACK, with the other delivery's id, the order
// of the four stops and how much later each customer's food arrives than alone. The rider's own why
// (whyYouFrom) is an allow list, so none of these keys reach a rider until spec 0045's list names them.
// null when the matcher gave no reason (the offer is still made; saveOfferedEvent logs the gap).
export function stackOfferReason(
  base: OfferReasonInput | null | undefined,
  partnerDeliveryId: string,
  sequence: StackSequence
): OfferReasonInput | null {
  if (!base) return null
  return {
    ...base,
    kind: 'STACK',
    values: {
      ...base.values,
      partnerDeliveryId,
      sequence: sequence.stops,
      delaySeconds: sequence.delaySeconds,
      totalSeconds: sequence.totalSeconds,
    },
  }
}
