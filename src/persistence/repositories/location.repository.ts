import { Injectable } from '@nestjs/common'
import { Location, Prisma } from '@prisma/types'

import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { ILocationRepository } from 'src/domains/location/interfaces/ILocationRepository'
import { LocationEntity } from 'src/domains/location/entities/location.entity'
import { LocationWhereArgs } from 'src/domains/location/types/location-where-args.type'
import { createPaginator } from 'src/rest-api/Paginator'
import { PaginatedResult } from 'src/core/models/Pagination'
import { LocationFindByAddressArgs } from 'src/domains/location/types/location-find-by-address-args.type'
import { ILocationCreate } from 'src/domains/location/interfaces/ILocationCreate'
import { Exact } from 'src/types'
import { ILocationUpdate } from 'src/domains/location/interfaces/ILocationUpdate'

@Injectable()
export class LocationRepository extends EntityRepository implements ILocationRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async findById(locationId: string) {
    const location = await this.prisma.location.findUnique({
      where: {
        id: locationId,
      },
    })

    return location ? this.toDomain(location) : null
  }

  async findByIds(locationIds: string[]) {
    const locations = await this.prisma.location.findMany({
      where: {
        id: {
          in: locationIds,
        },
      },
    })

    return this.toDomainMany(locations)
  }

  async findByIdOrThrow(locationId: string) {
    const location = await this.prisma.location.findUniqueOrThrow({
      where: {
        id: locationId,
      },
    })

    return this.toDomain(location)
  }

  async findByAddress(input: LocationFindByAddressArgs) {
    const addressQueryData: LocationFindByAddressArgs = {}

    if (input.street) {
      addressQueryData.street = input.street
    }
    if (input.latitude) {
      addressQueryData.latitude = input.latitude
    }
    if (input.longitude) {
      addressQueryData.longitude = input.longitude
    }
    if (input.zipCode) {
      addressQueryData.zipCode = input.zipCode
    }
    if (input.state) {
      addressQueryData.state = input.state
    }
    if (input.countryCode) {
      addressQueryData.countryCode = input.countryCode
    }
    if (input.city) {
      addressQueryData.city = input.city
    }

    const location = await this.prisma.location.findFirst({
      where: {
        ...addressQueryData,
      },
    })

    return location ? this.toDomain(location) : null
  }

  async findManyPaginated(
    args: LocationWhereArgs,
    page?: number,
    perPage?: number
  ): Promise<PaginatedResult<LocationEntity>> {
    const paginator = createPaginator<Location, Prisma.LocationFindManyArgs, Prisma.LocationDelegate>()

    const result = await paginator(
      this.prisma.location,
      {
        where: {
          ...args,
        },
        orderBy: { createdAt: 'desc' },
      },
      { page, perPage }
    )

    return {
      ...result,
      data: this.toDomainMany(result.data),
    }
  }

  async create(data: Exact<ILocationCreate>) {
    const location = await this.prisma.location.create({
      data: {
        ...data,
      },
    })

    return this.toDomain(location)
  }

  // Row 166: removes a Location row only if nothing points at it: the one a partner edit made for a point move whose
  // write never landed. The condition is part of the one DELETE, because the database would not stop a plain delete:
  // every foreign key onto Location cascades (a quote, a delivery or a note on it would go too), and a partner's
  // pickup is set to null (Fable review of row 166, major). `findOrCreate` can hand this row to a new quote for the
  // same address and pin, so "made by this edit" is not enough. Answers whether the row was removed.
  async deleteIfUnused(locationId: string): Promise<boolean> {
    const result = await this.prisma.location.deleteMany({
      where: {
        id: locationId,
        // `none: {}`: no row of that relation points here.
        locationNotes: { none: {} },
        pickupDelivery: { none: {} },
        dropoffDelivery: { none: {} },
        pickupDeliveryQuotes: { none: {} },
        dropoffDeliveryQuotes: { none: {} },
        partnerPickups: { none: {} },
      },
    })
    return result.count > 0
  }

  async update(locationId: string, data: Exact<ILocationUpdate>) {
    const location = await this.prisma.location.update({
      where: {
        id: locationId,
      },
      data: {
        ...data,
      },
    })

    return this.toDomain(location)
  }

  private toDomain(data: Location) {
    return new LocationEntity(data)
  }

  private toDomainMany(data: Location[]) {
    return data.map((d) => this.toDomain(d))
  }
}
