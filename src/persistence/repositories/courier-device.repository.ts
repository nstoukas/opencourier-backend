import { Injectable } from '@nestjs/common'
import { EnumDevicePlatform } from '@prisma/types'

import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

// The push tokens of riders' phones (spec 0003). Only ever "which tokens reach this rider": nothing
// here records when a push was sent, delivered, opened or answered (AC-13, value 5).
@Injectable()
export class CourierDeviceRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  // Registers a token for this rider. The token is unique, so if another rider had it (the same
  // phone, logged in as someone else) the row moves to this rider instead of being duplicated
  // (AC-1). Prisma runs this as one INSERT ... ON CONFLICT, so two logins at once cannot both insert.
  async upsertForCourier(courierId: string, token: string, platform: EnumDevicePlatform): Promise<void> {
    await this.prisma.courierDevice.upsert({
      where: { token },
      create: { token, platform, courierId },
      update: { courierId, platform },
    })
  }

  // Deletes a token only if it belongs to this rider, so a rider can never unregister someone
  // else's phone. Deleting a token that is not there is not an error (the endpoint answers 204).
  async deleteForCourier(courierId: string, token: string): Promise<void> {
    await this.prisma.courierDevice.deleteMany({ where: { token, courierId } })
  }

  async findTokensForCourier(courierId: string): Promise<string[]> {
    const devices = await this.prisma.courierDevice.findMany({
      where: { courierId },
      select: { token: true },
    })
    return devices.map((device) => device.token)
  }

  // Tokens FCM reported as no longer registered (the app was uninstalled, or its data cleared).
  async deleteByTokens(tokens: string[]): Promise<number> {
    if (tokens.length === 0) return 0
    const result = await this.prisma.courierDevice.deleteMany({ where: { token: { in: tokens } } })
    return result.count
  }
}
