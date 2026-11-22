import { SplitRequestRepository } from 'src/persistence/repositories/split-request.repository'
import { SPLIT_SENTENCES } from 'src/domains/split/split'
import { ConflictException, HttpStatus, Injectable } from '@nestjs/common'
import { refusalBody } from 'src/localization/coded-sentence'
import { EnumDeliveryStatus } from '@prisma/types'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryNotFoundException } from 'src/errors'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { waitLeaveFrom } from 'src/domains/delivery/wait-pay'

export const NOT_WAITING_MESSAGE = 'You can only leave while you are waiting at the restaurant.'
export const ORDER_CHANGED_MESSAGE = 'This order changed. Check your jobs.'

export function tooSoonMessage(limitMinutes: number): string {
  return `You can leave ${limitMinutes} ${limitMinutes === 1 ? 'minute' : 'minutes'} after the promised time, or after you arrived if that was later.`
}

// Spec 0033 (AC-6): a rider leaves a restaurant that kept them waiting past the co-op's limit. The
// checks come in the spec's order: is it theirs, are they waiting at the restaurant, has the time come.
@Injectable()
export class LeaveWaitCourierService {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly configDomainService: ConfigDomainService,
    private readonly deliveryEventService: DeliveryEventService,
    // Spec 0047: optional for the tests that build this service by hand; Nest always injects it.
    private readonly splitRequestRepository?: SplitRequestRepository
  ) {}

  async leave(deliveryId: string, courierId: string, tapAgeMs?: number): Promise<{ status: EnumDeliveryStatus }> {
    const delivery = await this.deliveryRepository.findById(deliveryId)
    if (!delivery || delivery.courierId !== courierId) {
      throw new DeliveryNotFoundException('Delivery not found')
    }
    if (delivery.status !== EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION) {
      throw new ConflictException(NOT_WAITING_MESSAGE)
    }
    // Spec 0047 (cross check 6): an open split request has its own leave, after its own limit.
    if (await this.splitRequestRepository?.findOpenForDelivery(deliveryId)) {
      throw new ConflictException(SPLIT_SENTENCES.leaveWaitBlocked)
    }

    // The tap time, when the phone held the request back for signal (spec 0009).
    const occurredAt =
      tapAgeMs === undefined
        ? new Date()
        : await this.deliveryEventService.occurredAtForCourierTap(delivery, { receivedAt: new Date(), tapAgeMs })

    const limitMinutes = await this.configDomainService.instanceConfig.getWaitLimitMinutes()
    // From the first promise, or the rider's arrival if that was later (decision 23.15).
    if (
      !delivery.promisedReadyAt ||
      !delivery.arrivedAtPickupAt ||
      occurredAt < waitLeaveFrom(delivery.promisedReadyAt, delivery.arrivedAtPickupAt, limitMinutes)
    ) {
      const tooSoon = { code: 'LEAVE_WAIT_TOO_SOON', params: { minutes: limitMinutes }, message: tooSoonMessage(limitMinutes) }
      throw new ConflictException(refusalBody(HttpStatus.CONFLICT, tooSoon))
    }

    const left = await this.deliveryEventService.leaveWait(delivery, courierId, occurredAt)
    if (!left) {
      throw new ConflictException(ORDER_CHANGED_MESSAGE)
    }
    return { status: EnumDeliveryStatus.ASSIGNING_COURIER }
  }
}
