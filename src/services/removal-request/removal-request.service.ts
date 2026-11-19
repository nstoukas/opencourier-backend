import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import {
  DeliveryRemovalRequest,
  EnumCancelledBy,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumRemovalRequestStatus,
  RemovalReason,
} from '@prisma/types'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { resolveCancellationPayout } from 'src/domains/delivery/utils/cancellation-payout.util'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryNotFoundException, NotFoundException } from 'src/errors'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import {
  RemovalReasonInput,
  RemovalRequestForAdmin,
  RemovalRequestRepository,
} from 'src/persistence/repositories/removal-request.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import {
  DELIVERY_ONGOING_STATUSES,
  DELIVERY_PICKED_UP_STATUSES,
  DeliveryCanceledEvent,
  DeliveryRemovalEvent,
  FALLBACK_CANCELLATION_PAYOUT_POLICY,
} from 'src/shared-types'
import { isUniqueConstraintError } from 'src/prisma.util'

// The refusal when an order moved on, worded for the dispatcher looking at the board.
export const ADMIN_ORDER_CHANGED_MESSAGE = 'This order changed while you were deciding. Look at the row again.'
export const BOARD_STALE_MESSAGE = 'This order moved on since the board was loaded. Reload and try again.'
export const REQUEST_NOT_OPEN_MESSAGE = 'This request has already been answered or withdrawn.'
export const ALREADY_OPEN_MESSAGE = 'A removal request is already open for this order.'
export const REASON_GONE_MESSAGE = 'That reason is no longer on the list. Pick another.'
export const NOTE_REQUIRED_MESSAGE = 'This reason needs a note. Say what happened.'
export const LAST_REASON_MESSAGE = 'At least one reason must stay on the list.'

const TWO_MINUTES_MS = 2 * 60 * 1000

// Spec 0035: a rider asks dispatch to take them off an order, and dispatch answers. A request is a
// row beside the delivery, so the delivery's status moves only at approval, and the approval branches
// on whether the food has been picked up. No database transaction: the approve claims the request
// first and undoes the claim if the delivery changed (decision 24.11).
@Injectable()
export class RemovalRequestService {
  private readonly logger = new Logger(RemovalRequestService.name)

  constructor(
    private readonly removalRequestRepository: RemovalRequestRepository,
    private readonly deliveryRepository: DeliveryRepository,
    private readonly deliveryEventRepository: DeliveryEventRepository,
    private readonly deliveryEventService: DeliveryEventService,
    private readonly configDomainService: ConfigDomainService
  ) {}

  // --- The rider's side ---------------------------------------------------------------------

  async listActiveReasons(): Promise<RemovalReason[]> {
    return this.removalRequestRepository.findActiveReasons()
  }

  // AC-4. The checks come in the spec's order: is it theirs, is the reason usable, is its note there.
  async send(
    deliveryId: string,
    courierId: string,
    input: { reasonId: string; note?: string | null }
  ): Promise<DeliveryRemovalRequest> {
    const delivery = await this.deliveryRepository.findById(deliveryId)
    if (!this.riderHolds(delivery, courierId)) {
      throw new DeliveryNotFoundException('Delivery not found')
    }
    const reason = await this.removalRequestRepository.findReasonById(input.reasonId)
    if (!reason || reason.removedAt) {
      throw new ConflictException(REASON_GONE_MESSAGE)
    }
    const note = input.note?.trim() || null
    if (reason.needsNote && !note) {
      throw new BadRequestException(NOTE_REQUIRED_MESSAGE)
    }

    const request = await this.removalRequestRepository.createOpen({
      deliveryId,
      courierId,
      reasonId: reason.id,
      label: reason.label,
      paidToRider: reason.paidToRider,
      chargedToRestaurant: reason.chargedToRestaurant,
      note,
    })
    if (!request) {
      throw new ConflictException(ALREADY_OPEN_MESSAGE)
    }

    // The rider may have been taken off between the read and this write: a request left open then
    // would block the next rider's request forever, so it is closed and refused.
    const latest = await this.deliveryRepository.findById(deliveryId)
    if (!this.riderHolds(latest, courierId)) {
      await this.removalRequestRepository.closeIfOpen(request.id)
      throw new DeliveryNotFoundException('Delivery not found')
    }

    await this.recordEvent(
      {
        deliveryId,
        type: EnumDeliveryEventType.REMOVAL_REQUESTED,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId,
        message: `Removal requested: ${reason.label}`,
      },
      delivery.status
    )
    return request
  }

  // AC-5. The rider takes back their own open request.
  async withdraw(deliveryId: string, courierId: string): Promise<{ status: EnumRemovalRequestStatus }> {
    const delivery = await this.deliveryRepository.findById(deliveryId)
    if (!this.riderHolds(delivery, courierId)) {
      throw new DeliveryNotFoundException('Delivery not found')
    }
    const open = await this.removalRequestRepository.findOpenForDelivery(deliveryId)
    if (!open || open.courierId !== courierId) {
      throw new ConflictException(REQUEST_NOT_OPEN_MESSAGE)
    }
    const withdrawn = await this.removalRequestRepository.updateIfOpen(open.id, {
      status: EnumRemovalRequestStatus.WITHDRAWN,
      openFor: null,
    })
    if (!withdrawn) {
      throw new ConflictException(REQUEST_NOT_OPEN_MESSAGE)
    }
    await this.recordEvent(
      {
        deliveryId,
        type: EnumDeliveryEventType.REMOVAL_WITHDRAWN,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId,
        message: `Removal request withdrawn: ${open.label}`,
      },
      delivery.status
    )
    return { status: EnumRemovalRequestStatus.WITHDRAWN }
  }

  // --- The decision -------------------------------------------------------------------------

  // AC-7. One conditional write. The sentence is optional and goes to the rider; never on the event.
  async decline(
    requestId: string,
    adminUserId: string,
    note: string | undefined
  ): Promise<{ status: EnumRemovalRequestStatus }> {
    const request = await this.getRequestOrThrow(requestId)
    if (request.status !== EnumRemovalRequestStatus.OPEN) {
      throw new ConflictException(REQUEST_NOT_OPEN_MESSAGE)
    }
    const delivery = await this.deliveryRepository.findByIdOrThrow(request.deliveryId)
    const decisionNote = note?.trim() || null

    const declined = await this.removalRequestRepository.updateIfOpen(request.id, {
      status: EnumRemovalRequestStatus.DECLINED,
      openFor: null,
      decidedAt: new Date(),
      decidedByUserId: adminUserId,
      decisionNote,
    })
    if (!declined) {
      throw new ConflictException(REQUEST_NOT_OPEN_MESSAGE)
    }

    await this.recordEvent(
      {
        deliveryId: delivery.id,
        type: EnumDeliveryEventType.REMOVAL_DECLINED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: request.courierId,
        message: `Removal request declined: ${request.label}`,
      },
      delivery.status
    )
    await this.deliveryEventService.notifyRemovalDecided(request.courierId, {
      deliveryId: delivery.id,
      outcome: 'DECLINED',
      decisionNote,
      paid: request.paidToRider,
      payAmount: null,
      currencyCode: delivery.currencyCode,
    })
    return { status: EnumRemovalRequestStatus.DECLINED }
  }

  // AC-8. The spec's six steps, in order: read, amount, claim, act, undo a miss, settle and notify.
  async approve(
    requestId: string,
    adminUserId: string,
    pickedUpSeen: boolean
  ): Promise<{ status: EnumRemovalRequestStatus; deliveryStatus: EnumDeliveryStatus }> {
    const request = await this.getRequestOrThrow(requestId)
    if (request.status !== EnumRemovalRequestStatus.OPEN) {
      throw new ConflictException(REQUEST_NOT_OPEN_MESSAGE)
    }
    const delivery = await this.deliveryRepository.findByIdOrThrow(request.deliveryId)
    if (!this.riderHolds(delivery, request.courierId)) {
      // Should not happen (the close rule closes it), but a request left open would block the next one.
      await this.removalRequestRepository.closeIfOpen(request.id)
      throw new ConflictException(ADMIN_ORDER_CHANGED_MESSAGE)
    }

    const pickedUp = DELIVERY_PICKED_UP_STATUSES.includes(delivery.status)
    // A stale board can never cancel an order the admin thought was only changing rider.
    if (pickedUp !== pickedUpSeen) {
      throw new ConflictException(BOARD_STALE_MESSAGE)
    }

    const { amount, policy } = await this.amountAtApprove(delivery, pickedUp)

    const claimed = await this.removalRequestRepository.updateIfOpen(request.id, {
      status: EnumRemovalRequestStatus.APPROVED,
      openFor: null,
      decidedAt: new Date(),
      decidedByUserId: adminUserId,
      payAmount: amount,
      payPolicy: policy,
      afterPickup: pickedUp,
    })
    if (!claimed) {
      throw new ConflictException(REQUEST_NOT_OPEN_MESSAGE)
    }

    const claim: DeliveryRemovalRequest = {
      ...request,
      status: EnumRemovalRequestStatus.APPROVED,
      openFor: null,
      payAmount: amount,
      payPolicy: policy,
      afterPickup: pickedUp,
    }
    const finalStatus = pickedUp
      ? await this.approveAfterPickup(delivery, claim)
      : await this.approveBeforePickup(delivery, claim)

    return { status: EnumRemovalRequestStatus.APPROVED, deliveryStatus: finalStatus }
  }

  // AC-9: the rider comes off, the money, then the notices, then the order goes out again.
  private async approveBeforePickup(
    delivery: DeliveryEntity,
    request: DeliveryRemovalRequest
  ): Promise<EnumDeliveryStatus> {
    const oldStatus = delivery.status
    const event = await this.deliveryEventService.removeRiderBeforePickup(delivery, request.courierId, request.label)
    if (!event) {
      await this.recordMissedApproval(request, oldStatus)
      await this.undoClaim(request)
      throw new ConflictException(ADMIN_ORDER_CHANGED_MESSAGE)
    }

    await this.deliveryEventService.settleRemoval(request.id)
    await this.notifyApproved(request, delivery)
    await this.deliveryEventService.finishRemovalBeforePickup(event, oldStatus)
    return EnumDeliveryStatus.ASSIGNING_COURIER
  }

  // AC-10: the normal CANCELED event, by COOP. Only once the delivery reads CANCELED is the approval
  // recorded; the cancellation's own settlement pays or skips by this request.
  private async approveAfterPickup(
    delivery: DeliveryEntity,
    request: DeliveryRemovalRequest
  ): Promise<EnumDeliveryStatus> {
    const oldStatus = delivery.status
    const cancel: DeliveryCanceledEvent = {
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.CANCELED,
      actor: EnumEventActor.ADMIN,
      source: EnumDeliveryEventSource.OPENCOURIER,
      cancelledBy: EnumCancelledBy.COOP,
      message: `Cancelled because a removal was approved after pickup: ${request.label}`,
    }
    try {
      await this.deliveryEventService.processDeliveryEvent(cancel)
    } catch (error) {
      // What matters is the delivery's status below, not how the attempt ended.
      this.logger.error(`Cancelling delivery ${delivery.id} for a removal failed: ${error}`)
    }

    const latest = await this.deliveryRepository.findById(delivery.id)
    if (latest?.status !== EnumDeliveryStatus.CANCELED) {
      await this.recordMissedApproval(request, latest?.status ?? oldStatus)
      await this.undoClaim(request)
      throw new ConflictException(ADMIN_ORDER_CHANGED_MESSAGE)
    }

    await this.recordEvent(
      {
        deliveryId: delivery.id,
        type: EnumDeliveryEventType.REMOVAL_APPROVED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: request.courierId,
        message: `Removal approved after pickup, order cancelled: ${request.label}`,
      },
      EnumDeliveryStatus.CANCELED
    )
    // The cancellation already settled inline; this catches a miss before the sweep would.
    await this.deliveryEventService.settleRemoval(request.id)
    await this.notifyApproved(request, delivery)
    return EnumDeliveryStatus.CANCELED
  }

  // AC-13: the amount, read now and stored on the request. A broken setting never costs the rider
  // their pay: an empty menu pays in full, as resolveCancellationPayout does.
  private async amountAtApprove(
    delivery: DeliveryEntity,
    pickedUp: boolean
  ): Promise<{ amount: number; policy: string }> {
    const settingName = pickedUp ? 'cancellationPayoutPolicy' : 'reassignmentPayoutDefaultPolicy'
    let menu: Record<string, number> = {}
    let key = FALLBACK_CANCELLATION_PAYOUT_POLICY
    try {
      menu = await this.configDomainService.instanceConfig.getReassignmentPayoutPolicies()
      key = pickedUp
        ? await this.configDomainService.instanceConfig.getCancellationPayoutPolicy()
        : await this.configDomainService.instanceConfig.getReassignmentPayoutDefaultPolicy()
    } catch (error) {
      this.logger.warn(`Could not read the removal pay settings for delivery ${delivery.id}: ${error}`)
    }
    const { policy, amount, warnings } = resolveCancellationPayout(menu, key, delivery.totalCompensation, settingName)
    for (const warning of warnings) {
      this.logger.warn(`Removal pay for delivery ${delivery.id}: ${warning}`)
    }
    return { amount, policy }
  }

  // AC-11: `payAmount` named only when the reason is paid. The amount was fixed at the approve.
  private async notifyApproved(request: DeliveryRemovalRequest, delivery: DeliveryEntity): Promise<void> {
    await this.deliveryEventService.notifyRemovalDecided(request.courierId, {
      deliveryId: delivery.id,
      outcome: 'APPROVED',
      decisionNote: null,
      paid: request.paidToRider,
      payAmount: request.paidToRider ? request.payAmount : null,
      currencyCode: delivery.currencyCode,
    })
  }

  // A guarded event write: the change it records already happened, so a failure is logged rather
  // than answered as a 500. Ids only, never the rider's note.
  private async recordEvent(
    event: DeliveryRemovalEvent,
    status: EnumDeliveryStatus,
    successful = true
  ): Promise<void> {
    try {
      await this.deliveryEventService.recordRemovalEvent(event, status, successful)
    } catch (error) {
      this.logger.error(`Could not record ${event.type} for delivery ${event.deliveryId}: ${error}`)
    }
  }

  // Step 5: a failed approval, on the record (value 1).
  private async recordMissedApproval(request: DeliveryRemovalRequest, status: EnumDeliveryStatus): Promise<void> {
    await this.recordEvent(
      {
        deliveryId: request.deliveryId,
        type: EnumDeliveryEventType.REMOVAL_APPROVED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: request.courierId,
        message: `Approval did not take: the order changed first (${request.label})`,
      },
      status,
      false
    )
  }

  // Step 5: to OPEN when the same rider still holds the delivery in an ongoing status, otherwise
  // CLOSED. A unique error on `openFor` means a new request was sent meanwhile, so this one is CLOSED.
  private async undoClaim(request: DeliveryRemovalRequest): Promise<void> {
    const delivery = await this.deliveryRepository.findById(request.deliveryId)
    const clearDecision = {
      decidedAt: null,
      decidedByUserId: null,
      payAmount: null,
      payPolicy: null,
      afterPickup: false,
    }
    try {
      if (this.riderHolds(delivery, request.courierId)) {
        await this.removalRequestRepository.updateIfApproved(request.id, {
          status: EnumRemovalRequestStatus.OPEN,
          openFor: request.deliveryId,
          ...clearDecision,
        })
        return
      }
    } catch (error) {
      if (!(error instanceof Error && isUniqueConstraintError(error))) throw error
    }
    await this.removalRequestRepository.updateIfApproved(request.id, {
      status: EnumRemovalRequestStatus.CLOSED,
      openFor: null,
      ...clearDecision,
    })
  }

  // --- The minute sweep (AC-18) -------------------------------------------------------------

  // An approved request not settled yet: completed if the approval reached the trail, otherwise, once
  // it is over 2 minutes old, an approval interrupted by a crash, undone (spec, step 5).
  async sweepApprovedUnsettled(request: DeliveryRemovalRequest, now: Date): Promise<void> {
    if (!request.decidedAt) return
    const onTrail = await this.deliveryEventRepository.hasSuccessfulRemovalApprovedSince(
      request.deliveryId,
      request.decidedAt
    )
    if (onTrail) {
      await this.deliveryEventService.settleRemoval(request.id)
      return
    }
    if (now.getTime() - request.decidedAt.getTime() > TWO_MINUTES_MS) {
      this.logger.error(
        `REMOVAL_APPROVE_INTERRUPTED ${JSON.stringify({ requestId: request.id, deliveryId: request.deliveryId })}`
      )
      await this.undoClaim(request)
    }
  }

  // --- The admin's reasons and list ---------------------------------------------------------

  async listReasons(): Promise<RemovalReason[]> {
    return this.removalRequestRepository.findActiveReasons()
  }

  // `changedByUserId`: the admin, for the settings record (spec 0038, AC-12).
  async createReason(input: RemovalReasonInput, changedByUserId: string | null = null): Promise<RemovalReason> {
    return this.removalRequestRepository.createReason(
      {
        ...this.editableReasonFields(input),
        label: this.cleanLabel(input.label),
      },
      changedByUserId
    )
  }

  // The global validation pipe keeps body fields it has no rule for, so name the ones a reason may
  // change: a body carrying removedAt must not get past the last reason check.
  private editableReasonFields(input: Partial<RemovalReasonInput>): Partial<RemovalReasonInput> {
    const { label, paidToRider, chargedToRestaurant, needsNote, position } = input
    return { label, paidToRider, chargedToRestaurant, needsNote, position }
  }

  async updateReason(
    id: string,
    input: Partial<RemovalReasonInput>,
    changedByUserId: string | null = null
  ): Promise<RemovalReason> {
    const fields = this.editableReasonFields(input)
    const data = fields.label === undefined ? fields : { ...fields, label: this.cleanLabel(fields.label) }
    const reason = await this.removalRequestRepository.updateActiveReason(id, data, changedByUserId)
    if (!reason) throw new NotFoundException('Removal reason not found')
    return reason
  }

  // AC-2: the app always shows at least one reason, so the last one cannot go.
  async removeReason(id: string, changedByUserId: string | null = null): Promise<RemovalReason> {
    const reason = await this.removalRequestRepository.findReasonById(id)
    if (!reason || reason.removedAt) throw new NotFoundException('Removal reason not found')
    if ((await this.removalRequestRepository.countActiveReasons()) <= 1) {
      throw new ConflictException(LAST_REASON_MESSAGE)
    }
    const removed = await this.removalRequestRepository.removeActiveReason(id, changedByUserId)
    if (!removed) throw new NotFoundException('Removal reason not found')
    return removed
  }

  // AC-24. An unknown delivery answers 404, not [] ("no requests" is a different claim).
  async listForDelivery(deliveryId: string): Promise<RemovalRequestForAdmin[]> {
    const delivery = await this.deliveryRepository.findById(deliveryId)
    if (!delivery) throw new DeliveryNotFoundException('Delivery not found')
    return this.removalRequestRepository.findForDelivery(deliveryId)
  }

  private riderHolds(delivery: DeliveryEntity | null, courierId: string): delivery is DeliveryEntity {
    return delivery?.courierId === courierId && DELIVERY_ONGOING_STATUSES.includes(delivery.status)
  }

  private async getRequestOrThrow(id: string): Promise<DeliveryRemovalRequest> {
    const request = await this.removalRequestRepository.findById(id)
    if (!request) throw new NotFoundException('Removal request not found')
    return request
  }

  private cleanLabel(label: string): string {
    const trimmed = label.trim()
    if (trimmed === '') throw new BadRequestException('A reason needs a label.')
    return trimmed
  }
}
