import { EnumCourierCompensationReason, CourierCompensation } from '@prisma/types'
import { CourierCompensationRow, CourierCompensationDeliveryRow } from '../types/earnings-summary.type'

export interface ICourierCompensationCreateInput {
  amount: number
  currencyCode: string
  reason: EnumCourierCompensationReason
  policy: string
  message?: string
  courierId: string
  deliveryId: string
}

export interface ICourierCompensationRepository {
  create(input: ICourierCompensationCreateInput): Promise<CourierCompensation>
  deleteById(id: string): Promise<void>
  findRowsForCourierEarnings(courierId: string, from: Date, to: Date): Promise<CourierCompensationRow[]>
  findDetailedRowsForCourierDay(courierId: string, from: Date, to: Date): Promise<CourierCompensationDeliveryRow[]>
  findDetailedRowsForCourierDelivery(courierId: string, deliveryId: string): Promise<CourierCompensationDeliveryRow[]>
}
