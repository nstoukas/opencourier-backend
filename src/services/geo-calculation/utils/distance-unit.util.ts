import { EnumDistanceUnit } from '@prisma/types'

// A plain exported function (no NestJS decorator) so it can be unit-tested on its own.
// Both distance engines must return the unit named by Config.distanceUnit — a quote's
// number is meaningless without agreeing what it counts.
export function convertKilometresToDistanceUnit(kilometres: number, distanceUnit: EnumDistanceUnit): number {
  if (distanceUnit === EnumDistanceUnit.MILES) {
    return kilometres * 0.621371
  }

  return Math.round(kilometres * 1000) / 1000
}
