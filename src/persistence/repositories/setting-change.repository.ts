import { Injectable } from '@nestjs/common'
import { Prisma, SettingChange } from '@prisma/types'
import { buildPagination } from 'src/rest-api/Paginator'
import { PaginatedResult } from 'src/core/models/Pagination'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

// The key a removal reason's change is recorded under, and a shift slot's (spec 0038, AC-12).
// Every other SettingChange key is a ConfigKey value.
export {
  REMOVAL_REASON_KEY as REMOVAL_REASON_SETTING_KEY,
  SHIFT_SLOT_KEY as SHIFT_SLOT_SETTING_KEY,
} from 'src/shared-types/rider-facing-settings'

export type SettingChangeInput = {
  key: string
  // The removal reason's or shift slot's id; left out for a Config key.
  subject?: string | null
  // The value in effect before the save; null on a create.
  oldValue: unknown
  // The value after it; null on a removal.
  newValue: unknown
  // The admin who saved it. Null only when an admin is later deleted (onDelete: SetNull).
  changedByUserId: string | null
}

// What the admin Change history reads besides the row: who saved it (spec 0038, AC-13).
const CHANGED_BY_INCLUDE = {
  changedBy: { select: { id: true, email: true, username: true } },
} satisfies Prisma.SettingChangeInclude

export type SettingChangeWithAdmin = Prisma.SettingChangeGetPayload<{ include: typeof CHANGED_BY_INCLUDE }>

// A JSON column cannot hold `undefined`, and an SQL NULL must be written as Prisma.DbNull
// (a plain null would be refused for a nullable Json column).
function toJsonColumn(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) return Prisma.DbNull
  return value as Prisma.InputJsonValue
}

// Writes one SettingChange row through the caller's transaction, so the row and the value it
// records are written together or not at all (spec 0038, AC-12). A plain function rather than a
// repository method: the config save, the removal reasons and the shift slots each call it from
// inside their own transaction.
export async function writeSettingChange(tx: Prisma.TransactionClient, input: SettingChangeInput): Promise<void> {
  await tx.settingChange.create({
    data: {
      key: input.key,
      subject: input.subject ?? null,
      oldValue: toJsonColumn(input.oldValue),
      newValue: toJsonColumn(input.newValue),
      changedByUserId: input.changedByUserId,
    },
  })
}

// Spec 0038: the record of every settings change, read newest first. Riders read only the keys
// that affect their work, and never who made a change; admins read every change with the person.
@Injectable()
export class SettingChangeRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  // `keys` limits the list to those keys (the rider facing list); left out, every change.
  async findPage(
    options: { keys?: string[]; page?: number; perPage?: number }
  ): Promise<PaginatedResult<SettingChangeWithAdmin>> {
    const page = options.page ?? 1
    const perPage = options.perPage ?? 20
    const where: Prisma.SettingChangeWhereInput = options.keys ? { key: { in: options.keys } } : {}
    const [total, data] = await Promise.all([
      this.prisma.settingChange.count({ where }),
      this.prisma.settingChange.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: CHANGED_BY_INCLUDE,
        take: perPage,
        skip: (page - 1) * perPage,
      }),
    ])
    return { data, pagination: buildPagination(total, page, perPage, data.length) }
  }

  // The first row's time, for "Recorded since <date>" on the admin page. Null while none exists.
  async findOldest(): Promise<SettingChange | null> {
    return this.prisma.settingChange.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  }
}
