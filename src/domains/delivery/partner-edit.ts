import { EnumDeliveryStatus } from '@prisma/types'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types/stateMachine'
import { PARTNER_ENDED_STATUSES } from 'src/domains/delivery/ready-signals'

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
}

// The sentence to refuse the edit with, or null when it may go ahead. `pointMoved` is whether this edit
// moves the drop off point.
export function partnerEditRefusal(status: EnumDeliveryStatus, pointMoved: boolean): string | null {
  // The ended set the restaurant's ready signals use (review of row 152: one list, not a copy).
  if (PARTNER_ENDED_STATUSES.includes(status)) return PARTNER_EDIT_SENTENCES.ended
  if (pointMoved && DELIVERY_ONGOING_STATUSES.includes(status)) return PARTNER_EDIT_SENTENCES.pointHeld
  return null
}

// Review of row 152: the tip is rider pay (spec 0042's earnings count it), and an edit writes no DeliveryEvent. So
// while a rider holds the order the edit keeps the tip it had, and only before a rider holds it does the restaurant's
// value apply. request-web always sends 0 for it (it has no tip field), which this also stops from zeroing a tip
// set through the API on a held order.
export function tipAfterPartnerEdit(status: EnumDeliveryStatus, currentTips: number, sentTips: number): number {
  return DELIVERY_ONGOING_STATUSES.includes(status) ? currentTips : sentTips
}
