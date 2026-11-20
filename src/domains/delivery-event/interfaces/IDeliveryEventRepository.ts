import { IDeliveryEventCreateInput } from './IDeliveryEventCreateInput'
import { DeliveryEventEntity } from '../entities/delivery-event.entity'

export interface IDeliveryEventRepository {
  create(data: IDeliveryEventCreateInput): Promise<DeliveryEventEntity>
  findManyByDeliveryId(deliveryId: string): Promise<DeliveryEventEntity[]>
  // When the latest successful job step of a delivery happened, or null (spec 0009, AC-7).
  findLatestJobStepOccurredAt(deliveryId: string): Promise<Date | null>
}
