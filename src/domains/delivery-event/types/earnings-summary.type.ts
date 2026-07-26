// One completed delivery, flattened to just what the earnings report needs.
export interface CourierEarningsRow {
  deliveryId: string
  droppedOffAt: Date // createdAt of the successful DROPPED_OFF event
  totalCompensation: number | null // piece-rate pay in cents; null = never computed
  tips: number // cents
}

// One day of the summary. `date` is 'YYYY-MM-DD' in the requested timezone.
export interface EarningsDaySummary {
  date: string
  deliveryCount: number
  compensation: number
  tips: number
  total: number // compensation + tips
}

// One completed delivery with the extra fields the drill-down screens need.
export interface CourierEarningsDeliveryRow extends CourierEarningsRow {
  dropoffAddress: string | null
  pickupBusinessName: string
}

// One line item in the day drill-down (and the body of the detail endpoint).
export interface EarningsDelivery {
  deliveryId: string
  droppedOffAt: Date
  dropoffAddress: string | null
  pickupBusinessName: string
  compensation: number // totalCompensation ?? 0, integer cents
  tips: number // integer cents
  total: number // compensation + tips
}

