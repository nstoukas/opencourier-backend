// Spec 0048 (AC-1): when two orders may go to one rider at once. The co-op chooses; the default is the
// worker centred one (only when no free rider is a good fit). Riders read it in How offers and pay work.
// A TypeScript `enum` gives each choice a name the compiler checks; its values are the stored text.
export enum EnumTwoOrderPolicy {
  // A stack is formed only when the second order had no free rider at its last try (AC-3).
  SHORTAGE_ONLY = 'SHORTAGE_ONLY',
  // A stack is considered at every matching, whenever two orders fit together.
  WHENEVER_FITS = 'WHENEVER_FITS',
}
