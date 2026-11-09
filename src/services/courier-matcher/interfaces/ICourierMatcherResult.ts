export interface ICourierMatcherResult {
  courierId: string
  distance: number
  // Road time to the pickup in seconds, set by the nearest matcher when offers are timed (spec 0031).
  travelSeconds?: number | null
}
