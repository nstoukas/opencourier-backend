// Spec 0047 (row 11): split at pickup. A rider at the restaurant finds an order does not fit one box,
// flags it with a proposal ("2 boxes: Large and Small"), and an admin confirms (perhaps changed) or
// refuses. The flagging rider keeps leg 1; every other leg becomes a new delivery paid in full, and the
// restaurant is charged that pay. Pure rules here; the database work is in SplitRequestService.
import { BoxSize } from '@prisma/types'
import { MAX_LEG_COUNT, MIN_LEG_COUNT } from 'src/domains/delivery/legs'

export type SplitLeg = { boxSize: BoxSize }

const SIZES: readonly string[] = [BoxSize.SMALL, BoxSize.MEDIUM, BoxSize.LARGE]

// AC-1, AC-4: 2 to 4 boxes, each a known size. Returns the sentence for a 400, or null.
export function splitLegsProblem(legs: unknown): string | null {
  if (!Array.isArray(legs)) return 'legs must be a list of boxes, each with a boxSize.'
  if (legs.length < MIN_LEG_COUNT || legs.length > MAX_LEG_COUNT) {
    return `A split has ${MIN_LEG_COUNT} to ${MAX_LEG_COUNT} boxes.`
  }
  for (const leg of legs) {
    const size = (leg as { boxSize?: unknown } | null)?.boxSize
    if (typeof size !== 'string' || !SIZES.includes(size)) return 'Each box needs a size: SMALL, MEDIUM or LARGE.'
  }
  return null
}

// The legs as stored: only the size of each, so nothing else a client sent is kept.
export function cleanLegs(legs: SplitLeg[]): SplitLeg[] {
  return legs.map((leg) => ({ boxSize: leg.boxSize }))
}

// "2 boxes: Large and Small", for event messages and the admin queue.
const WORD: Record<BoxSize, string> = { SMALL: 'Small', MEDIUM: 'Medium', LARGE: 'Large' }
export function legsText(legs: SplitLeg[]): string {
  const words = legs.map((leg) => WORD[leg.boxSize])
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words.join('')
  return `${legs.length} boxes: ${list}`
}

// AC-3: whole minutes from the flag to the answer (or leaving), rounded down, never below 0.
export function splitWaitMinutes(flaggedAt: Date, endedAt: Date): number {
  return Math.max(0, Math.floor((endedAt.getTime() - flaggedAt.getTime()) / 60_000))
}

// AC-2, AC-8: when the rider may leave without an answer.
export function splitLeaveFrom(flaggedAt: Date, answerMinutes: number): Date {
  return new Date(flaggedAt.getTime() + answerMinutes * 60_000)
}

// Cross check 8: the numbers the order's legs get after a split. A single delivery becomes leg 1 and
// the new legs 2..N. A delivery that is already a leg keeps its number, and the new legs take the next
// free numbers after the order's highest; every sibling's count becomes the new total. Null when the
// total would pass the limit of 4 legs.
export function legNumbersAfterSplit(
  current: { legNumber: number | null; legCount: number | null },
  siblingNumbers: number[],
  splitInto: number
): { keptNumber: number; newNumbers: number[]; legCount: number } | null {
  if (current.legNumber === null || current.legCount === null) {
    if (splitInto > MAX_LEG_COUNT) return null
    return { keptNumber: 1, newNumbers: Array.from({ length: splitInto - 1 }, (_, i) => i + 2), legCount: splitInto }
  }
  const legCount = current.legCount + splitInto - 1
  if (legCount > MAX_LEG_COUNT) return null
  const highest = Math.max(current.legCount, current.legNumber, ...siblingNumbers)
  return {
    keptNumber: current.legNumber,
    newNumbers: Array.from({ length: splitInto - 1 }, (_, i) => highest + i + 1),
    legCount,
  }
}

export const SPLIT_SENTENCES = {
  notAtPickup: 'You can ask to split an order only at the restaurant, before you pick it up.',
  alreadyOpen: 'This order already has a split request waiting for dispatch.',
  notOpen: 'This split request was already answered or closed.',
  tooSoon: (minutes: number) => `You can leave after ${minutes} minutes without an answer from dispatch.`,
  noOpenRequest: 'This order has no split request waiting.',
  tooManyLegs: `An order has at most ${MAX_LEG_COUNT} legs in all.`,
  pickupBlocked: 'Dispatch is splitting this order. Wait for the answer before you pick it up.',
  leaveWaitBlocked: 'Dispatch is splitting this order. Wait for the answer, or leave once the split limit has passed.',
  deliveryChanged: 'This order changed before the split could be made. Look again.',
}

// AC-5, cross check 8: the reference the order's legs share after a split. A leg keeps its order's. A
// single delivery uses spec 0046's group rule: its quote id, or the restaurant's reference plus `#` and the
// quote id, so it can never collide with another order that happens to share the restaurant's reference.
export function orderReferenceForSplit(reference: string | null, quoteId: string, alreadyLeg: boolean): string {
  if (alreadyLeg && reference) return reference
  const typed = reference?.trim()
  if (!typed || typed === quoteId) return quoteId
  return `${typed}#${quoteId}`
}
