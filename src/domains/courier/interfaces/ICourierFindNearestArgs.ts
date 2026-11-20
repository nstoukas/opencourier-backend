import { GeoPosition } from 'src/shared-types/index'

export interface ICourierFindNearestArgs {
  location: GeoPosition
  excludeCourierIds?: string[]
  maxDistanceInKM?: number | null
  // Spec 0043 (AC-5): the delivery's box units; riders without room for them are left out.
  boxUnits?: number
}
