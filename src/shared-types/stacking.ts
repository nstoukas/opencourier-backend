// Spec 0048 (AC-1): when two orders may go to one rider at once. The co-op chooses; the default is the
// worker centred one (only when no free rider is a good fit). Riders read it in How offers and pay work.
// A TypeScript `enum` gives each choice a name the compiler checks; its values are the stored text.
export enum EnumTwoOrderPolicy {
  // A stack is formed only when the second order had no free rider at its last try (AC-3).
  SHORTAGE_ONLY = 'SHORTAGE_ONLY',
  // A stack is considered at every matching, whenever two orders fit together.
  WHENEVER_FITS = 'WHENEVER_FITS',
}

// Spec 0048 (AC-1, AC-6, row 81): when a rider already on a job may be offered one more order (an add on).
// The co-op chooses among all three (operator's answer, architect batch 2026-11-20); the default is the
// recommended one, before the rider picks up the first order.
export enum EnumAddOnMoment {
  // The current job is accepted but its food is not picked up yet.
  BEFORE_PICKUP = 'BEFORE_PICKUP',
  // Any time before the current job's drop off, food in the box included (cross check 2: calm offers then).
  BEFORE_DROPOFF = 'BEFORE_DROPOFF',
  // Not picked up yet, and the new order comes from the same restaurant and pickup point.
  SAME_RESTAURANT = 'SAME_RESTAURANT',
}
