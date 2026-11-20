import { BoxSize, EnumDeliveryStatus } from '@prisma/types'

// Spec 0043 (row 9): the box model. A rider's box is 100 units, always (AGENTS.md locks capacity as
// boxUnits out of 100, never volume or dimensions). Each delivery takes the units its size maps to.
export const RIDER_BOX_UNITS = 100

// The co-op's mapping from a size to box units, read from the four settings.
export type BoxUnitsBySize = { boxUnitsSmall: number; boxUnitsMedium: number; boxUnitsLarge: number }

// The box units a size takes under the given settings.
export function boxUnitsFor(size: BoxSize, settings: BoxUnitsBySize): number {
  switch (size) {
    case BoxSize.SMALL:
      return settings.boxUnitsSmall
    case BoxSize.MEDIUM:
      return settings.boxUnitsMedium
    case BoxSize.LARGE:
      return settings.boxUnitsLarge
  }
}

// AC-2: Small may not take more room than Medium, nor Medium more than Large. Returns the sentence
// a representative reads, or null when the order holds. Checked on the values in effect after a
// save, so a save that sends only one of them is checked against the two stored ones.
export function boxUnitsOrderRefusal(settings: BoxUnitsBySize): string | null {
  const { boxUnitsSmall, boxUnitsMedium, boxUnitsLarge } = settings
  if (boxUnitsSmall > boxUnitsMedium) {
    return `Small (${boxUnitsSmall} units) cannot take more room than Medium (${boxUnitsMedium} units).`
  }
  if (boxUnitsMedium > boxUnitsLarge) {
    return `Medium (${boxUnitsMedium} units) cannot take more room than Large (${boxUnitsLarge} units).`
  }
  return null
}

// Cross check 3: the statuses in which a rider holds a delivery's food, or is on the way to get it,
// so its units count against their box. The open offer (ASSIGNING_COURIER with matchedCourierId)
// is counted separately, since that delivery has no courierId yet.
export const BOX_HELD_STATUSES: EnumDeliveryStatus[] = [
  EnumDeliveryStatus.ACCEPTED,
  EnumDeliveryStatus.DISPATCHED,
  EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
  EnumDeliveryStatus.PICKED_UP,
  EnumDeliveryStatus.ON_THE_WAY,
  EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
]

// The words a person reads: "Medium" (riders see "Medium order" on the app's side).
export const BOX_SIZE_WORDS: Record<BoxSize, string> = {
  [BoxSize.SMALL]: 'Small',
  [BoxSize.MEDIUM]: 'Medium',
  [BoxSize.LARGE]: 'Large',
}

// True when adding `deliveryUnits` to what the rider already holds would pass a full box.
export function wouldOverfillBox(heldUnits: number, deliveryUnits: number): boolean {
  return heldUnits + deliveryUnits > RIDER_BOX_UNITS
}
