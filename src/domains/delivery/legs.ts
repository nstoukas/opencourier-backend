import { EnumDeliveryStatus } from '@prisma/types'

// Spec 0046 (row 10): multi leg orders. An order too big for one box is sent as N ordinary deliveries
// ("legs") sharing the restaurant's `orderReference`, each labelled "leg 1 of 2". The storefront works
// the legs out (Path A); the backend only checks that the labels are consistent and that no rider holds
// two legs of one order at the same time. Pure rules here; the database reads live in the callers.

export const MIN_LEG_COUNT = 2
export const MAX_LEG_COUNT = 4

// The two labels as they arrive: a JSON null counts as not sent.
export type LegLabels = { legNumber?: number | null; legCount?: number | null }

// AC-1: both absent (a single delivery), or both set with 1 <= legNumber <= legCount and
// 2 <= legCount <= 4. Returns the sentence for a 400, or null when the labels are fine.
export function legLabelsProblem({ legNumber, legCount }: LegLabels): string | null {
  const hasNumber = legNumber !== undefined && legNumber !== null
  const hasCount = legCount !== undefined && legCount !== null
  if (!hasNumber && !hasCount) return null
  if (!hasNumber || !hasCount) return 'legNumber and legCount go together: send both, or neither for a single delivery.'
  if (!Number.isInteger(legNumber) || !Number.isInteger(legCount)) return 'legNumber and legCount must be whole numbers.'
  if (legCount < MIN_LEG_COUNT || legCount > MAX_LEG_COUNT) {
    return `legCount must be from ${MIN_LEG_COUNT} to ${MAX_LEG_COUNT}.`
  }
  if (legNumber < 1 || legNumber > legCount) return `legNumber must be from 1 to legCount (${legCount}).`
  return null
}

// One leg of an order as the admin page lists it (AC-6): read by DeliveryRepository.findOrderLegs.
export type OrderLeg = {
  id: string
  legNumber: number
  legCount: number
  status: EnumDeliveryStatus
  courierId: string | null
  courierName: string | null
}

// A sibling as the checks need it: another delivery of the same restaurant with the same reference.
export type SiblingLeg = { legNumber: number | null; legCount: number | null }

// Key invariants and cross check 2: a new leg must agree with the legs already sent for its order.
// Returns the sentence for a 409, or null. The unique index catches two creates racing for one number.
export function siblingConflict(newLeg: { legNumber: number; legCount: number }, siblings: SiblingLeg[]): string | null {
  const legs = siblings.filter((sibling) => sibling.legCount !== null)
  const otherCount = legs.find((sibling) => sibling.legCount !== newLeg.legCount)
  if (otherCount) {
    return `This order was sent as ${otherCount.legCount} legs; leg ${newLeg.legNumber} of ${newLeg.legCount} does not match.`
  }
  if (legs.some((sibling) => sibling.legNumber === newLeg.legNumber)) {
    return LEG_TAKEN_SENTENCE(newLeg.legNumber, newLeg.legCount)
  }
  return null
}

export const LEG_TAKEN_SENTENCE = (legNumber: number, legCount: number) =>
  `Leg ${legNumber} of ${legCount} of this order was already sent.`

// Cross check 2: the labels and the reference that ties the legs together cannot change on a leg.
export const LEG_LABELS_LOCKED_SENTENCE =
  'This delivery is one leg of an order: its order reference and leg numbers cannot change.'

// AC-4 and cross check 3: an admin assignment that would give one rider two legs of the same order at once.
export const SIBLING_LEG_HELD_SENTENCE =
  'This rider already carries another leg of the same order. Each leg goes to a different rider.'

// AC-7: "Leg 1 of 2" for the offer card payload, as strings (push data values are strings). A single
// delivery gets '' for both: the payload sends every key, and '' is its "not known" (decision 10.2).
export function legPayload(delivery: SiblingLeg): { legNumber: string; legCount: string } {
  if (delivery.legNumber === null || delivery.legCount === null) return { legNumber: '', legCount: '' }
  return { legNumber: String(delivery.legNumber), legCount: String(delivery.legCount) }
}

// Cross check 5: the leg numbers of an order that were never created (siblings include the leg itself).
export function missingLegNumbers(legCount: number | null, siblings: SiblingLeg[]): number[] {
  if (legCount === null) return []
  const present = new Set(siblings.map((sibling) => sibling.legNumber))
  const missing: number[] = []
  for (let number = 1; number <= legCount; number++) {
    if (!present.has(number)) missing.push(number)
  }
  return missing
}
