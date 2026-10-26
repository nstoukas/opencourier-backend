import { Injectable } from '@nestjs/common'
import { EnumDevicePlatform } from '@prisma/types'

import { MAX_PUSH_DEVICES_PER_COURIER } from '../../constants'
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
  // A rider keeps at most MAX_PUSH_DEVICES_PER_COURIER tokens: this one plus their newest others.
  async upsertForCourier(courierId: string, token: string, platform: EnumDevicePlatform): Promise<void> {
    // `$transaction` with a function runs every query made through `tx` as one database transaction:
    // if any of them fails, none of them is kept.
    await this.prisma.$transaction(async (tx) => {
      await tx.courierDevice.upsert({
        where: { token },
        create: { token, platform, courierId },
        update: { courierId, platform },
      })

      // The rider's other tokens, newest first, skipping the ones they keep. The token just
      // registered is always kept, even when it moved here from another rider with an older
      // createdAt. `id` breaks ties so the order is the same every time.
      const beyondTheCap = await tx.courierDevice.findMany({
        where: { courierId, token: { not: token } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: MAX_PUSH_DEVICES_PER_COURIER - 1,
        select: { id: true },
      })
      if (beyondTheCap.length > 0) {
        await tx.courierDevice.deleteMany({ where: { id: { in: beyondTheCap.map((device) => device.id) } } })
      }
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
