import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryWhereArgs } from './types/delivery-where-args.type'
import { EnumDeliveryEventSource, EnumDeliveryEventType, EnumDeliveryStatus, EnumEventActor, EnumCourierCompensationReason } from '@prisma/types'
import { IDeliveryUpdate } from './interfaces/IDeliveryUpdate'
import { IDeliveryCreate } from './interfaces/IDeliveryCreate'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CacheService } from 'src/services/cache/cache.service'
import { CacheHelpers } from 'src/services/cache/cache.helpers'
import {
  CantUpdateDeliveryStatusError,
  DeliveryCantBeAcceptedException,
  DeliveryCantBeRejectedException,
} from 'src/errors'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import {
  DeliveryCanceledEvent,
  DeliveryConfirmedEvent,
  DeliveryDispatchedEvent,
  DeliveryDroppedOffEvent,
  DeliveryFailedEvent,
  DeliveryPickedUpEvent,
  DeliveryRejectedEvent,
  DeliveryReassignedEvent,
  DELIVERY_ONGOING_STATUSES,
} from 'src/shared-types/index'
import { ISubmitDeliveryEvent } from '../delivery-event/interfaces/ISubmitDeliveryEvent'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'
import { ConfigDomainService } from '../config/config.domain.service'
import {
  resolveReassignmentPayout,
  formatReassignmentAwardFailure,
  ReassignmentAwardLogContext,
  ReassignmentFailureStage,
} from './utils/reassignment-payout.util'

// How long a courier stays excluded from re-offers of one delivery. Both the add and the
// remove below must use the same value, because re-saving the key resets its expiry.
const REJECTED_LIST_TTL_SECONDS = 60 * 20

@Injectable()
export class DeliveryDomainService {
  private readonly logger = new Logger(DeliveryDomainService.name)
  constructor(
    private deliveryRepository: DeliveryRepository,
    private eventEmitter: EventEmitter2,
    private cacheService: CacheService,
    private deliveryEventService: DeliveryEventService,
    private courierRepository: CourierRepository,
    private courierCompensationRepository: CourierCompensationRepository,
    private configDomainService: ConfigDomainService
  ) {}

  async getById(deliveryId: string, otherFilters?: DeliveryWhereArgs) {
    const delivery = await this.deliveryRepository.findById(deliveryId, otherFilters)

    return delivery
  }

  async getByIdOrThrow(deliveryId: string, otherFilters?: DeliveryWhereArgs) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId, otherFilters)

    return delivery
  }

  async getByIdOrThrowWithQuote(deliveryId: string) {
    return this.deliveryRepository.findByIdOrThrowWithQuote(deliveryId)
  }

  async getByIdOrThrowWithLocation(deliveryId: string, otherFilters?: DeliveryWhereArgs) {
    const delivery = await this.deliveryRepository.findByIdOrThrowWithLocations(deliveryId, otherFilters)

    return delivery
  }

  async getByDeliveryQuoteId(deliveryQuoteId: string) {
    const delivery = await this.deliveryRepository.findByDeliveryQuoteId(deliveryQuoteId)

    return delivery
  }

  async getMany(args: DeliveryWhereArgs, page?: number, perPage?: number) {
    const deliveries = await this.deliveryRepository.findManyPaginated(args, page, perPage)

    return deliveries
  }

  async getManyWithIncludes(args: DeliveryWhereArgs, page?: number, perPage?: number) {
    const deliveries = await this.deliveryRepository.findManyPaginated(args, page, perPage)

    return deliveries
  }

  async update(deliveryId: string, input: IDeliveryUpdate) {
    const delivery = await this.deliveryRepository.update(deliveryId, input)

    return delivery
  }

  async create(input: IDeliveryCreate) {
    const delivery = await this.deliveryRepository.create(input)

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.CREATED,
      actor: EnumEventActor.PARTNER,
      source: EnumDeliveryEventSource.PARTNER_APP,
      message: `Delivery was created delivery ${delivery.id} from partner ${input.partnerId}`,
    })

    return delivery
  }

  async acceptDelivery(deliveryId: string, courierId: string) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    if (delivery.status !== EnumDeliveryStatus.ASSIGNING_COURIER) {
      throw new DeliveryCantBeAcceptedException(
        `Delivery ${deliveryId} cant be accepted, it is on status ${delivery.status}`
      )
    }

    const matchedCourierId = delivery.matchedCourierId
    if (!matchedCourierId) {
      throw new DeliveryCantBeAcceptedException(`Delivery ${deliveryId} is not matched to any courier`)
    }

    if (matchedCourierId !== courierId) {
      throw new DeliveryCantBeAcceptedException(
        `Courier ${courierId} is not matched to delivery ${deliveryId}, is matched to ${matchedCourierId}`
      )
    }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.ACCEPTED,
      actor: EnumEventActor.COURIER,
      courierId: courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      message: `Courier ${courierId} accepted delivery ${delivery.id}`,
    })

    return delivery
  }

  async rejectDelivery(deliveryId: string, courierId: string) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    if (delivery.status !== EnumDeliveryStatus.ASSIGNING_COURIER) {
      throw new DeliveryCantBeRejectedException(
        `Delivery ${deliveryId} cant be rejected, it is on status ${delivery.status}`
      )
    }

    const dbMatchedCourierId = delivery.matchedCourierId

    if (!dbMatchedCourierId) {
      throw new DeliveryCantBeRejectedException(`Delivery ${deliveryId} is not matched to any courier`)
    }
    if (dbMatchedCourierId !== courierId) {
      throw new DeliveryCantBeRejectedException(
        `Courier ${courierId} is not matched to delivery ${deliveryId}, is matched to ${dbMatchedCourierId}`
      )
    }

    // Remove the cached offered courierId
    await this.deliveryRepository.update(delivery.id, { matchedCourierId: null })

    // Add the courier to the rejected list for this delivery
    await this.addCourierToRejectedList(deliveryId, courierId)

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.REJECTED,
      actor: EnumEventActor.COURIER,
      courierId: courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      message: `Courier ${courierId} rejected delivery ${delivery.id}`,
    })

    return delivery
  }

  async cancelDelivery(deliveryId: string) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.CANCELED,
      actor: EnumEventActor.PARTNER,
      source: EnumDeliveryEventSource.PARTNER_APP,
      message: `Delivery ${delivery.id} was canceled by partner ${delivery.partnerId}`,
    })

    return delivery
  }

  async courierArrivedAtDropOff(deliveryId: string) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    // if (delivery.status !== EnumDeliveryStatus.PICKED_UP) {
    //   throw new CantUpdateDeliveryStatusError(`Delivery ${deliveryId} can not be marked as arrived at dropoff location, delivery hasn't been picked up. On status ${delivery.status}`)
    // }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.ARRIVED_AT_DROPOFF_LOCATION,
      actor: EnumEventActor.COURIER,
      courierId: delivery.courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      message: `Delivery ${delivery.id} was status changed: courier arrived at dropoff location: ${delivery.courierId}`,
    })

    return delivery
  }

  async markAsDelivered(deliveryId: string, deliveredData: any) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    // TODO
    // if (delivery.status !== EnumDeliveryStatus.PICKED_UP) {
    //   throw new CantUpdateDeliveryStatusError(
    //     `Delivery ${deliveryId} can not be marked as delivered, it hasn't been picked up. On status ${delivery.status}`
    //   )
    // }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.DROPPED_OFF,
      actor: EnumEventActor.COURIER,
      courierId: delivery.courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      message: `Delivery ${delivery.id} was marked as delivered by courier ${delivery.courierId}`,
      deliveredData,
    })

    return delivery
  }

  async markAsDispatched(deliveryId: string) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    if (delivery.status !== EnumDeliveryStatus.ACCEPTED) {
      throw new CantUpdateDeliveryStatusError(
        `Delivery ${deliveryId} can not be marked as dispatched. On status ${delivery.status}`
      )
    }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.DISPATCHED,
      actor: EnumEventActor.COURIER,
      courierId: delivery.courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      message: `Delivery ${delivery.id} was marked as dispatched by courier ${delivery.courierId}`,
    })

    return delivery
  }

  async courierArrivedAtPickup(deliveryId: string) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    // if (delivery.status !== EnumDeliveryStatus.DISPATCHED) {
    //   throw new CantUpdateDeliveryStatusError(`Delivery ${deliveryId} can not be marked as arrived at pickup location, delivery isn't on dispatched status. On status ${delivery.status}`)
    // }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
      actor: EnumEventActor.COURIER,
      courierId: delivery.courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      message: `Delivery ${delivery.id} was status changed: courier arrived at pickup location: ${delivery.courierId}`,
    })

    return delivery
  }

  async markAsPickedUp(deliveryId: string) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    // TODO
    // if (delivery.status !== EnumDeliveryStatus.DISPATCHED) {
    //   throw new CantUpdateDeliveryStatusError(
    //     `Delivery ${deliveryId} can not be marked as picked up, it hasn't been dispatched. On status ${delivery.status}`
    //   )
    // }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.PICKED_UP,
      actor: EnumEventActor.COURIER,
      courierId: delivery.courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      message: `Delivery ${delivery.id} was marked as pickedup by courier ${delivery.courierId}`,
    })

    return this.deliveryRepository.findByIdOrThrow(deliveryId)
  }

  async markAsOnTheWay(deliveryId: string) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    if (delivery.status !== EnumDeliveryStatus.PICKED_UP) {
      throw new CantUpdateDeliveryStatusError(
        `Delivery ${deliveryId} can not be marked as on the way, it hasn't been picked up. On status ${delivery.status}`
      )
    }

    await this.deliveryEventService.processDeliveryEvent({
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.ON_THE_WAY,
      actor: EnumEventActor.COURIER,
      courierId: delivery.courierId,
      source: EnumDeliveryEventSource.OPENCOURIER,
      message: `Delivery ${delivery.id} was marked as on the way by courier ${delivery.courierId}`,
    })

    return delivery
  }

  async updateDeliveryStatus(deliveryId: string, status: EnumDeliveryStatus) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    const updatedDelivery = await this.deliveryRepository.update(delivery.id, {
      status,
    })

    return updatedDelivery
  }

  // Returns true only when this call is what put the courier on the list. The caller needs
  // that: an entry left over from an earlier genuine rejection is not ours to remove.
  async addCourierToRejectedList(deliveryId: string, courierId: string): Promise<boolean> {
    const rejectedKey = CacheHelpers.getDeliveryRejectedCouriersKey(deliveryId)
    const rejectedCouriers = await this.cacheService.getOrDefault<Array<string>>(rejectedKey, [])

    const alreadyRejected = rejectedCouriers.includes(courierId)
    if (!alreadyRejected) rejectedCouriers.push(courierId)

    await this.cacheService.save<Array<string>>(rejectedKey, rejectedCouriers, REJECTED_LIST_TTL_SECONDS)

    return !alreadyRejected
  }

  // Mirror of addCourierToRejectedList: drops one courier from this delivery's exclusion list
  // and leaves everyone else on it. Only used to undo an entry this service added moments
  // earlier for a reassignment that then did not happen.
  async removeCourierFromRejectedList(deliveryId: string, courierId: string): Promise<void> {
    const rejectedKey = CacheHelpers.getDeliveryRejectedCouriersKey(deliveryId)
    const rejectedCouriers = await this.cacheService.getOrDefault<Array<string>>(rejectedKey, [])

    await this.cacheService.save<Array<string>>(
      rejectedKey,
      rejectedCouriers.filter((id) => id !== courierId),
      REJECTED_LIST_TTL_SECONDS
    )
  }

  async reassignDelivery(
    deliveryId: string,
    newCourierId: string,
    payoutPolicy?: string,
    message?: string
  ) {
    const delivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)

    if (!DELIVERY_ONGOING_STATUSES.includes(delivery.status)) {
      throw new CantUpdateDeliveryStatusError(
        `Delivery ${deliveryId} is in status ${delivery.status} and cannot be reassigned`
      )
    }

    const droppedCourierId = delivery.courierId
    if (!droppedCourierId) {
      throw new CantUpdateDeliveryStatusError(
        `Delivery ${deliveryId} has no assigned courier to reassign from`
      )
    }

    if (newCourierId === droppedCourierId) {
      throw new BadRequestException('Delivery is already assigned to this courier')
    }

    await this.courierRepository.findByIdOrThrow(newCourierId)

    const menu = await this.configDomainService.instanceConfig.getReassignmentPayoutPolicies()
    const defaultPolicy = await this.configDomainService.instanceConfig.getReassignmentPayoutDefaultPolicy()

    const { policy, amount } = resolveReassignmentPayout(
      menu,
      defaultPolicy,
      payoutPolicy,
      delivery.totalCompensation
    )
    const currencyCode = delivery.currencyCode

    const awardMessage =
      `Admin reassigned delivery from courier ${droppedCourierId} to courier ${newCourierId}; ` +
      `payout policy ${policy} awards ${amount} ${currencyCode} (cents) to the dropped courier` +
      (message ? `: ${message}` : '')

    // Every failure path below logs these same five fields, so a lost award can be
    // recreated from the log alone.
    const logContext = { deliveryId, droppedCourierId, amount, currencyCode, policy }

    // The award is written before the event on purpose. If this write fails, nothing has
    // happened yet — the delivery is untouched and the admin can retry. Writing it after
    // the event is what made a failed award unrecoverable: once the status is
    // ASSIGNING_COURIER the state machine has no REASSIGNED transition back out.
    let compensationId: string
    try {
      const compensation = await this.courierCompensationRepository.create({
        amount,
        currencyCode,
        reason: EnumCourierCompensationReason.REASSIGNMENT,
        policy,
        message: awardMessage,
        courierId: droppedCourierId,
        deliveryId,
      })
      compensationId = compensation.id
    } catch (error) {
      this.logger.error(
        formatReassignmentAwardFailure({ ...logContext, compensationId: null, stage: 'AWARD_WRITE_FAILED' }),
        (error as Error).stack
      )
      throw error
    }

    // True only if this call is what excluded the dropped courier — see addCourierToRejectedList.
    let droppedCourierWasExcludedByUs = false
    try {
      droppedCourierWasExcludedByUs = await this.addCourierToRejectedList(deliveryId, droppedCourierId)
    } catch (error) {
      // false: the rejected-list write is the thing that failed, so there is no entry of ours to undo.
      await this.rollbackReassignmentAward(compensationId, 'REASSIGNMENT_DID_NOT_TAKE_EFFECT', logContext, false)
      throw error
    }

    const reassignedEvent: DeliveryReassignedEvent = {
      deliveryId,
      type: EnumDeliveryEventType.REASSIGNED,
      actor: EnumEventActor.ADMIN,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId: newCourierId,
      message: awardMessage,
    }

    let reloadedDelivery
    try {
      await this.deliveryEventService.processDeliveryEvent(reassignedEvent)
      reloadedDelivery = await this.deliveryRepository.findByIdOrThrow(deliveryId)
    } catch (error) {
      // We cannot tell whether the reassignment landed, so keep the award (binding value 4:
      // protect courier income) and log loudly enough for a human to settle it.
      //
      // Known tradeoff, recorded so it stays a decision and not an accident: this is the ONE
      // failure path that is not idempotent. CourierCompensation has no unique constraint on
      // (courierId, deliveryId, reason) and the earnings query sums every row, so an admin who
      // retries after this error can end up with two REASSIGNMENT rows for the same drop. We
      // accept the risk of paying a courier twice over the risk of not paying them at all; the
      // REASSIGNMENT_OUTCOME_UNKNOWN log line tells a human which delivery to check.
      this.logger.error(
        formatReassignmentAwardFailure({ ...logContext, compensationId, stage: 'REASSIGNMENT_OUTCOME_UNKNOWN' }),
        (error as Error).stack
      )
      throw error
    }

    if (
      reloadedDelivery.status !== EnumDeliveryStatus.ASSIGNING_COURIER ||
      reloadedDelivery.matchedCourierId !== newCourierId
    ) {
      // The event was silently dropped (no legal transition) or the pipeline swallowed an
      // error. The dropped courier still has the delivery, so the award must not stand.
      await this.rollbackReassignmentAward(
        compensationId,
        'REASSIGNMENT_DID_NOT_TAKE_EFFECT',
        logContext,
        droppedCourierWasExcludedByUs
      )

      throw new CantUpdateDeliveryStatusError(
        `Reassignment of delivery ${deliveryId} did not take effect; the compensation award was rolled back`
      )
    }

    return reloadedDelivery
  }

  // Unwinds a reassignment attempt that did not happen: removes the award row, and — when we
  // are the ones who added it — takes the dropped courier back off this delivery's rejected
  // list, since they never actually lost the delivery.
  // Deliberately never throws: the caller's own error is the one the admin should see, and a
  // failed cleanup must not hide it. Each failed cleanup is logged under its own stage so the
  // leftover is findable.
  // Omit constructs a type with all properties of ReassignmentAwardLogContext except
  // compensationId and stage.
  private async rollbackReassignmentAward(
    compensationId: string,
    stage: ReassignmentFailureStage,
    logContext: Omit<ReassignmentAwardLogContext, 'compensationId' | 'stage'>,
    undoRejectedListEntry: boolean
  ): Promise<void> {
    this.logger.error(formatReassignmentAwardFailure({ ...logContext, compensationId, stage }))

    try {
      await this.courierCompensationRepository.deleteById(compensationId)
    } catch (deleteError) {
      this.logger.error(
        formatReassignmentAwardFailure({ ...logContext, compensationId, stage: 'AWARD_ROLLBACK_FAILED' }),
        (deleteError as Error).stack
      )
    }

    if (!undoRejectedListEntry) return

    try {
      await this.removeCourierFromRejectedList(logContext.deliveryId, logContext.droppedCourierId)
    } catch (cacheError) {
      this.logger.error(
        formatReassignmentAwardFailure({
          ...logContext,
          compensationId,
          stage: 'REJECTED_LIST_ROLLBACK_FAILED',
        }),
        (cacheError as Error).stack
      )
    }
  }

  async submitDeliveryEvent(event: ISubmitDeliveryEvent, message?: string) {
    const actor = EnumEventActor.ADMIN

    switch (event.eventType) {
      case EnumDeliveryEventType.REASSIGNED:
        throw new BadRequestException('Use POST /api/admin/v1/deliveries/:id/reassign to reassign a delivery')
      case EnumDeliveryEventType.CONFIRMED:
        const confirmedEvent: DeliveryConfirmedEvent = {
          deliveryId: event.deliveryId,
          type: EnumDeliveryEventType.CONFIRMED,
          actor,
          source: EnumDeliveryEventSource.OPENCOURIER,
          message,
        }
        await this.deliveryEventService.processDeliveryEvent(confirmedEvent)
        break
      case EnumDeliveryEventType.ACCEPTED: {
        if (!event.courierId) {
          throw new BadRequestException('courierId is required when submitting ACCEPTED to assign a courier')
        }
        const delivery = await this.getByIdOrThrow(event.deliveryId)
        if (
          delivery.status === EnumDeliveryStatus.ASSIGNING_COURIER &&
          delivery.matchedCourierId === event.courierId
        ) {
          await this.acceptDelivery(event.deliveryId, event.courierId)
        } else {
          await this.deliveryEventService.offerDeliveryToCourierAsAdmin(event.deliveryId, event.courierId, message)
        }
        break
      }
      case EnumDeliveryEventType.DISPATCHED:
        const dispatchedEvent: DeliveryDispatchedEvent = {
          deliveryId: event.deliveryId,
          type: EnumDeliveryEventType.DISPATCHED,
          actor,
          message,
          source: EnumDeliveryEventSource.OPENCOURIER,
        }
        await this.deliveryEventService.processDeliveryEvent(dispatchedEvent)
        break
      case EnumDeliveryEventType.REJECTED:
        const rejectedEvent: DeliveryRejectedEvent = {
          deliveryId: event.deliveryId,
          type: EnumDeliveryEventType.REJECTED,
          actor,
          source: EnumDeliveryEventSource.OPENCOURIER,
          message,
        }
        await this.deliveryEventService.processDeliveryEvent(rejectedEvent)
        break
      case EnumDeliveryEventType.PICKED_UP:
        const pickedUpEvent: DeliveryPickedUpEvent = {
          deliveryId: event.deliveryId,
          type: EnumDeliveryEventType.PICKED_UP,
          actor,
          message,
          source: EnumDeliveryEventSource.OPENCOURIER,
        }
        await this.deliveryEventService.processDeliveryEvent(pickedUpEvent)
        break
      case EnumDeliveryEventType.CANCELED:
        const canceledEvent: DeliveryCanceledEvent = {
          deliveryId: event.deliveryId,
          type: EnumDeliveryEventType.CANCELED,
          actor,
          source: EnumDeliveryEventSource.OPENCOURIER,
          message: `order canceled by admin`,
        }
        await this.deliveryEventService.processDeliveryEvent(canceledEvent)
        break
      case EnumDeliveryEventType.DROPPED_OFF:
        const droppedOffEvent: DeliveryDroppedOffEvent = {
          deliveryId: event.deliveryId,
          type: EnumDeliveryEventType.DROPPED_OFF,
          actor,
          source: EnumDeliveryEventSource.OPENCOURIER,
          message,
          deliveredData: {},
        }
        await this.deliveryEventService.processDeliveryEvent(droppedOffEvent)
        break
      case EnumDeliveryEventType.FAILED:
        const failedEvent: DeliveryFailedEvent = {
          deliveryId: event.deliveryId,
          type: EnumDeliveryEventType.FAILED,
          actor,
          source: EnumDeliveryEventSource.OPENCOURIER,
          message,
        }
        await this.deliveryEventService.processDeliveryEvent(failedEvent)
        break
      default:
        this.logger.log('Unknown status')
        break
    }

    return this.getByIdOrThrow(event.deliveryId)
  }
}
