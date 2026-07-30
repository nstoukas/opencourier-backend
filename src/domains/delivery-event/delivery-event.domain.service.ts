import { Injectable, Logger } from '@nestjs/common'
import { dayjs } from 'src/core/utils/time'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'
import { DeliveryEventEntity } from './entities/delivery-event.entity'
import { EarningsDaySummary, EarningsDelivery } from './types/earnings-summary.type'
import {
  summarizeEarningsByDay,
  listEarningsDeliveriesForDay,
  toEarningsDelivery,
  compensationToEarningsDelivery,
} from './utils/earnings-summary.util'

@Injectable()
export class DeliveryEventDomainService {
  private readonly logger = new Logger(DeliveryEventDomainService.name)
  constructor(
    private deliveryEventRepository: DeliveryEventRepository,
    private courierCompensationRepository: CourierCompensationRepository
  ) {}

  async getEventHistoryForDelivery(deliveryId: string): Promise<DeliveryEventEntity[]> {
    return this.deliveryEventRepository.findManyByDeliveryId(deliveryId)
  }

  async getEarningsSummaryForCourier(
    courierId: string,
    from: Date,
    to: Date,
    timezone: string
  ): Promise<EarningsDaySummary[]> {
    const rows = await this.deliveryEventRepository.findSuccessfulDropOffRowsForCourier(courierId, from, to)
    const compRows = await this.courierCompensationRepository.findRowsForCourierEarnings(courierId, from, to)
    return summarizeEarningsByDay(rows, timezone, compRows)
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
    const compRows = await this.courierCompensationRepository.findDetailedRowsForCourierDay(courierId, from, to)
    // Repository fetches events within the day window; listEarningsDeliveriesForDay enforces exact timezone day attribution and deduplication.
    return listEarningsDeliveriesForDay(rows, date, timezone, compRows)
  }

  async getEarningsDeliveryDetailForCourier(
    courierId: string,
    deliveryId: string
  ): Promise<EarningsDelivery | null> {
    const row = await this.deliveryEventRepository.findCompletedDeliveryRowForCourierDelivery(courierId, deliveryId)
    if (row) return toEarningsDelivery(row)

    const compRows = await this.courierCompensationRepository.findDetailedRowsForCourierDelivery(courierId, deliveryId)
    if (compRows.length === 0) return null

    const first = compRows[0]
    if (!first) return null
    const totalAmount = compRows.reduce((sum, r) => sum + r.amount, 0)
    return compensationToEarningsDelivery({
      deliveryId: first.deliveryId,
      amount: totalAmount,
      createdAt: first.createdAt,
      pickupBusinessName: first.pickupBusinessName,
      dropoffLocation: first.dropoffLocation,
    })
  }
}

