// What the admin Offer column needs beyond the delivery row itself (spec 0002, AC-11).
// Both are null unless the delivery is still looking for a rider (ASSIGNING_COURIER).
export interface DeliveryOfferView {
  // "First Last" of the rider holding the open offer; null when nobody is offered.
  matchedCourierName: string | null
  // When the current wait for a free rider began; null while an offer is open.
  waitingForCourierSince: Date | null
}
