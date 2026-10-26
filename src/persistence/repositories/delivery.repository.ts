import { Injectable } from '@nestjs/common'
import { Delivery, EnumDeliveryEventType, EnumDeliveryStatus, Location, Prisma } from '@prisma/types'

import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { createPaginator } from '../../rest-api/Paginator'
import { IDeliveryRepository } from 'src/domains/delivery/interfaces/IDeliveryRepository'
import { DeliveryWhereArgs } from 'src/domains/delivery/types/delivery-where-args.type'
import { DeliveryWhereUniqueArgs } from 'src/domains/delivery/types/delivery-where-unique-args.type'
import { IDeliveryUpdate } from 'src/domains/delivery/interfaces/IDeliveryUpdate'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { IDeliveryCreate } from 'src/domains/delivery/interfaces/IDeliveryCreate'
import { DeliveryWithLocationsEntity } from 'src/domains/delivery/entities/delivery-with-locations.entity'
import { DeliveryQuoteEntity } from 'src/domains/delivery-quote/entities/delivery-quote.entity'

export type PrismaDeliveryWithLocations = Delivery & {
  pickupLocation: Location | null
  dropoffLocation: Location | null
}

@Injectable()
export class DeliveryRepository extends EntityRepository implements IDeliveryRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async create(input: IDeliveryCreate) {
    const delivery = await this.prisma.delivery.create({
      data: input,
    })

    return this.toDomain(delivery)
  }

  async update(deliveryId: string, input: IDeliveryUpdate) {
    const delivery = await this.prisma.delivery.update({
      where: {
        id: deliveryId,
      },
      data: input,
    })

    return this.toDomain(delivery)
  }

  // A conditional write (spec 0002, "the race rule"): changes the delivery only if it still
  // matches `where` at the moment of writing, and says whether it did. Two paths racing for the
  // same offer (an accept and the expiry job, say) can then never both win: the database runs
  // the check and the write as one step, so exactly one of them gets 1 back.
  async updateIfMatches(
    deliveryId: string,
    where: Prisma.DeliveryWhereInput,
    data: IDeliveryUpdate
  ): Promise<boolean> {
    const result = await this.prisma.delivery.updateMany({
      where: { ...where, id: deliveryId },
      data,
    })

    return result.count === 1
  }

  // Every offer this rider currently holds: still looking for a rider, offered to them, and not
  // yet taken. Automatic and admin offers alike.
  async findOpenOffersForCourier(courierId: string): Promise<DeliveryEntity[]> {
    const deliveries = await this.prisma.delivery.findMany({
      where: {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        courierId: null,
      },
    })

    return this.toDomainMany(deliveries)
  }

  // Deliveries waiting for a rider with nobody offered, the longest waiting first. "Waiting since"
  // is the latest NO_COURIER_AVAILABLE event, which starts the current waiting spell; a delivery
  // with none (it was waiting before spec 0002 shipped) counts from when it was created.
  async findIdsWaitingForCourierOldestFirst(): Promise<string[]> {
    const waiting = await this.prisma.delivery.findMany({
      where: {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      },
      select: { id: true, createdAt: true },
    })
    if (waiting.length === 0) return []

    const waitingSince = await this.findLatestNoCourierAvailableAt(waiting.map((d) => d.id))

    return waiting
      .map((d) => ({ id: d.id, since: waitingSince.get(d.id) ?? d.createdAt }))
      .sort((a, b) => a.since.getTime() - b.since.getTime())
      .map((d) => d.id)
  }

  // deliveryId -> createdAt of that delivery's latest NO_COURIER_AVAILABLE event. Grouped by
  // delivery, never by rider: NO_COURIER_AVAILABLE names no rider (binding value 5).
  async findLatestNoCourierAvailableAt(deliveryIds: string[]): Promise<Map<string, Date>> {
    if (deliveryIds.length === 0) return new Map()

    const rows = await this.prisma.deliveryEvent.groupBy({
      by: ['deliveryId'],
      where: {
        deliveryId: { in: deliveryIds },
        type: EnumDeliveryEventType.NO_COURIER_AVAILABLE,
      },
      _max: { createdAt: true },
    })

    const result = new Map<string, Date>()
    for (const row of rows) {
      if (row._max.createdAt) result.set(row.deliveryId, row._max.createdAt)
    }
    return result
  }

  async findById(deliveryId: string, otherFilters?: DeliveryWhereArgs) {
    const delivery = await this.prisma.delivery.findUnique({
      where: {
        id: deliveryId,
        ...otherFilters,
      } as DeliveryWhereUniqueArgs,
    })

    return delivery ? this.toDomain(delivery) : null
  }

  async findByDeliveryQuoteId(deliveryQuoteId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: {
        deliveryQuoteId: deliveryQuoteId,
      },
    })

    return delivery ? this.toDomain(delivery) : null
  }

  async findByIdOrThrow(deliveryId: string, otherFilters?: DeliveryWhereArgs) {
    const delivery = await this.prisma.delivery.findUniqueOrThrow({
      where: {
        id: deliveryId,
        ...otherFilters,
      } as DeliveryWhereUniqueArgs,
    })

    return this.toDomain(delivery)
  }

  // The delivery plus the quote it was priced from, for the admin price breakdown (spec 0001).
  async findByIdOrThrowWithQuote(deliveryId: string) {
    const delivery = await this.prisma.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
      // The schema names the Delivery -> DeliveryQuote relation `delivery`; it is the quote.
      include: { delivery: true },
    })

    // Split the included quote off, so the delivery entity gets only its own columns.
    const { delivery: quote, ...deliveryFields } = delivery

    return { delivery: this.toDomain(deliveryFields), quote: new DeliveryQuoteEntity(quote) }
  }

  // What the offer card and its push are built from (spec 0003): the delivery, its drop off
  // location and its quote. Only buildOfferCardPayload reads this, and it reads only allowed fields.
  async findOfferCardSourceOrThrow(deliveryId: string) {
    const delivery = await this.prisma.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
      // `delivery` is the schema's name for the Delivery -> DeliveryQuote relation; it is the quote.
      include: { dropoffLocation: true, delivery: true },
    })

    return { delivery, dropoffLocation: delivery.dropoffLocation, quote: delivery.delivery }
  }

  async findByIdOrThrowWithLocations(deliveryId: string, otherFilters?: DeliveryWhereArgs) {
    const delivery = await this.prisma.delivery.findUniqueOrThrow({
      where: {
        id: deliveryId,
        ...otherFilters,
      } as DeliveryWhereUniqueArgs,
      include: {
        pickupLocation: true,
        dropoffLocation: true,
      },
    })

    return new DeliveryWithLocationsEntity(delivery)
  }

  async findManyPaginated(args: DeliveryWhereArgs, page?: number, perPage?: number) {
    const paginator = createPaginator<Delivery, Prisma.DeliveryFindManyArgs, Prisma.DeliveryDelegate>()

    const result = await paginator(
      this.prisma.delivery,
      {
        where: {
          ...args,
        },
        orderBy: { createdAt: 'desc' },
        include: {
          pickupLocation: true,
          dropoffLocation: true,
        },
      },
      { page, perPage }
    )

    return {
      ...result,
      data: result.data.map((d) => new DeliveryWithLocationsEntity(d as PrismaDeliveryWithLocations)),
    }
  }

  private toDomain(data: Delivery) {
    return new DeliveryEntity(data)
  }

  private toDomainMany(data: Delivery[]) {
    return data.map((d) => this.toDomain(d))
  }
}
