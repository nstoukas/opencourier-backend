import { Injectable, Logger } from '@nestjs/common'
import { dayjs } from 'src/core/utils/time'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { EarningsDaySummary, EarningsDelivery } from './types/earnings-summary.type'
import { summarizeEarningsByDay, listEarningsDeliveriesForDay, toEarningsDelivery } from './utils/earnings-summary.util'

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

  async getEarningsDeliveriesForCourierDay(
    courierId: string,
    date: string,
    timezone: string
  ): Promise<EarningsDelivery[]> {
    const day = dayjs.tz(date, timezone)
    const from = day.startOf('day').toDate()
    const to = day.endOf('day').toDate()
    const rows = await this.deliveryEventRepository.findCompletedDeliveryRowsForCourier(courierId, from, to)
    // Repository fetches events within the day window; listEarningsDeliveriesForDay enforces exact timezone day attribution and deduplication.
    return listEarningsDeliveriesForDay(rows, date, timezone)
  }

  async getEarningsDeliveryDetailForCourier(
    courierId: string,
    deliveryId: string
  ): Promise<EarningsDelivery | null> {
    const row = await this.deliveryEventRepository.findCompletedDeliveryRowForCourierDelivery(courierId, deliveryId)
    return row ? toEarningsDelivery(row) : null
  }
}

