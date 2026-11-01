import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import {
  EnumCancelledBy,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumFoodOutcome,
} from '@prisma/types'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types'
import { DeliveryNotFoundException } from 'src/errors'
import { CancelledJobCourierDto } from './dtos/cancelled-job.courier.dto'
import { FoodOutcomeCourierInput } from './queries/food-outcome.courier.input'

// The rider had the food when the job was cancelled: it goes back, and the outcome is asked for.
const PICKED_UP_STATUSES: EnumDeliveryStatus[] = [
  EnumDeliveryStatus.PICKED_UP,
  EnumDeliveryStatus.ON_THE_WAY,
  EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
]
const ONE_DAY_MS = 24 * 60 * 60 * 1000

// Spec 0015: what a rider sees and does after a job they held was cancelled.
@Injectable()
export class CancelledJobsCourierService {
  private readonly logger = new Logger(CancelledJobsCourierService.name)

  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly deliveryEventService: DeliveryEventService
  ) {}

  // This rider's jobs cancelled in the last 24 hours after they accepted them (AC-7, AC-12).
  async getMyCancelledJobs(courierId: string, now: Date = new Date()): Promise<CancelledJobCourierDto[]> {
    const rows = await this.deliveryRepository.findCancelledJobsForCourier(
      courierId,
      new Date(now.getTime() - ONE_DAY_MS),
      DELIVERY_ONGOING_STATUSES
    )
    return rows.map((row) => this.toDto(row))
  }

  // Records what happened to the food, once, by the rider who held the job (AC-8). The column is
  // written first, conditionally (only while no outcome exists), so two taps or two phones cannot
  // both record one; then the event.
  async recordFoodOutcome(
    deliveryId: string,
    courierId: string,
    input: FoodOutcomeCourierInput
  ): Promise<CancelledJobCourierDto> {
    const note = input.note?.trim() ?? ''
    if (input.outcome === EnumFoodOutcome.NOT_RETURNED && note === '') {
      throw new BadRequestException('Say what happened to the food when it was not returned.')
    }

    const delivery = await this.deliveryRepository.findById(deliveryId)
    if (!delivery || delivery.courierId !== courierId) {
      throw new DeliveryNotFoundException('Delivery not found')
    }
    if (!delivery.cancelledAt) {
      throw new ConflictException('This job is not cancelled.')
    }
    if (!delivery.cancelledFromStatus || !PICKED_UP_STATUSES.includes(delivery.cancelledFromStatus)) {
      throw new ConflictException('Nothing to return: this job was cancelled before pickup.')
    }

    const written = await this.deliveryRepository.updateIfMatches(
      deliveryId,
      { courierId, foodOutcome: null },
      { foodOutcome: input.outcome, foodOutcomeAt: new Date() }
    )
    if (!written) {
      throw new ConflictException('The food outcome is already recorded.')
    }

    try {
      if (input.outcome === EnumFoodOutcome.RETURNED) {
        await this.deliveryEventService.recordCancellationEvent(
          {
            deliveryId,
            type: EnumDeliveryEventType.FOOD_RETURNED,
            actor: EnumEventActor.COURIER,
            source: EnumDeliveryEventSource.OPENCOURIER,
            courierId,
            message: note === '' ? 'Food returned to the restaurant' : note,
          },
          delivery.status
        )
      } else {
        await this.deliveryEventService.recordCancellationEvent(
          {
            deliveryId,
            type: EnumDeliveryEventType.FOOD_NOT_RETURNED,
            actor: EnumEventActor.COURIER,
            source: EnumDeliveryEventSource.OPENCOURIER,
            courierId,
            message: note,
          },
          delivery.status
        )
      }
    } catch (error) {
      // The outcome is saved on the delivery; only its event is missing. Ids only: the note is the
      // rider's own words.
      this.logger.error(`FOOD_OUTCOME_EVENT_FAILED {"deliveryId":"${deliveryId}","courierId":"${courierId}"}: ${error}`)
    }

    const [row] = (await this.getMyCancelledJobs(courierId)).filter((job) => job.id === deliveryId)
    if (!row) {
      // Cancelled over 24 hours ago: the outcome is saved, the card is gone anyway.
      throw new DeliveryNotFoundException('Delivery not found')
    }
    return row
  }

  private toDto(row: Awaited<ReturnType<DeliveryRepository['findCancelledJobsForCourier']>>[number]) {
    const location = row.pickupLocation
    // `||`, not `??`: a stored formattedAddress can be an empty text, which must fall back too.
    const address =
      location?.formattedAddress || [location?.street, location?.city, location?.state].filter(Boolean).join(', ')
    return new CancelledJobCourierDto({
      id: row.id,
      orderReference: row.orderReference,
      pickupName: row.pickupName,
      pickupBusinessName: row.pickupBusinessName,
      pickupAddress: address,
      pickupPhoneNumber: row.pickupPhoneNumber,
      cancelledBy: row.cancelledBy ?? EnumCancelledBy.COOP,
      // The query only returns rows with cancelledAt set.
      cancelledAt: row.cancelledAt as Date,
      pickedUp: row.cancelledFromStatus !== null && PICKED_UP_STATUSES.includes(row.cancelledFromStatus),
      payAmount: row.courierCompensations[0]?.amount ?? null,
      currencyCode: row.currencyCode,
      foodOutcome: row.foodOutcome,
    })
  }
}
