import { EnumDeliveryStatus } from '@prisma/types'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types/stateMachine'
import { PARTNER_ENDED_STATUSES } from 'src/domains/delivery/ready-signals'
import { JobEditedField } from 'src/shared-types/notification'

// Row 152: what a restaurant's edit of its own delivery (`POST partner deliveries/:id`) may change, by the
// delivery's status. request-web offers Edit on every order that has not ended, and restaurant systems call
// the route directly, so the rule lives here, on the server.
//
// - An ended order (delivered, cancelled, failed) is never changed: its record is what happened.
// - Once a rider holds the order (taken, then accepted until the drop off; `riderHoldsOrder`), the drop off point
//   may not move. The rider accepted a ride to that place, and the fee is fixed on the quote, so a move would change
//   the work for the same pay (binding value 4). The restaurant messages dispatch, who can reassign or cancel it.
//   Notes and times may still change, as before. The tip is rider pay, so it stays as it was (see
//   `tipAfterPartnerEdit`).
// - Before a rider holds it, everything may change, within the existing drift check.

export const PARTNER_EDIT_SENTENCES = {
  ended: 'This order has ended, so it can no longer be changed.',
  pointHeld: "A rider is already on this order, so its drop off point can't move. Message dispatch to change it.",
  // Row 161: the order changed under the edit three times running, so the edit stops rather than try forever.
  changed: 'This order just changed. Look again before you save.',
}

// The two fields of an order that say whether a rider holds it.
type HeldOrder = { status: EnumDeliveryStatus; courierId: string | null }

// Whether a rider holds the order. agy's review of row 169: accepting an offer first writes the rider's id
// (`courierId`) while the status is still ASSIGNING_COURIER, and two more checks run before ACCEPTED. An edit that
// reads in between must already see the order as held. Row 167's size check (`boxSizeChangeFor`) reads it the same way.
export function riderHoldsOrder(order: HeldOrder): boolean {
  return order.courierId !== null || DELIVERY_ONGOING_STATUSES.includes(order.status)
}

// The sentence to refuse the edit with, or null when it may go ahead. `pointMoved` is whether this edit
// moves the drop off point.
export function partnerEditRefusal(order: HeldOrder, pointMoved: boolean): string | null {
  // The ended set the restaurant's ready signals use (review of row 152: one list, not a copy).
  if (PARTNER_ENDED_STATUSES.includes(order.status)) return PARTNER_EDIT_SENTENCES.ended
  if (pointMoved && riderHoldsOrder(order)) return PARTNER_EDIT_SENTENCES.pointHeld
  return null
}

// Row 178: whether an edit leaves the drop off point out entirely (neither coordinate sent), so it does not move the
// point. The edit's input check (one coordinate alone answers 400) and the service read this same rule.
export function pointLeftOut(input: { dropoffLatitude?: number; dropoffLongitude?: number }): boolean {
  return input.dropoffLatitude === undefined && input.dropoffLongitude === undefined
}

// Row 171: the highest tip either partner route accepts, in cents. It is the tips column's own limit (a Postgres
// integer), not a pay rule: a bigger number would fail at the write with a 500 instead of a clear 400.
export const TIP_CENTS_CEILING = 2147483647

// Row 177: the highest order total the create and quote routes accept, in cents. Like the tip's, it is the column's
// own limit (orderTotalValue is a Postgres integer on both tables), so a bigger number answers 400, not a 500.
export const ORDER_TOTAL_CENTS_CEILING = 2147483647

// Review of row 152: the tip is rider pay (spec 0042's earnings count it). So while a rider holds the order the edit
// keeps the tip it had, and only before a rider holds it does the restaurant's value apply (row 160 records that
// change as a TIP_CHANGED event).
// Row 169: an edit that leaves the tip out keeps it, whatever the status. request-web has no tip box and now sends none
// (it used to send 0, which zeroed a tip set through the API before a rider held the order).
export function tipAfterPartnerEdit(order: HeldOrder, currentTips: number, sentTips: number | undefined): number {
  if (sentTips === undefined) return currentTips
  return riderHoldsOrder(order) ? currentTips : sentTips
}

// Row 164: what a landed edit changed that the rider holding the order reads on the job: the notes (pickup or drop
// off) and the times (the pickup and drop off windows). Empty when no rider holds the order, so an edit before then
// tells no rider anything. A field the edit leaves out (`undefined`) is not written, so it is not a change. Empty
// notes and no notes are the same to the rider. Compared with what this edit read: if two edits of the same order
// overlap, the second may put the notes back with no notice (Fable review of row 164, minor 2; rare, accepted).
export function riderVisibleEdits(
  delivery: {
    status: EnumDeliveryStatus
    courierId: string | null
    pickupNotes: string | null
    dropoffNotes: string | null
    pickupReadyAt: Date | null
    pickupDeadlineAt: Date | null
    dropoffReadyAt: Date | null
    dropoffDeadlineAt: Date | null
  },
  input: {
    pickupNotes?: string | null
    dropoffNotes?: string | null
    pickupReadyAt?: Date | string | null
    pickupDeadlineAt?: Date | string | null
    dropoffReadyAt?: Date | string | null
    dropoffDeadlineAt?: Date | string | null
  }
): JobEditedField[] {
  // Both signals, unlike `riderHoldsOrder`: in an accept's claim window the rider has no job on the phone yet, and the
  // job they load after ACCEPTED already shows the edit, so there is nothing to tell them (Fable review of 169.2).
  if (!delivery.courierId || !DELIVERY_ONGOING_STATUSES.includes(delivery.status)) return []
  const noteChanged = (sent: string | null | undefined, held: string | null) =>
    sent !== undefined && (sent ?? '') !== (held ?? '')
  // A time may arrive as a Date or as ISO text; compared as milliseconds, so the same moment is no change.
  const timeOf = (at: Date | string | null) => (at === null ? null : new Date(at).getTime())
  const timeChanged = (sent: Date | string | null | undefined, held: Date | null) =>
    sent !== undefined && timeOf(sent) !== timeOf(held)
  const changed: JobEditedField[] = []
  if (noteChanged(input.pickupNotes, delivery.pickupNotes) || noteChanged(input.dropoffNotes, delivery.dropoffNotes)) {
    changed.push('NOTES')
  }
  if (
    timeChanged(input.pickupReadyAt, delivery.pickupReadyAt) ||
    timeChanged(input.pickupDeadlineAt, delivery.pickupDeadlineAt) ||
    timeChanged(input.dropoffReadyAt, delivery.dropoffReadyAt) ||
    timeChanged(input.dropoffDeadlineAt, delivery.dropoffDeadlineAt)
  ) {
    changed.push('TIMES')
  }
  return changed
}
