import { IDeliveryEventCreateInput } from './IDeliveryEventCreateInput'
import { DeliveryEventEntity } from '../entities/delivery-event.entity'
import { CourierEarningsRow } from '../types/earnings-summary.type'

export interface IDeliveryEventRepository {
  create(data: IDeliveryEventCreateInput): Promise<DeliveryEventEntity>
  findSuccessfulDropOffRowsForCourier(courierId: string, from: Date, to: Date): Promise<CourierEarningsRow[]>
}
