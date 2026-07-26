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
