import { ConflictException, Injectable } from '@nestjs/common'
import { EnumDeliveryStatus } from '@prisma/types'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryNotFoundException } from 'src/errors'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { OFFER_EXPIRY_GRACE_SECONDS } from 'src/constants'

// Before the rider reaches the restaurant; after that the food waits for them (decision 71.6).
const HAND_BACK_STATUSES: EnumDeliveryStatus[] = [EnumDeliveryStatus.ACCEPTED, EnumDeliveryStatus.DISPATCHED]

export const AT_RESTAURANT_MESSAGE =
  'You are at the restaurant. Report an issue or call dispatch to give this order back.'
export const ORDER_CHANGED_MESSAGE = 'This order changed. Check your jobs.'

// "The first minute is over", worded for the co-op's setting.
export function windowOverMessage(handBackSeconds: number): string {
  if (handBackSeconds <= 0) {
    return 'Handing back is switched off. Report an issue or call dispatch to give this order back.'
  }
  // Whole minutes are named as minutes (the spec's "names the setting's minutes"), the rest as seconds.
  const minutes = handBackSeconds / 60
  let window: string
  if (handBackSeconds % 60 === 0) {
    window = minutes === 1 ? 'minute is' : `${minutes} minutes are`
  } else {
    window = handBackSeconds === 1 ? 'second is' : `${handBackSeconds} seconds are`
  }
  return `The first ${window} over. Report an issue or call dispatch to give this order back.`
}

// Spec 0020 (AC-5, AC-6): a rider gives back an order they accepted, free, inside the window. The
// checks come in the spec's order: is it theirs, is it before the restaurant, is the window open.
@Injectable()
export class HandBackCourierService {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly configDomainService: ConfigDomainService,
    private readonly deliveryEventService: DeliveryEventService
  ) {}

  async handBack(deliveryId: string, courierId: string): Promise<{ status: EnumDeliveryStatus }> {
    const delivery = await this.deliveryRepository.findById(deliveryId)
    if (!delivery || delivery.courierId !== courierId) {
      throw new DeliveryNotFoundException('Delivery not found')
    }
    if (!HAND_BACK_STATUSES.includes(delivery.status)) {
      throw new ConflictException(AT_RESTAURANT_MESSAGE)
    }
    // The window stored at accept, plus the offer grace so a request sent in the last second
    // still counts (AC-5). No window stored means the hand back was off at accept.
    const now = Date.now()
    const until = delivery.handBackUntil?.getTime()
    if (until === undefined || now > until + OFFER_EXPIRY_GRACE_SECONDS * 1000) {
      const seconds = await this.configDomainService.instanceConfig.getHandBackSeconds()
      throw new ConflictException(windowOverMessage(seconds))
    }

    const handedBack = await this.deliveryEventService.handBack(deliveryId, courierId, delivery.status)
    if (!handedBack) {
      throw new ConflictException(ORDER_CHANGED_MESSAGE)
    }
    return { status: EnumDeliveryStatus.ASSIGNING_COURIER }
  }
}
