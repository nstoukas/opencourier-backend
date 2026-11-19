import { EnumCourierCompensationReason } from '@prisma/types'
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
    const compRows = await this.courierCompensationRepository.findDetailedRowsForCourierDelivery(courierId, deliveryId)
    const sumOfReason = (reason: EnumCourierCompensationReason): number =>
      compRows.filter((r) => r.reason === reason).reduce((sum, r) => sum + r.amount, 0)
    if (row) {
      const entry = toEarningsDelivery(row)
      // Spec 0033: a delivered order's wait is shown beside its delivery pay, as its own amount. So is a
      // removal (spec 0035): a rider taken off an order can be offered it again and deliver it.
      const waitingPay = sumOfReason(EnumCourierCompensationReason.WAITING)
      const removalPay = sumOfReason(EnumCourierCompensationReason.REMOVAL)
      // Spec 0038 (AC-7): a review correction shows as its own amount too. The drop off itself is
      // still counted once: the correction is a compensation row, never a second drop off.
      const reviewPay = sumOfReason(EnumCourierCompensationReason.REVIEW)
      return {
        ...entry,
        total: entry.total + waitingPay + removalPay + reviewPay,
        ...(waitingPay > 0 ? { waitingPay } : {}),
        ...(removalPay > 0 ? { removalPay } : {}),
        ...(reviewPay > 0 ? { reviewPay } : {}),
      }
    }

    if (compRows.length === 0) return null

    const first = compRows[0]
    if (!first) return null
    const totalAmount = compRows.reduce((sum, r) => sum + r.amount, 0)
    // A cancellation names the line (spec 0015) even if this rider was also reassigned off it once.
    const namingReason = compRows.some((r) => r.reason === EnumCourierCompensationReason.CANCELLATION)
      ? EnumCourierCompensationReason.CANCELLATION
      : first.reason
    // Spec 0035, AC-17: every other kind of pay is its own line, and the main line holds only what is
    // left, so the lines on the screen add up to the total.
    const lineOf = (reason: EnumCourierCompensationReason): number =>
      reason === namingReason ? 0 : sumOfReason(reason)
    const waitingPay = lineOf(EnumCourierCompensationReason.WAITING)
    const removalPay = lineOf(EnumCourierCompensationReason.REMOVAL)
    const returnTripPay = lineOf(EnumCourierCompensationReason.RETURN_TRIP)
    const reviewPay = lineOf(EnumCourierCompensationReason.REVIEW)
    const entry = compensationToEarningsDelivery({
      deliveryId: first.deliveryId,
      amount: totalAmount - waitingPay - removalPay - returnTripPay - reviewPay,
      reason: namingReason,
      createdAt: first.createdAt,
      pickupBusinessName: first.pickupBusinessName,
      dropoffLocation: first.dropoffLocation,
    })
    return {
      ...entry,
      total: totalAmount,
      ...(waitingPay > 0 ? { waitingPay } : {}),
      ...(removalPay > 0 ? { removalPay } : {}),
      ...(returnTripPay > 0 ? { returnTripPay } : {}),
      ...(reviewPay > 0 ? { reviewPay } : {}),
    }
  }
}

