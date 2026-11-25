import { EnumDeliveryStatus } from '@prisma/types'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types/stateMachine'
import { PARTNER_ENDED_STATUSES } from 'src/domains/delivery/ready-signals'
import { JobEditedField } from 'src/shared-types/notification'

// Row 152: what a restaurant's edit of its own delivery (`POST partner deliveries/:id`) may change, by the
// delivery's status. request-web offers Edit on every order that has not ended, and restaurant systems call
// the route directly, so the rule lives here, on the server.
//
// - An ended order (delivered, cancelled, failed) is never changed: its record is what happened.
// - Once a rider holds the order (accepted until the drop off), the drop off point may not move. The rider
//   accepted a ride to that place, and the fee is fixed on the quote, so a move would change the work for
//   the same pay (binding value 4). The restaurant messages dispatch, who can reassign or cancel it.
//   Notes and times may still change, as before. The tip is rider pay, so it stays as it was (see
//   `tipAfterPartnerEdit`).
// - Before a rider holds it, everything may change, within the existing drift check.

export const PARTNER_EDIT_SENTENCES = {
  ended: 'This order has ended, so it can no longer be changed.',
  pointHeld: "A rider is already on this order, so its drop off point can't move. Message dispatch to change it.",
  // Row 161: the order changed under the edit three times running, so the edit stops rather than try forever.
  changed: 'This order just changed. Look again before you save.',
}

// The sentence to refuse the edit with, or null when it may go ahead. `pointMoved` is whether this edit
// moves the drop off point.
export function partnerEditRefusal(status: EnumDeliveryStatus, pointMoved: boolean): string | null {
  // The ended set the restaurant's ready signals use (review of row 152: one list, not a copy).
  if (PARTNER_ENDED_STATUSES.includes(status)) return PARTNER_EDIT_SENTENCES.ended
  if (pointMoved && DELIVERY_ONGOING_STATUSES.includes(status)) return PARTNER_EDIT_SENTENCES.pointHeld
  return null
}

// Review of row 152: the tip is rider pay (spec 0042's earnings count it). So while a rider holds the order the edit
// keeps the tip it had, and only before a rider holds it does the restaurant's value apply (row 160 records that
// change as a TIP_CHANGED event). request-web always sends 0 for it (it has no tip field), which this also stops from zeroing a tip
// set through the API on a held order.
export function tipAfterPartnerEdit(status: EnumDeliveryStatus, currentTips: number, sentTips: number): number {
  return DELIVERY_ONGOING_STATUSES.includes(status) ? currentTips : sentTips
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
