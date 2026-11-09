import { EnumCourierCompensationReason } from '@prisma/types'

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

export interface CourierCompensationRow {
  deliveryId: string
  amount: number
  // REASSIGNMENT or CANCELLATION (spec 0015); left out (older callers, fixtures) it reads as REASSIGNMENT.
  reason?: EnumCourierCompensationReason
  createdAt: Date
}

export interface CourierCompensationDeliveryRow extends CourierCompensationRow {
  pickupBusinessName: string | null
  dropoffLocation: {
    formattedAddress: string | null
    street: string | null
    city: string | null
    state: string | null
  } | null
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
  // A pay that is not a drop off: a reassigned rider's payout, a cancelled job's (spec 0015), or a
  // wait at the restaurant (spec 0033).
  kind?: 'REASSIGNMENT_COMPENSATION' | 'CANCELLATION_COMPENSATION' | 'WAITING'
  // Spec 0033, on the detail of a delivered order only: what its wait paid, already inside `total`.
  waitingPay?: number
}

