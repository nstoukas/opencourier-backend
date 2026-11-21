import { OfferReasonInput } from 'src/domains/matching/offer-reason'

export interface ICourierMatcherResult {
  courierId: string
  distance: number
  // Road time to the pickup in seconds, set by the nearest matcher when offers are timed (spec 0031).
  travelSeconds?: number | null
  // Spec 0044 (AC-6): why this rider, saved with the OFFERED event. Every matcher sets it.
  reason?: OfferReasonInput
}
