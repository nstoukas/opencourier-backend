import { Injectable } from '@nestjs/common'
import { DeliveryEvent, EnumDeliveryStatus } from '@prisma/types'

import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { IDeliveryEventRepository } from 'src/domains/delivery-event/interfaces/IDeliveryEventRepository'
import { IDeliveryEventCreateInput } from 'src/domains/delivery-event/interfaces/IDeliveryEventCreateInput'
import { DeliveryEventEntity } from 'src/domains/delivery-event/entities/delivery-event.entity'
import { CourierEarningsRow, CourierEarningsDeliveryRow } from 'src/domains/delivery-event/types/earnings-summary.type'
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

  // Attribution is by the delivery's *current* courierId — DeliveryEvent has no courier
  // column. That remains safe because DROPPED_OFF is terminal in the state machine, so no event
  // can reassign a completed delivery (REASSIGNED is legal only from ongoing statuses); a rider
  // dropped mid-flight is paid via CourierCompensation, summed by the earnings pipeline alongside these rows.
  async findSuccessfulDropOffRowsForCourier(courierId: string, from: Date, to: Date): Promise<CourierEarningsRow[]> {
    const events = await this.prisma.deliveryEvent.findMany({
      where: {
        transitionSuccessful: true,
        newStatus: EnumDeliveryStatus.DROPPED_OFF,
        createdAt: {
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
        createdAt: true,
        delivery: {
          select: {
            totalCompensation: true,
            tips: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    })

    return events.map((event) => ({
      deliveryId: event.deliveryId,
      droppedOffAt: event.createdAt,
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
        createdAt: {
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
        createdAt: true,
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
        createdAt: 'asc',
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
        createdAt: true,
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
        createdAt: 'asc',
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
    createdAt: Date
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
      droppedOffAt: event.createdAt,
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

