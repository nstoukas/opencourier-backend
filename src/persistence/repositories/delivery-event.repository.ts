import { Injectable } from '@nestjs/common'
import { DeliveryEvent, EnumDeliveryEventType, EnumDeliveryStatus } from '@prisma/types'

import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { IDeliveryEventRepository } from 'src/domains/delivery-event/interfaces/IDeliveryEventRepository'
import { IDeliveryEventCreateInput } from 'src/domains/delivery-event/interfaces/IDeliveryEventCreateInput'
import { DeliveryEventEntity } from 'src/domains/delivery-event/entities/delivery-event.entity'
import { CourierEarningsRow, CourierEarningsDeliveryRow } from 'src/domains/delivery-event/types/earnings-summary.type'
import { TAP_FLOOR_EVENT_TYPES } from 'src/domains/delivery-event/utils/occurred-at.util'
import { WAIT_END_EVENTS } from 'src/domains/delivery/wait-pay'
import { HAND_OVER_EVENTS } from 'src/domains/partner/wait-record'
// Deliberate import direction — do not "fix". Persistence may depend on the domain
// layer (entities, types, pure utils), same as the entity/type imports above; domain
// code never imports from persistence. formatDropoffAddress is the single shared
// address rule, so duplicating it here would let the earnings summary and the
// drill-down render the same delivery's address differently.
import { formatDropoffAddress } from 'src/domains/delivery-event/utils/earnings-summary.util'

@Injectable()
export class DeliveryEventRepository extends EntityRepository implements IDeliveryEventRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async create(data: IDeliveryEventCreateInput) {
    const result = await this.prisma.deliveryEvent.create({ data })
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
          in: [EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, ...WAIT_END_EVENTS, ...HAND_OVER_EVENTS],
        },
      },
      select: { id: true, type: true, occurredAt: true, courierId: true },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    })
  }

  // Spec 0033: the messages of the wait pay already on record, which name the wait they paid.
  async findWaitPaidMessages(deliveryId: string): Promise<string[]> {
    const rows = await this.prisma.deliveryEvent.findMany({
      where: { deliveryId, type: EnumDeliveryEventType.COURIER_PAID_FOR_WAIT },
      select: { message: true },
    })
    return rows.map((row) => row.message ?? '')
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

  // Attribution is by the delivery's *current* courierId. DeliveryEvent.courierId (spec 0002) is
  // set only on OFFERED and OFFER_EXPIRED events, never on DROPPED_OFF, so it is not used here.
  // That remains safe because DROPPED_OFF is terminal in the state machine, so no event can
  // reassign a completed delivery (REASSIGNED is legal only from ongoing statuses); a rider
  // dropped mid-flight is paid via CourierCompensation, summed by the earnings pipeline alongside these rows.
  // The day is the drop off's occurredAt (when the rider tapped Delivered), not when it reached the
  // server, so a step that waited for signal past midnight counts on the day it happened (spec 0009, AC-5).
  async findSuccessfulDropOffRowsForCourier(courierId: string, from: Date, to: Date): Promise<CourierEarningsRow[]> {
    const events = await this.prisma.deliveryEvent.findMany({
      where: {
        transitionSuccessful: true,
        newStatus: EnumDeliveryStatus.DROPPED_OFF,
        occurredAt: {
          gte: from,
          lte: to,
        },
        delivery: {
          is: {
            courierId,
          },
        },
      },
      select: {
        deliveryId: true,
        occurredAt: true,
        delivery: {
          select: {
            totalCompensation: true,
            tips: true,
          },
        },
      },
      orderBy: {
        occurredAt: 'asc',
      },
    })

    return events.map((event) => ({
      deliveryId: event.deliveryId,
      droppedOffAt: event.occurredAt,
      totalCompensation: event.delivery.totalCompensation,
      tips: event.delivery.tips,
    }))
  }

  async findCompletedDeliveryRowsForCourier(
    courierId: string,
    from: Date,
    to: Date
  ): Promise<CourierEarningsDeliveryRow[]> {
    const events = await this.prisma.deliveryEvent.findMany({
      where: {
        transitionSuccessful: true,
        newStatus: EnumDeliveryStatus.DROPPED_OFF,
        occurredAt: {
          gte: from,
          lte: to,
        },
        delivery: {
          is: {
            courierId,
          },
        },
      },
      select: {
        deliveryId: true,
        occurredAt: true,
        delivery: {
          select: {
            totalCompensation: true,
            tips: true,
            pickupBusinessName: true,
            dropoffLocation: {
              select: {
                formattedAddress: true,
                street: true,
                city: true,
                state: true,
              },
            },
          },
        },
      },
      orderBy: {
        occurredAt: 'asc',
      },
    })

    return events.map((event) => this.mapEventToEarningsDeliveryRow(event))
  }

  async findCompletedDeliveryRowForCourierDelivery(
    courierId: string,
    deliveryId: string
  ): Promise<CourierEarningsDeliveryRow | null> {
    const events = await this.prisma.deliveryEvent.findMany({
      where: {
        transitionSuccessful: true,
        newStatus: EnumDeliveryStatus.DROPPED_OFF,
        deliveryId,
        delivery: {
          is: {
            courierId,
          },
        },
      },
      select: {
        deliveryId: true,
        occurredAt: true,
        delivery: {
          select: {
            totalCompensation: true,
            tips: true,
            pickupBusinessName: true,
            dropoffLocation: {
              select: {
                formattedAddress: true,
                street: true,
                city: true,
                state: true,
              },
            },
          },
        },
      },
      orderBy: {
        occurredAt: 'asc',
      },
      take: 1,
    })

    const firstEvent = events[0]
    if (!firstEvent) {
      return null
    }

    return this.mapEventToEarningsDeliveryRow(firstEvent)
  }

  private mapEventToEarningsDeliveryRow(event: {
    deliveryId: string
    occurredAt: Date
    delivery: {
      totalCompensation: number | null
      tips: number
      pickupBusinessName: string
      dropoffLocation: {
        formattedAddress: string | null
        street: string | null
        city: string | null
        state: string | null
      } | null
    }
  }): CourierEarningsDeliveryRow {
    return {
      deliveryId: event.deliveryId,
      droppedOffAt: event.occurredAt,
      totalCompensation: event.delivery.totalCompensation,
      tips: event.delivery.tips,
      pickupBusinessName: event.delivery.pickupBusinessName,
      dropoffAddress: formatDropoffAddress(event.delivery.dropoffLocation),
    }
  }

  private toDomain(data: DeliveryEvent) {
    return new DeliveryEventEntity(data)
  }

  private toDomainMany(data: DeliveryEvent[]) {
    return data.map((d) => this.toDomain(d))
  }
}

