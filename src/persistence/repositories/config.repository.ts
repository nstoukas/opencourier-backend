import { Injectable } from '@nestjs/common'
import { ChatPreset } from 'src/shared-types/config'
import { EntityRepository } from '../EntityRepository'
import { IConfigRepository } from '../../domains/config/interfaces/IConfigRepository'
import { ConfigEntity } from '../../domains/config/entities/config.entity'
import { Config, Prisma } from '@prisma/types'
import { assign } from 'lodash'
import { PrismaService } from '../../services/prisma/prisma.service'
import { ConfigKey } from 'src/shared-types/index'

@Injectable()
export class ConfigRepository extends EntityRepository implements IConfigRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async getByKey(key: ConfigKey) {
    const result = await this.prisma.config.findUniqueOrThrow({
      where: {
        key,
      },
    })
    return assign(this.toDomain(result))
  }

  // `tx`: the transaction to write in (spec 0038, AC-12: a whole settings save is one transaction).
  // Left out, the write stands on its own, as before.
  async saveByKey(
    key: ConfigKey,
    // A list of chat presets (spec 0054) is stored as JSON text, like a list of texts.
    value: string | number | boolean | string[] | ChatPreset[],
    tx: Prisma.TransactionClient = this.prisma
  ) {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)

    const result = await tx.config.upsert({
      where: {
        key,
      },
      create: {
        key,
        value: stringValue,
        type: typeof value,
      },
      update: {
        value: stringValue,
        type: typeof value,
      },
    })
    return this.toDomain(result)
  }

  // Runs `work` in one database transaction: every write made through its `tx` lands, or none does.
  async inTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work)
  }

  private toDomain(data: Config) {
    return new ConfigEntity(data)
  }

  private toDomainMany(data: Config[]) {
    return data.map((d) => this.toDomain(d))
  }
}
