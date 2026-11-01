import { Injectable } from '@nestjs/common'
import { CourierCompensation } from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { isUniqueConstraintError } from 'src/prisma.util'
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

  // The award for a delivery's cancellation, or null (spec 0015).
  async findCancellationAward(deliveryId: string): Promise<CourierCompensation | null> {
    return this.prisma.courierCompensation.findUnique({ where: { cancellationOf: deliveryId } })
  }

  // Writes the cancellation award once. A second writer (the sweep racing the inline award) hits
  // the unique key and gets the row that is already there instead.
  async createCancellationAwardOnce(input: ICourierCompensationCreateInput & { cancellationOf: string }) {
    try {
      return await this.create(input)
    } catch (error) {
      if (error instanceof Error && isUniqueConstraintError(error)) {
        const existing = await this.findCancellationAward(input.cancellationOf)
        if (existing) return existing
      }
      throw error
    }
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
        // The kind of award, so earnings can tell a cancelled job from a reassignment (spec 0015).
        reason: true,
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
        // The kind of award, so earnings can tell a cancelled job from a reassignment (spec 0015).
        reason: true,
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
      reason: r.reason,
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
        // The kind of award, so earnings can tell a cancelled job from a reassignment (spec 0015).
        reason: true,
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
      reason: r.reason,
      createdAt: r.createdAt,
      pickupBusinessName: r.delivery.pickupBusinessName,
      dropoffLocation: r.delivery.dropoffLocation,
    }))
  }
}
