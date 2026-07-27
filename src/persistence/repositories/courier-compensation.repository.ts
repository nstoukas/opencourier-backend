import { Injectable } from '@nestjs/common'
import { CourierCompensation } from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import {
  ICourierCompensationRepository,
  ICourierCompensationCreateInput,
} from 'src/domains/delivery-event/interfaces/ICourierCompensationRepository'
import {
  CourierCompensationRow,
  CourierCompensationDeliveryRow,
} from 'src/domains/delivery-event/types/earnings-summary.type'

@Injectable()
export class CourierCompensationRepository
  extends EntityRepository
  implements ICourierCompensationRepository
{
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async create(input: ICourierCompensationCreateInput): Promise<CourierCompensation> {
    return this.prisma.courierCompensation.create({
      data: input,
    })
  }

  // Used only to undo an award that was written moments earlier for a reassignment that
  // then did not take effect. Prisma throws P2025 if the row is already gone; the caller
  // catches that and logs it rather than failing the request.
  async deleteById(id: string): Promise<void> {
    await this.prisma.courierCompensation.delete({
      where: { id },
    })
  }

  async findRowsForCourierEarnings(
    courierId: string,
    from: Date,
    to: Date
  ): Promise<CourierCompensationRow[]> {
    const rows = await this.prisma.courierCompensation.findMany({
      where: {
        courierId,
        createdAt: {
          gte: from,
          lte: to,
        },
      },
      select: {
        deliveryId: true,
        amount: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    })
    return rows
  }

  async findDetailedRowsForCourierDay(
    courierId: string,
    from: Date,
    to: Date
  ): Promise<CourierCompensationDeliveryRow[]> {
    const rows = await this.prisma.courierCompensation.findMany({
      where: {
        courierId,
        createdAt: {
          gte: from,
          lte: to,
        },
      },
      select: {
        deliveryId: true,
        amount: true,
        createdAt: true,
        delivery: {
          select: {
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

    return rows.map((r) => ({
      deliveryId: r.deliveryId,
      amount: r.amount,
      createdAt: r.createdAt,
      pickupBusinessName: r.delivery.pickupBusinessName,
      dropoffLocation: r.delivery.dropoffLocation,
    }))
  }

  async findDetailedRowsForCourierDelivery(
    courierId: string,
    deliveryId: string
  ): Promise<CourierCompensationDeliveryRow[]> {
    const rows = await this.prisma.courierCompensation.findMany({
      where: {
        courierId,
        deliveryId,
      },
      select: {
        deliveryId: true,
        amount: true,
        createdAt: true,
        delivery: {
          select: {
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

    return rows.map((r) => ({
      deliveryId: r.deliveryId,
      amount: r.amount,
      createdAt: r.createdAt,
      pickupBusinessName: r.delivery.pickupBusinessName,
      dropoffLocation: r.delivery.dropoffLocation,
    }))
  }
}
