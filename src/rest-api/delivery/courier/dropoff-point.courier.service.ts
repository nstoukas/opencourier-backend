import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import { EnumDeliveryEventSource, EnumDeliveryEventType, EnumDeliveryStatus, EnumEventActor } from '@prisma/types'
import { haversineDistanceInMetres } from 'src/core/utils/distance'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { OUTSIDE_SERVICE_AREA_MESSAGE } from 'src/domains/saved-customer/saved-customer.domain.service'
import { DeliveryNotFoundException } from 'src/errors'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { LocationRepository } from 'src/persistence/repositories/location.repository'
import { SavedCustomerRepository } from 'src/persistence/repositories/saved-customer.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { isPositionInRegion } from 'src/utils/geoJsonUtils'
import { normalisePhone } from 'src/utils/phone'
import { DropoffPointCourierInput } from './queries/dropoff-point.courier.input'

// Spec 0016 (AC-9): the pin can be moved from pickup until the rider is at the door. Before pickup the
// rider has not seen the place; after drop off the job is over.
export const DROPOFF_POINT_CORRECTABLE_STATUSES: EnumDeliveryStatus[] = [
  EnumDeliveryStatus.PICKED_UP,
  EnumDeliveryStatus.ON_THE_WAY,
  EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
]

// Spec 0016 (AC-10): a saved customer whose point is further than this from the delivery's was moved
// by the restaurant after the order, and a rider's move never overwrites it.
export const SAVED_CUSTOMER_UNCHANGED_METRES = 5

export const WRONG_STATUS_MESSAGE = 'The pin can be moved only between pickup and drop off'
export const ALREADY_MOVED_MESSAGE = 'The pin was already moved for this delivery'
export const ALREADY_THERE_MESSAGE = 'The pin is already where you stand'

// Spec 0016 (AC-8, decision 31.13): a move shorter than this is GPS noise, not a wrong pin.
export const MINIMUM_MOVE_METRES = 10

// What happened to the restaurant's saved customer, as the event message says it (AC-10).
type SavedCustomerOutcome = 'updated' | 'none' | 'changed-since'

const OUTCOME_SENTENCE: Record<SavedCustomerOutcome, string> = {
  updated: 'saved customer updated',
  none: 'no saved customer',
  'changed-since': 'saved customer not changed: the restaurant moved its pin since the order',
}

// A rider's drop off pin move (spec 0016). The delivery's own Location, quote, price and pay never
// change: the Location row is shared by other deliveries (findOrCreate), and the price was fixed at the
// quote. What changes is the restaurant's saved customer, so the next order goes to the right door, and
// the move is recorded as a DeliveryEvent so members can see it (value 1).
// Personal data (AC-12): no name, phone or doorbell goes into a log line or the event message.
@Injectable()
export class DropoffPointCourierService {
  private readonly logger = new Logger(DropoffPointCourierService.name)

  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly locationRepository: LocationRepository,
    private readonly savedCustomerRepository: SavedCustomerRepository,
    private readonly configDomainService: ConfigDomainService,
    private readonly deliveryEventService: DeliveryEventService
  ) {}

  async correct(
    deliveryId: string,
    courierId: string,
    input: DropoffPointCourierInput
  ): Promise<{ savedCustomerUpdated: boolean; distanceMetres: number }> {
    const newPoint = { latitude: input.latitude, longitude: input.longitude }

    // Someone else's delivery answers exactly like a missing one (as Report issue does).
    const delivery = await this.deliveryRepository.findById(deliveryId)
    if (!delivery || delivery.courierId !== courierId) {
      throw new DeliveryNotFoundException('Delivery not found')
    }
    if (delivery.dropoffPointCorrectedAt) {
      throw new ConflictException(ALREADY_MOVED_MESSAGE)
    }
    if (!DROPOFF_POINT_CORRECTABLE_STATUSES.includes(delivery.status)) {
      throw new ConflictException(WRONG_STATUS_MESSAGE)
    }
    await this.refuseIfOutsideServiceArea(newPoint)

    const oldLocation = await this.locationRepository.findById(delivery.dropoffLocationId)
    if (!oldLocation) {
      throw new DeliveryNotFoundException('Delivery not found')
    }
    const oldPoint = { latitude: oldLocation.latitude, longitude: oldLocation.longitude }
    const metres = Math.round(
      haversineDistanceInMetres(oldPoint.latitude, oldPoint.longitude, newPoint.latitude, newPoint.longitude)
    )
    if (metres < MINIMUM_MOVE_METRES) {
      throw new ConflictException(ALREADY_THERE_MESSAGE)
    }

    // One move per delivery: claimed by a conditional write, so two taps sent at once record one move.
    // The status is part of the condition too (the decision 32.17 pattern): a drop off or a cancel that
    // lands between the read above and this write makes the claim miss.
    const claimed = await this.deliveryRepository.updateIfMatches(
      deliveryId,
      { courierId, dropoffPointCorrectedAt: null, status: { in: DROPOFF_POINT_CORRECTABLE_STATUSES } },
      { dropoffPointCorrectedAt: new Date() }
    )
    if (!claimed) {
      // Say which race was lost: another move, or the job moved on.
      const now = await this.deliveryRepository.findById(deliveryId)
      throw new ConflictException(now?.dropoffPointCorrectedAt ? ALREADY_MOVED_MESSAGE : WRONG_STATUS_MESSAGE)
    }

    try {
      const outcome = await this.moveSavedCustomer(delivery.partnerId, delivery.dropoffPhoneNumber, oldPoint, newPoint)
      await this.deliveryEventService.recordDropoffPointCorrectedEvent(
        {
          deliveryId,
          type: EnumDeliveryEventType.DROPOFF_POINT_CORRECTED,
          actor: EnumEventActor.COURIER,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId,
          message:
            `Drop off pin moved ${metres} m by the rider, from ${formatPoint(oldPoint)} to ${formatPoint(newPoint)}; ` +
            OUTCOME_SENTENCE[outcome],
        },
        delivery.status
      )
      return { savedCustomerUpdated: outcome === 'updated', distanceMetres: metres }
    } catch (error) {
      this.logger.error(`DROPOFF_POINT_CORRECTION_FAILED delivery ${deliveryId}: ${error}`, (error as Error).stack)
      // Nothing was recorded, so the move is given back and the rider can try again. A failure here is
      // logged on its own; the error the rider gets is still the first one.
      try {
        await this.deliveryRepository.updateIfMatches(deliveryId, { courierId }, { dropoffPointCorrectedAt: null })
      } catch (releaseError) {
        this.logger.error(`DROPOFF_POINT_CLAIM_RELEASE_FAILED delivery ${deliveryId}: ${releaseError}`)
      }
      throw error
    }
  }

  // AC-10: the restaurant's customer with this phone, moved only while its point is still the
  // delivery's (within 5 m); a pin the restaurant moved after the order always wins.
  private async moveSavedCustomer(
    partnerId: string | null,
    dropoffPhoneNumber: string,
    oldPoint: { latitude: number; longitude: number },
    newPoint: { latitude: number; longitude: number }
  ): Promise<SavedCustomerOutcome> {
    const phone = normalisePhone(dropoffPhoneNumber)
    if (!partnerId || phone === null) {
      return 'none'
    }
    const customer = await this.savedCustomerRepository.findByPhone(partnerId, phone)
    if (!customer) {
      return 'none'
    }
    // Already at the new point: an earlier try moved it, then failed to record its event and gave the
    // claim back. Saying "the restaurant moved it" here would be a false line in the audit trail.
    if (
      haversineDistanceInMetres(customer.latitude, customer.longitude, newPoint.latitude, newPoint.longitude) <=
      SAVED_CUSTOMER_UNCHANGED_METRES
    ) {
      return 'updated'
    }
    const metresFromDelivery = haversineDistanceInMetres(
      customer.latitude,
      customer.longitude,
      oldPoint.latitude,
      oldPoint.longitude
    )
    if (metresFromDelivery > SAVED_CUSTOMER_UNCHANGED_METRES) {
      return 'changed-since'
    }
    const moved = await this.savedCustomerRepository.movePointIfUnchanged(
      partnerId,
      customer.id,
      { latitude: customer.latitude, longitude: customer.longitude },
      newPoint
    )
    // A miss means the restaurant edited it (or deleted it) in the same instant: its edit wins.
    return moved ? 'updated' : 'changed-since'
  }

  // The same region test quotes and saved customers use, so a moved pin never fails the next quote.
  private async refuseIfOutsideServiceArea(point: { latitude: number; longitude: number }): Promise<void> {
    const details = await this.configDomainService.instanceConfig.getDetails()
    const inside = isPositionInRegion(details.region, point, (type) =>
      this.logger.warn(`Unsupported region type in instance config: ${type}`)
    )
    if (!inside) {
      throw new BadRequestException(OUTSIDE_SERVICE_AREA_MESSAGE)
    }
  }
}

function formatPoint(point: { latitude: number; longitude: number }): string {
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`
}
