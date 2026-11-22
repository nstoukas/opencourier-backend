import { SplitRequestRepository } from 'src/persistence/repositories/split-request.repository'
import { SPLIT_SENTENCES } from 'src/domains/split/split'
import { ConflictException, Injectable, Logger } from '@nestjs/common'
import {
  EnumDeliveryIssueReason,
  EnumDeliveryStatus,
  EnumLocationNoteActor,
  EnumUndeliverableAction,
} from '@prisma/types'
import { DeliveryIssueDomainService } from 'src/domains/delivery-issue/delivery-issue.domain.service'
import {
  ProductReportDomainService,
  ProductReportInput,
} from 'src/domains/product-report/product-report.domain.service'
import { EnumProductReportSource } from '@prisma/types'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { DeliveryIssueWithCourier } from 'src/persistence/repositories/delivery-issue.repository'
import { DeliveryNotFoundException, PersonalDataWarningException } from 'src/errors'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { DeliveryWhereArgs } from 'src/domains/delivery/types/delivery-where-args.type'
import { IDeliveryReportIssue } from 'src/domains/delivery/interfaces/IDeliveryReportIssue'
import { IDeliveryMarkAsDelivered } from 'src/domains/delivery/interfaces/IDeliveryMarkAsDelivered'
import {
  AddressNoteStop,
  LocationNoteDomainService,
  toDeliveryForNotes,
} from 'src/domains/location-note/location-note.domain.service'
import { IDeliveryMarkAsPickedUp } from 'src/domains/delivery/interfaces/IDeliveryMarkAsPickedUp'
import { InProgressDeliveryCourier } from './types/in-progress-delivery.courier.type'
import { NewDeliveryCourier } from './types/new-delivery.courier.type'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types'
import { ICourierTap } from 'src/domains/delivery/interfaces/ICourierTap'
import { CourierJobStepCourierInput } from './queries/courier-job-step.courier.input'
import { ArrivedCourierInput } from './queries/arrived.courier.input'
import { RemovalRequestRepository } from 'src/persistence/repositories/removal-request.repository'
import { DeliveryRemovalRequest, EnumRemovalRequestStatus, EnumSplitRequestStatus, SplitRequest } from '@prisma/types'

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
    private deliveryIssueDomainService: DeliveryIssueDomainService,
    private productReportDomainService: ProductReportDomainService,
    private removalRequestRepository: RemovalRequestRepository,
    // Spec 0047: optional for the tests that build this service by hand; Nest always injects it.
    private splitRequestRepository?: SplitRequestRepository,
    // Spec 0053: the job step's note needs the delivery's points. Optional for the same reason.
    private deliveryRepository?: DeliveryRepository
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

  // Spec 0033: what the rider's job card needs from the co-op's settings.
  async getCourierWaitRules() {
    return this.deliveryDomainService.getCourierWaitRules()
  }

  async getMyInProgressDeliveriesWithNotes(courierId: string, page?: number, perPage?: number) {
    const args: DeliveryWhereArgs = {
      courierId,
      status: {
        in: DELIVERY_ONGOING_STATUSES,
      },
    }

    const deliveries = await this.deliveryDomainService.getMany(args, page, perPage)

    // Spec 0053 (AC-3): each stop's notes by distance, without their authors.
    const notesByDelivery = await this.locationNoteDomainService.notesForJobs(
      deliveries.data as InProgressDeliveryCourier[],
      courierId
    )

    // Spec 0035: the newest request on each job, shown only while it is open or refused.
    const removalRequests = await this.removalRequestRepository.findNewestByCourierForDeliveries(
      courierId,
      deliveries.data.map((delivery) => delivery.id)
    )
    const newestRequestByDelivery = new Map<string, DeliveryRemovalRequest>()
    for (const request of removalRequests) {
      if (!newestRequestByDelivery.has(request.deliveryId)) newestRequestByDelivery.set(request.deliveryId, request)
    }
    const shownRequest = (deliveryId: string): DeliveryRemovalRequest | null => {
      const newest = newestRequestByDelivery.get(deliveryId)
      return newest &&
        (newest.status === EnumRemovalRequestStatus.OPEN || newest.status === EnumRemovalRequestStatus.DECLINED)
        ? newest
        : null
    }

    // Spec 0047: the newest split request on each job, shown while open, refused or confirmed.
    const splitRequests =
      (await this.splitRequestRepository?.findNewestByCourierForDeliveries(
        courierId,
        deliveries.data.map((delivery) => delivery.id)
      )) ?? []
    const shownSplit = (deliveryId: string): SplitRequest | null =>
      splitRequests.find(
        (request) =>
          request.deliveryId === deliveryId &&
          (request.status === EnumSplitRequestStatus.OPEN ||
            request.status === EnumSplitRequestStatus.REFUSED ||
            request.status === EnumSplitRequestStatus.CONFIRMED)
      ) ?? null

    const deliveriesWithNotes = deliveries.data.map((delivery) => {
      const notes = notesByDelivery.get(delivery.id)
      const dropoffLocationNotes = notes?.dropoff ?? []
      const pickupLocationNotes = notes?.pickup ?? []

      return {
        ...delivery,
        dropoffLocationNotes,
        pickupLocationNotes,
        removalRequest: shownRequest(delivery.id),
        splitRequest: shownSplit(delivery.id),
      } as InProgressDeliveryCourier
    })

    return {
      data: deliveriesWithNotes,
      pagination: deliveries.pagination,
    }
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

  // Spec 0032, AC-2: only on this rider's own delivery, at the customer or just after.
  async reportProduct(deliveryId: string, courier: CourierEntity, input: ProductReportInput) {
    const delivery = await this.deliveryDomainService.getById(deliveryId, { courierId: courier.id })
    if (!delivery) {
      throw new DeliveryNotFoundException('Delivery not found')
    }
    this.productReportDomainService.refuseUnlessCourierMayReport(delivery.status)
    return this.productReportDomainService.report(
      delivery,
      EnumProductReportSource.COURIER,
      courier.userId,
      input,
      courier.id
    )
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

    // Spec 0047 (cross check 6): not while dispatch is splitting this order.
    if (await this.splitRequestRepository?.findOpenForDelivery(deliveryId)) {
      throw new ConflictException(SPLIT_SENTENCES.pickupBlocked)
    }

    const updatedDelivery = await this.deliveryDomainService.markAsPickedUp(deliveryId, tap)

    // Only when this step moved the delivery (not there before, there after): a repeat after a lost
    // answer stores no second note (spec 0009, AC-12).
    if (
      input.note &&
      delivery.status !== EnumDeliveryStatus.PICKED_UP &&
      updatedDelivery.status === EnumDeliveryStatus.PICKED_UP
    ) {
      await this.saveStepNote(deliveryId, courierId, 'PICKUP', input.note)
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
      await this.saveStepNote(deliveryId, courierId, 'DROPOFF', input.note)
    }

    return updatedDelivery
  }

  // A note sent with the pickup or drop off step (upstream's job step field). Spec 0053: it sits on
  // that stop's point like any note, and since a job step has no way to show the personal data
  // warning, a note that looks like personal data is not saved (the step itself still counts). The
  // note is never logged; only that one was left out.
  private async saveStepNote(deliveryId: string, courierId: string, stop: AddressNoteStop, note: string) {
    const read = await this.deliveryRepository?.findByIdOrThrowWithLocations(deliveryId)
    const delivery = read ? toDeliveryForNotes(read) : null
    if (!delivery) return
    try {
      await this.locationNoteDomainService.createForStop({
        delivery,
        stop,
        note: note.slice(0, 255),
        courierId,
        actor: EnumLocationNoteActor.COURIER,
      })
    } catch (error) {
      if (error instanceof PersonalDataWarningException) {
        this.logger.log(`ADDRESS_NOTE_NOT_SAVED delivery ${deliveryId}: the step's note looked like personal data`)
        return
      }
      throw error
    }
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
