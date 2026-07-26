import { Injectable } from '@nestjs/common'
import { EnumUserRole, Location, Partner, Prisma } from '@prisma/types'
import * as errors from 'src/errors'

import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import {
  IPartnerCreate,
  IPartnerCreateWithLogin,
  IPartnerRepository,
  IPartnerUpdate,
} from 'src/domains/partner/interfaces/IPartnerRepository'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { createPaginator } from '../../rest-api/Paginator'
import { Exact } from 'src/types'

@Injectable()
export class PartnerRepository extends EntityRepository implements IPartnerRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async findById(partnerId: string) {
    const result = await this.prisma.partner.findUnique({
      where: {
        id: partnerId,
      },
    })

    return result ? this.toDomain(result) : null
  }

  async findByIdOrThrow(partnerId: string) {
    const result = await this.prisma.partner.findUniqueOrThrow({
      where: {
        id: partnerId,
      },
      include: {
        user: { select: { email: true } },
        pickupLocation: true,
      },
    })

    return this.toDomain(result)
  }

  async findByUserIdOrThrow(userId: string) {
    const result = await this.prisma.partner.findFirstOrThrow({
      where: {
        userId,
      },
    })

    return this.toDomain(result)
  }

  async findFirst() {
    const result = await this.prisma.partner.findFirst()
    return result ? this.toDomain(result) : null
  }

  async findManyPaginated(page?: number, perPage?: number) {
    const paginator = createPaginator<Partner, Prisma.PartnerFindManyArgs, Prisma.PartnerDelegate>()
    const result = await paginator(
      this.prisma.partner,
      {
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { email: true } },
          pickupLocation: true,
        },
      },
      { page, perPage },
    )

    return {
      ...result,
      data: this.toDomainMany(result.data),
    }
  }

  // Nested write: Prisma wraps User and Partner creation in a single implicit transaction — either both are created or neither is.
  async createWithLogin(data: IPartnerCreateWithLogin) {
    const user = await this.prisma.user.create({
      data: {
        email: data.login.email,
        password: data.login.hashedPassword,
        role: [EnumUserRole.PARTNER],
        apiKey: data.login.apiKey,
        partner: {
          create: {
            name: data.name,
            phoneNumber: data.phoneNumber ?? null,
            pickupLocationId: data.pickupLocationId ?? null,
          },
        },
      },
      include: {
        partner: {
          include: {
            user: { select: { email: true } },
            pickupLocation: true,
          },
        },
      },
    })

    if (!user.partner) {
      throw new errors.InternalServerError('Failed to create partner record')
    }

    return this.toDomain(user.partner)
  }

  async update(partnerId: string, data: Exact<IPartnerUpdate>) {
    const result = await this.prisma.partner.update({
      where: { id: partnerId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.phoneNumber !== undefined && { phoneNumber: data.phoneNumber }),
        ...(data.logo !== undefined && { logo: data.logo }),
        ...(data.webhookUrl !== undefined && { webhookUrl: data.webhookUrl }),
        ...(data.pickupLocationId !== undefined && { pickupLocationId: data.pickupLocationId }),
      },
      include: {
        user: { select: { email: true } },
        pickupLocation: true,
      },
    })

    return this.toDomain(result)
  }

  async create(data: IPartnerCreate) {
    const result = await this.prisma.partner.create({
      data: {
        name: data.name,
        userId: data.userId,
        logo: data.logo ?? null,
        phoneNumber: data.phoneNumber ?? null,
        webhookUrl: data.webhookUrl ?? null,
        pickupLocationId: data.pickupLocationId ?? null,
      },
    })

    return this.toDomain(result)
  }

  private toDomain(
    data: Partner & {
      user?: { email: string | null } | null
      pickupLocation?: Location | null
    },
  ) {
    return new PartnerEntity(data)
  }

  private toDomainMany(
    data: (Partner & {
      user?: { email: string | null } | null
      pickupLocation?: Location | null
    })[],
  ) {
    return data.map((d) => this.toDomain(d))
  }
}
