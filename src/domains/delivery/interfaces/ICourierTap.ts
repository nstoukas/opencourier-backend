// A rider's job step as the server received it (spec 0009): when it arrived, and how long before
// sending the rider tapped it (0 for a step sent at once). The domain turns it into the event's
// occurredAt through DeliveryEventService.occurredAtForCourierTap.
export interface ICourierTap {
  receivedAt: Date
  tapAgeMs: number
}
