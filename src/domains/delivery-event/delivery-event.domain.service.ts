import { Injectable, Logger } from '@nestjs/common'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { DeliveryEventEntity } from './entities/delivery-event.entity'

@Injectable()
export class DeliveryEventDomainService {
  private readonly logger = new Logger(DeliveryEventDomainService.name)
  constructor(private deliveryEventRepository: DeliveryEventRepository) {}

  async getEventHistoryForDelivery(deliveryId: string): Promise<DeliveryEventEntity[]> {
    return this.deliveryEventRepository.findManyByDeliveryId(deliveryId)
  }
}
