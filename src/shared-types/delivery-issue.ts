import { EnumDeliveryIssueReason } from '@prisma/types'

// The words for a rider's report, the same as adminweb's copy in src/shared-types/delivery-issues.ts.
// The dispatch board builds its row text on the server, so the backend needs them too (spec 0034).
export const DELIVERY_ISSUE_REASON_TO_HUMAN: Record<EnumDeliveryIssueReason, string> = {
  WRONG_ADDRESS: 'Wrong address',
  NO_SIGNAL: 'No internet, GPS or signal',
  ORDER_HANDED: 'Order handed to the customer',
  FOOD_NOT_READY: 'Marked ready but not ready',
  OTHER: 'Other',
}
