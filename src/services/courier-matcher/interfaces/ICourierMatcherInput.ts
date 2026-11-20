import { GeoPosition } from 'src/shared-types/index'

export interface ICourierMatcherInput {
  deliveryId?: string
  pickupLocation: GeoPosition
  dropoffLocation: GeoPosition
  rejectedCourierIds: string[]
  // Spec 0043 (AC-5): the delivery's box units; the matcher offers it only to a rider with room.
  boxUnits?: number
}
