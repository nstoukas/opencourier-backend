import { Injectable } from '@nestjs/common'
import { DeliveryEvent, EnumDeliveryEventType, Prisma } from '@prisma/types'

import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { IDeliveryEventRepository } from 'src/domains/delivery-event/interfaces/IDeliveryEventRepository'
import { IDeliveryEventCreateInput } from 'src/domains/delivery-event/interfaces/IDeliveryEventCreateInput'
import { DeliveryEventEntity } from 'src/domains/delivery-event/entities/delivery-event.entity'
import { TAP_FLOOR_EVENT_TYPES } from 'src/domains/delivery-event/utils/occurred-at.util'
import { SPLIT_WINDOW_END, SPLIT_WINDOW_START, WAIT_END_EVENTS } from 'src/domains/delivery/wait-pay'
import { HAND_OVER_EVENTS } from 'src/domains/partner/wait-record'

@Injectable()
export class DeliveryEventRepository extends EntityRepository implements IDeliveryEventRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async create(data: IDeliveryEventCreateInput) {
    // Spec 0054 (AC-4): a Json column takes no plain null, so params are only sent when there are some.
    const { messageParams, ...rest } = data
    const row = { ...rest, ...(messageParams ? { messageParams: messageParams as Prisma.InputJsonValue } : {}) }
    const result = await this.prisma.deliveryEvent.create({ data: row })
    return this.toDomain(result)
  }

  // Tie-break with id: createdAt has millisecond resolution, so id ensures deterministic order if multiple events land in the same millisecond.
  async findManyByDeliveryId(deliveryId: string): Promise<DeliveryEventEntity[]> {
    const rows = await this.prisma.deliveryEvent.findMany({
      where: { deliveryId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return this.toDomainMany(rows)
  }

  // Spec 0033: the steps that start, end or pass on a wait, in time order.
  async findWaitEvents(deliveryId: string) {
    return this.prisma.deliveryEvent.findMany({
      where: {
        deliveryId,
        transitionSuccessful: true,
        type: {
          // Spec 0047 (cross check 2): the split events too, so their minutes are left out of the wait.
          in: [
            EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
            ...WAIT_END_EVENTS,
            ...HAND_OVER_EVENTS,
            ...SPLIT_WINDOW_START,
            ...SPLIT_WINDOW_END,
          ],
        },
      },
      select: { id: true, type: true, occurredAt: true, courierId: true },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    })
  }

  // Spec 0047 (cross check 5): whether this delivery ever had a successful event of this type.
  async hasSuccessfulEvent(deliveryId: string, type: EnumDeliveryEventType): Promise<boolean> {
    const row = await this.prisma.deliveryEvent.findFirst({
      where: { deliveryId, type, transitionSuccessful: true },
      select: { id: true },
    })
    return row !== null
  }

  // Spec 0033: the messages of the wait pay already on record, which name the wait they paid.
  async findWaitPaidMessages(deliveryId: string): Promise<string[]> {
    const rows = await this.prisma.deliveryEvent.findMany({
      where: { deliveryId, type: EnumDeliveryEventType.COURIER_PAID_FOR_WAIT },
      select: { message: true },
    })
    return rows.map((row) => row.message ?? '')
  }

  // Spec 0035: the messages already on record for a kind of event on this delivery. The pay events of
  // a removal name their request in the message, so a retry can tell its own row (as the waits do).
  async findMessagesOfType(deliveryId: string, type: EnumDeliveryEventType): Promise<string[]> {
    const rows = await this.prisma.deliveryEvent.findMany({ where: { deliveryId, type }, select: { message: true } })
    return rows.map((row) => row.message ?? '')
  }

  // Spec 0035: whether an approval saved its REMOVAL_APPROVED on the trail, or was interrupted.
  async hasSuccessfulRemovalApprovedSince(deliveryId: string, since: Date): Promise<boolean> {
    const row = await this.prisma.deliveryEvent.findFirst({
      where: {
        deliveryId,
        type: EnumDeliveryEventType.REMOVAL_APPROVED,
        transitionSuccessful: true,
        createdAt: { gte: since },
      },
      select: { id: true },
    })
    return row !== null
  }

  // Spec 0035 (AC-23): whether this very reassignment's event was saved as successful. The message
  // names the award, so another admin's reassign does not count as this one.
  async hasSuccessfulReassignedWithMessage(deliveryId: string, message: string): Promise<boolean> {
    const row = await this.prisma.deliveryEvent.findFirst({
      where: { deliveryId, type: EnumDeliveryEventType.REASSIGNED, transitionSuccessful: true, message },
      select: { id: true },
    })
    return row !== null
  }

  // When the latest successful job step of this delivery happened (its occurredAt), or null if it has
  // none yet. The floor of the next step's tap time (spec 0009, AC-7). Ordered by occurredAt, not
  // createdAt: a step that waited on the phone arrives after events that happened later.
  async findLatestJobStepOccurredAt(deliveryId: string): Promise<Date | null> {
    const row = await this.prisma.deliveryEvent.findFirst({
      where: { deliveryId, transitionSuccessful: true, type: { in: TAP_FLOOR_EVENT_TYPES } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { occurredAt: true },
    })
    return row ? row.occurredAt : null
  }

  // The newest event of this delivery whose type is one of `types`, or null. Same tie-break as above.
  async findLatestOfTypes(deliveryId: string, types: EnumDeliveryEventType[]): Promise<DeliveryEventEntity | null> {
    const row = await this.prisma.deliveryEvent.findFirst({
      where: { deliveryId, type: { in: types } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    return row ? this.toDomain(row) : null
  }

  // Row 149: the newest ADD_ON_JOINED that named this delivery as the add on (written on the job, so the
  // add on's id is only in the event's values), or null when it never joined a job.
  async findLatestAddOnJoinOf(addOnId: string): Promise<DeliveryEventEntity | null> {
    const row = await this.prisma.deliveryEvent.findFirst({
      where: {
        type: EnumDeliveryEventType.ADD_ON_JOINED,
        // Prisma's JSON filter: the `addOnId` value inside messageParams equals this id.
        messageParams: { path: ['addOnId'], equals: addOnId },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    return row ? this.toDomain(row) : null
  }

  // Row 149: whether the job already records this add on leaving at or after `since` (its join), so one
  // parting is written once however many events follow it.
  async hasAddOnLeftSince(jobId: string, addOnId: string, since: Date): Promise<boolean> {
    const row = await this.prisma.deliveryEvent.findFirst({
      where: {
        deliveryId: jobId,
        type: EnumDeliveryEventType.ADD_ON_LEFT,
        messageParams: { path: ['addOnId'], equals: addOnId },
        createdAt: { gte: since },
      },
      select: { id: true },
    })
    return row !== null
  }

  private toDomain(data: DeliveryEvent) {
    return new DeliveryEventEntity(data)
  }

  private toDomainMany(data: DeliveryEvent[]) {
    return data.map((d) => this.toDomain(d))
  }
}
