import { OfferReasonInput } from 'src/domains/matching/offer-reason'
import { Injectable, Logger } from '@nestjs/common'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { LocationDomainService } from 'src/domains/location/location.domain.service'
import { CourierMatcherService } from '../courier-matcher/courier-matcher.service'
import { CacheService } from '../cache/cache.service'
import { getRejectedCourierIds } from '../cache/rejected-couriers'
import { DeliveryNotFoundException, DeliveryOfferAlreadyMatchedException } from 'src/errors'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'

// What one matching found: the rider, the delivery, its pickup, the road time when the matcher worked
// it out (spec 0031), and why this rider (spec 0044, saved with the OFFERED event).
export interface CourierMatch {
  courier: Awaited<ReturnType<CourierDomainService['getByIdOrThrow']>>
  delivery: Awaited<ReturnType<DeliveryRepository['findByIdOrThrow']>>
  pickupLocation: Awaited<ReturnType<LocationDomainService['getByIdOrThrow']>>
  travelSeconds?: number | null
  reason?: OfferReasonInput
}

@Injectable()
export class DeliveryMatchingService {
  private readonly logger = new Logger(DeliveryMatchingService.name)
  constructor(
    private readonly courierDomainService: CourierDomainService,
    private readonly locationDomainService: LocationDomainService,
    private readonly courierMatcherService: CourierMatcherService,
    private readonly deliveryRepository: DeliveryRepository,
    private readonly cacheService: CacheService
  ) {}

  // Finds the courier the configured matcher picks for this delivery, skipping everyone on its
  // skip list, and writes nothing. Returns undefined when nobody is free.
  async findCourierForDelivery(deliveryId: string): Promise<CourierMatch | undefined> {
    this.logger.log(`Matching Delivery ${deliveryId} to courier`)

    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    if (!delivery.partnerId) {
      this.logger.error(`Delivery ${delivery.id} not found`)
      throw new DeliveryNotFoundException(`Delivery ${deliveryId} not found`)
    }

    if (delivery.courierId) {
      this.logger.log(`Delivery ${deliveryId} already matched to courier ${delivery.courierId}`)
      throw new DeliveryOfferAlreadyMatchedException(
        `Delivery ${deliveryId} already matched to courier ${delivery.courierId}`
      )
    }

    const matchedCourierId = delivery.matchedCourierId

    if (matchedCourierId) {
      this.logger.log(`Delivery ${deliveryId} is already offered to ${matchedCourierId}`)
      throw new DeliveryOfferAlreadyMatchedException(`Delivery ${deliveryId} is already offered to ${matchedCourierId}`)
    }

    const pickupLocation = await this.locationDomainService.getByIdOrThrow(delivery.pickupLocationId)
    const dropoffLocation = await this.locationDomainService.getByIdOrThrow(delivery.dropoffLocationId)

    const result = await this.courierMatcherService.findCourierForDelivery({
      deliveryId: delivery.id,
      pickupLocation: {
        latitude: pickupLocation.latitude,
        longitude: pickupLocation.longitude,
      },
      dropoffLocation: {
        latitude: dropoffLocation.latitude,
        longitude: dropoffLocation.longitude,
      },
      rejectedCourierIds: await this.getRejectedCourierIds(delivery.id),
      boxUnits: delivery.boxUnits,
    })

    if (!result) {
      this.logger.debug(`No courier found for delivery ${delivery.id}`)
      return
    }

    const courier = await this.courierDomainService.getByIdOrThrow(result.courierId)
    // The rider's id, never their name (row 95 review): a log line names records, not people.
    this.logger.log(`Matched courier: ${courier.id}`)

    return {
      courier,
      delivery,
      // Spec 0031: what the due check reads; the nearest matcher already worked out the road time.
      pickupLocation,
      // undefined: this matcher did not work out a road time. null: it tried and could not.
      travelSeconds: result.travelSeconds,
      // Spec 0044 (AC-6): why the matcher chose this rider, saved with the OFFERED event.
      reason: result.reason,
    }
  }

  async getRejectedCourierIds(deliveryId: string) {
    // Row 148: only the couriers whose own skip time has not ended yet.
    return getRejectedCourierIds(this.cacheService, deliveryId)
  }
}
