import { GeoPosition } from 'src/shared-types/index'

export interface ICourierFindNearestArgs {
  location: GeoPosition
  excludeCourierIds?: string[]
  maxDistanceInKM?: number | null
  // Spec 0043 (AC-5): the delivery's box units; riders without room for them are left out.
  boxUnits?: number
  // Spec 0046 (AC-4, row 10 review): the delivery being offered. A rider who holds another leg of the same
  // order is left out, so the matcher never keeps choosing a rider the claim would refuse.
  siblingOfDeliveryId?: string
}
