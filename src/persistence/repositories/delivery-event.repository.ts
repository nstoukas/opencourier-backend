import { Injectable } from '@nestjs/common'
import { DeliveryEvent, EnumDeliveryStatus } from '@prisma/types'

import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { IDeliveryEventRepository } from 'src/domains/delivery-event/interfaces/IDeliveryEventRepository'
import { IDeliveryEventCreateInput } from 'src/domains/delivery-event/interfaces/IDeliveryEventCreateInput'
import { DeliveryEventEntity } from 'src/domains/delivery-event/entities/delivery-event.entity'
import { CourierEarningsRow } from 'src/domains/delivery-event/types/earnings-summary.type'

@Injectable()
export class DeliveryEventRepository extends EntityRepository implements IDeliveryEventRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async create(data: IDeliveryEventCreateInput) {
    const result = await this.prisma.deliveryEvent.create({ data })
    return this.toDomain(result)
  }

  // Attribution is by the delivery's *current* courierId — DeliveryEvent has no courier
  // column. That is safe because DROPPED_OFF is terminal in the state machine, so no event
  // can reassign a completed delivery; a direct write to Delivery.courierId would, though.
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

  private toDomain(data: DeliveryEvent) {
    return new DeliveryEventEntity(data)
  }

  private toDomainMany(data: DeliveryEvent[]) {
    return data.map((d) => this.toDomain(d))
  }
}
