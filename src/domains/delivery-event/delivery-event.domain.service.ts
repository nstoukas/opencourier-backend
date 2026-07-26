import { Injectable, Logger } from '@nestjs/common'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { EarningsDaySummary } from './types/earnings-summary.type'
import { summarizeEarningsByDay } from './utils/earnings-summary.util'

@Injectable()
export class DeliveryEventDomainService {
  private readonly logger = new Logger(DeliveryEventDomainService.name)
  constructor(private deliveryEventRepository: DeliveryEventRepository) {}

  async getEarningsSummaryForCourier(
    courierId: string,
    from: Date,
    to: Date,
    timezone: string
  ): Promise<EarningsDaySummary[]> {
    const rows = await this.deliveryEventRepository.findSuccessfulDropOffRowsForCourier(courierId, from, to)
    return summarizeEarningsByDay(rows, timezone)
  }
}
