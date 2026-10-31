import { IDeliveryEventCreateInput } from './IDeliveryEventCreateInput'
import { DeliveryEventEntity } from '../entities/delivery-event.entity'
import { CourierEarningsRow, CourierEarningsDeliveryRow } from '../types/earnings-summary.type'

export interface IDeliveryEventRepository {
  create(data: IDeliveryEventCreateInput): Promise<DeliveryEventEntity>
  findManyByDeliveryId(deliveryId: string): Promise<DeliveryEventEntity[]>
  findSuccessfulDropOffRowsForCourier(courierId: string, from: Date, to: Date): Promise<CourierEarningsRow[]>
  findCompletedDeliveryRowsForCourier(courierId: string, from: Date, to: Date): Promise<CourierEarningsDeliveryRow[]>
  findCompletedDeliveryRowForCourierDelivery(courierId: string, deliveryId: string): Promise<CourierEarningsDeliveryRow | null>
  // When the latest successful job step of a delivery happened, or null (spec 0009, AC-7).
  findLatestJobStepOccurredAt(deliveryId: string): Promise<Date | null>
}

