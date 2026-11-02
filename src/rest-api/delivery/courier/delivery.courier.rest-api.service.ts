import { ConflictException, Injectable, Logger } from '@nestjs/common'
import {
  EnumDeliveryIssueReason,
  EnumDeliveryStatus,
  EnumLocationNoteActor,
  EnumUndeliverableAction,
} from '@prisma/types'
import { DeliveryIssueDomainService } from 'src/domains/delivery-issue/delivery-issue.domain.service'
import { DeliveryIssueWithCourier } from 'src/persistence/repositories/delivery-issue.repository'
import { DeliveryNotFoundException } from 'src/errors'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { DeliveryWhereArgs } from 'src/domains/delivery/types/delivery-where-args.type'
import { IDeliveryReportIssue } from 'src/domains/delivery/interfaces/IDeliveryReportIssue'
import { IDeliveryMarkAsDelivered } from 'src/domains/delivery/interfaces/IDeliveryMarkAsDelivered'
import { LocationNoteDomainService } from 'src/domains/location-note/location-note.domain.service'
import { IDeliveryMarkAsPickedUp } from 'src/domains/delivery/interfaces/IDeliveryMarkAsPickedUp'
import { LocationNoteReactionDomainService } from 'src/domains/location-note-reaction/location-note-reaction.domain.service'
import { LocationNoteWithReactionCounts } from './types/location-note-with-reaction-counts.type'
import { InProgressDeliveryCourier } from './types/in-progress-delivery.courier.type'
import { NewDeliveryCourier } from './types/new-delivery.courier.type'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types'
import { ICourierTap } from 'src/domains/delivery/interfaces/ICourierTap'
import { CourierJobStepCourierInput } from './queries/courier-job-step.courier.input'
import { ArrivedCourierInput } from './queries/arrived.courier.input'

// The tap of a job step the app sent with `tapAgeMs` (spec 0009), stamped with the moment this
// server received it; undefined for a step sent without one, whose event then happened on arrival.
function courierTap(step: { tapAgeMs?: number }): ICourierTap | undefined {
  return step.tapAgeMs === undefined ? undefined : { receivedAt: new Date(), tapAgeMs: step.tapAgeMs }
}

@Injectable()
export class DeliveryRestApiCourierService {
  private readonly logger = new Logger(DeliveryRestApiCourierService.name)
  constructor(
    private deliveryDomainService: DeliveryDomainService,
    private locationNoteDomainService: LocationNoteDomainService,
    private locationNoteReactionDomainService: LocationNoteReactionDomainService,
    private deliveryIssueDomainService: DeliveryIssueDomainService
  ) {}

  async getById(deliveryId: string, otherFilters?: DeliveryWhereArgs) {
    const delivery = await this.deliveryDomainService.getById(deliveryId, otherFilters)

    return delivery
  }

  async getByIdOrThrow(deliveryId: string, otherFilters?: DeliveryWhereArgs) {
    const delivery = await this.deliveryDomainService.getByIdOrThrow(deliveryId, otherFilters)

    return delivery
  }

  async getMyNewDeliveries(courierId: string, page?: number, perPage?: number) {
    const args: DeliveryWhereArgs = {
      matchedCourierId: courierId,
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
    }

    const deliveries = await this.deliveryDomainService.getMany(args, page, perPage)

    return {
      data: deliveries.data as NewDeliveryCourier[],
      pagination: deliveries.pagination,
    }
  }

  async getMyInProgressDeliveriesWithNotes(courierId: string, page?: number, perPage?: number) {
    const args: DeliveryWhereArgs = {
      courierId,
      status: {
        in: DELIVERY_ONGOING_STATUSES,
      },
    }

    const deliveries = await this.deliveryDomainService.getMany(args, page, perPage)

    const deliveryDropoffLocationIds = deliveries.data.map((delivery) => delivery.dropoffLocationId)
    const deliveryPickupLocationIds = deliveries.data.map((delivery) => delivery.pickupLocationId)

    const locationNotes = await this.locationNoteDomainService.getManyByLocationIds([
      ...deliveryDropoffLocationIds,
      ...deliveryPickupLocationIds,
    ])

    const noteReactionCountsById = await this.locationNoteReactionDomainService.getCountsByNoteIds(
      locationNotes.map((note) => note.id)
    )
    const courierReactionsToNotes = await this.locationNoteReactionDomainService.getReactionByCourierOnNoteIds(
      locationNotes.map((note) => note.id),
      courierId
    )

    const locationNotesWithReactions = locationNotes.map((note) => {
      const reactionCounts = noteReactionCountsById[note.id] || { upvotes: 0, downvotes: 0 }

      return new LocationNoteWithReactionCounts(
        note,
        reactionCounts.upvotes,
        reactionCounts.downvotes,
        courierReactionsToNotes[note.id] || null
      )
    })

    const deliveriesWithNotes = deliveries.data.map((delivery) => {
      const dropoffLocationNotes = locationNotesWithReactions.filter(
        (note) => note.locationId === delivery.dropoffLocationId
      )
      const pickupLocationNotes = locationNotesWithReactions.filter(
        (note) => note.locationId === delivery.pickupLocationId
      )

      return {
        ...delivery,
        dropoffLocationNotes,
        pickupLocationNotes,
      } as InProgressDeliveryCourier
    })

    return {
      data: deliveriesWithNotes,
      pagination: deliveries.pagination,
    }
  }

  async getMyDoneDeliveries(courierId: string, page?: number, perPage?: number) {
    const args: DeliveryWhereArgs = {
      courierId,
      status: {
        notIn: [
          EnumDeliveryStatus.ASSIGNING_COURIER,
          EnumDeliveryStatus.ACCEPTED,
          EnumDeliveryStatus.DISPATCHED,
          EnumDeliveryStatus.PICKED_UP,
        ],
      },
    }

    const deliveries = await this.deliveryDomainService.getMany(args, page, perPage)

    return deliveries
  }

  async acceptDelivery(deliveryId: string, courierId: string, automatic = false) {
    const delivery = await this.deliveryDomainService.acceptDelivery(deliveryId, courierId, automatic)

    return delivery
  }

  async rejectDelivery(deliveryId: string, courierId: string) {
    const delivery = await this.deliveryDomainService.rejectDelivery(deliveryId, courierId)

    return delivery
  }

  async reportIssueWithTheDelivery(deliveryId: string, courierId: string, input: IDeliveryReportIssue) {
    const delivery = await this.deliveryDomainService.getById(deliveryId, { courierId })

    if (!delivery) {
      throw new DeliveryNotFoundException('Delivery not found')
    }

    const updatedDelivery = await this.deliveryDomainService.update(deliveryId, {
      undeliverableAction: input.undeliverableAction as EnumUndeliverableAction,
      undeliverableReason: input.undeliverableReason,
    })

    return updatedDelivery
  }

  // A rider may report only on a delivery assigned to them; anything else answers 404, so a
  // rider cannot learn whether someone else's delivery exists (decision 66.11).
  async reportIssue(
    deliveryId: string,
    courierId: string,
    input: { reason: EnumDeliveryIssueReason; note?: string | null }
  ): Promise<DeliveryIssueWithCourier> {
    const delivery = await this.deliveryDomainService.getById(deliveryId, { courierId })
    if (!delivery) {
      throw new DeliveryNotFoundException('Delivery not found')
    }
    return this.deliveryIssueDomainService.report({ deliveryId, courierId, reason: input.reason, note: input.note })
  }

  // Spec 0015 (decision 32.14): a rider cannot cancel a job. Cancelling now pays the rider and can
  // charge the restaurant, so it must come from whoever asked for it (the restaurant, or the co-op
  // through an admin). The app never called this; a rider who cannot finish reports an issue or
  // calls dispatch. The route stays so an old client gets a clear answer instead of a 404.
  async cancelDelivery(deliveryId: string, courierId: string): Promise<never> {
    const delivery = await this.deliveryDomainService.getById(deliveryId, { courierId })

    if (!delivery) {
      throw new DeliveryNotFoundException('Delivery not found')
    }

    throw new ConflictException('A rider cannot cancel a job. Report an issue or call dispatch.')
  }

  async markAsDispatched(deliveryId: string, courierId: string, step: CourierJobStepCourierInput = {}) {
    const tap = courierTap(step)
    const delivery = await this.deliveryDomainService.getById(deliveryId, { courierId })

    if (!delivery) {
      throw new DeliveryNotFoundException('Delivery not found')
    }

    const updatedDelivery = await this.deliveryDomainService.markAsDispatched(deliveryId, tap)

    return updatedDelivery
  }

  async courierArrivedAtPickup(deliveryId: string, courierId: string, step: ArrivedCourierInput = {}) {
    const tap = courierTap(step)
    const delivery = await this.deliveryDomainService.getById(deliveryId, { courierId })

    if (!delivery) {
      throw new DeliveryNotFoundException('Delivery not found')
    }

    const updatedDelivery = await this.deliveryDomainService.courierArrivedAtPickup(deliveryId, tap, step.detected)

    return updatedDelivery
  }

  async markAsPickedUp(deliveryId: string, courierId: string, input: IDeliveryMarkAsPickedUp) {
    const tap = courierTap(input)
    const delivery = await this.deliveryDomainService.getById(deliveryId, { courierId })

    if (!delivery) {
      throw new DeliveryNotFoundException('Delivery not found')
    }

    const updatedDelivery = await this.deliveryDomainService.markAsPickedUp(deliveryId, tap)

    // Only when this step moved the delivery (not there before, there after): a repeat after a lost
    // answer stores no second note (spec 0009, AC-12).
    if (
      input.note &&
      delivery.status !== EnumDeliveryStatus.PICKED_UP &&
      updatedDelivery.status === EnumDeliveryStatus.PICKED_UP
    ) {
      // Add the location note for the delivery
      await this.locationNoteDomainService.create({
        note: input.note,
        deliveryId,
        courierId,
        actor: EnumLocationNoteActor.COURIER,
        locationId: delivery.pickupLocationId,
      })
    }

    return updatedDelivery
  }

  async courierArrivedAtDropOff(deliveryId: string, courierId: string, step: ArrivedCourierInput = {}) {
    const tap = courierTap(step)
    const delivery = await this.deliveryDomainService.getById(deliveryId, { courierId })

    if (!delivery) {
      throw new DeliveryNotFoundException('Delivery not found')
    }

    const updatedDelivery = await this.deliveryDomainService.courierArrivedAtDropOff(deliveryId, tap, step.detected)

    return updatedDelivery
  }

  async markAsDelivered(deliveryId: string, courierId: string, input: IDeliveryMarkAsDelivered) {
    const tap = courierTap(input)
    const delivery = await this.deliveryDomainService.getById(deliveryId, { courierId })

    if (!delivery) {
      throw new DeliveryNotFoundException('Delivery not found')
    }

    const deliveredData: any = {}

    if (input.imageData) {
      deliveredData.imageData = input.imageData
      deliveredData.imageName = input.imageName
      deliveredData.imageType = input.imageType
    }

    const updatedDelivery = await this.deliveryDomainService.markAsDelivered(deliveryId, deliveredData, tap)

    // Only when this step moved the delivery (not there before, there after): a repeat after a lost
    // answer stores no second note (spec 0009, AC-12).
    if (
      input.note &&
      delivery.status !== EnumDeliveryStatus.DROPPED_OFF &&
      updatedDelivery.status === EnumDeliveryStatus.DROPPED_OFF
    ) {
      // Add the location note for the delivery
      await this.locationNoteDomainService.create({
        note: input.note,
        deliveryId,
        courierId,
        actor: EnumLocationNoteActor.COURIER,
        locationId: delivery.dropoffLocationId,
      })
    }

    return updatedDelivery
  }

  async markAsOnTheWay(deliveryId: string, courierId: string) {
    const delivery = await this.deliveryDomainService.getById(deliveryId, { courierId })

    if (!delivery) {
      throw new DeliveryNotFoundException('Delivery not found')
    }

    const updatedDelivery = await this.deliveryDomainService.markAsOnTheWay(deliveryId)

    return updatedDelivery
  }
}
