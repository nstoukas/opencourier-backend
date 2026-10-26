import { Injectable } from '@nestjs/common'
import { Prisma, SavedCustomer } from '@prisma/types'

import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

// What a restaurant can set on a saved customer (spec 0005). Already checked and normalised by
// SavedCustomerDomainService: the phone is E.164, empty optional texts are null.
export type SavedCustomerFields = {
  name: string
  phone: string
  notes: string | null
  addressLine1: string
  addressLine2: string | null
  city: string
  zipCode: string | null
  latitude: number
  longitude: number
  formattedAddress: string | null
}

// Every query here is scoped to one restaurant (`partnerId` in the WHERE), so a restaurant can
// never read or change another's customers: a miss looks exactly like an unknown id (AC-5).
@Injectable()
export class SavedCustomerRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  // A page of the restaurant's customers, most recently used first. `search` matches the name
  // anywhere (case insensitive), or, when it holds 2 or more digits, the phone's digits.
  async list(
    partnerId: string,
    search: string | null,
    page: number,
    perPage: number
  ): Promise<{ items: SavedCustomer[]; total: number }> {
    const where: Prisma.SavedCustomerWhereInput = { partnerId }
    if (search !== null) {
      const digits = search.replace(/\D/g, '')
      where.OR = [
        // Prisma's `contains` does not escape LIKE wildcards (checked on 2026-10-26: a search for
        // "%" matched every name), so they are escaped here, or "%" would list everyone.
        { name: { contains: escapeLikePattern(search), mode: 'insensitive' } },
        // A stored phone is "+" and digits only, so its digits contain the typed ones exactly when
        // the phone contains them. A search with no digits never matches by phone.
        ...(digits.length >= 2 ? [{ phone: { contains: digits } }] : []),
      ]
    }

    // `$transaction([...])` with a list runs both reads in one transaction, so the count and the
    // page agree with each other.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.savedCustomer.findMany({
        where,
        // `id` breaks ties, so paging never shows a customer twice or skips one.
        orderBy: [{ lastUsedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.savedCustomer.count({ where }),
    ])
    return { items, total }
  }

  async findOwned(partnerId: string, id: string): Promise<SavedCustomer | null> {
    return this.prisma.savedCustomer.findFirst({ where: { id, partnerId } })
  }

  async findIdByPhone(partnerId: string, phone: string): Promise<string | null> {
    // `partnerId_phone` is the name Prisma gives the compound unique (partnerId, phone).
    const found = await this.prisma.savedCustomer.findUnique({
      where: { partnerId_phone: { partnerId, phone } },
      select: { id: true },
    })
    return found?.id ?? null
  }

  // A new customer. Throws Prisma's unique error (P2002) when the restaurant already has this phone.
  async create(partnerId: string, fields: SavedCustomerFields): Promise<SavedCustomer> {
    return this.prisma.savedCustomer.create({ data: { ...fields, partnerId } })
  }

  // Saves a customer from an order: a new one, or the one with this phone updated (AC-1, AC-4).
  // Prisma runs the upsert as one INSERT ... ON CONFLICT ("partnerId","phone") DO UPDATE (checked on
  // 2026-10-26 with query logging), so two orders saving the same new phone at once end as one
  // customer, and both succeed.
  async upsertByPhone(
    partnerId: string,
    fields: SavedCustomerFields,
    markUsed: boolean
  ): Promise<{ customer: SavedCustomer; created: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      // Only to answer `created`. In a race both callers can read "none" and both report created;
      // the table still ends with one row.
      const existing = await tx.savedCustomer.findUnique({
        where: { partnerId_phone: { partnerId, phone: fields.phone } },
        select: { id: true },
      })
      const saved = await tx.savedCustomer.upsert({
        where: { partnerId_phone: { partnerId, phone: fields.phone } },
        create: { ...fields, partnerId },
        update: fields,
      })
      const customer = markUsed ? await markUsedInTransaction(tx, partnerId, saved.id) : saved
      return { customer: customer ?? saved, created: existing === null }
    })
  }

  // Changes the fields given (undefined = leave as is). Null when the id is not this restaurant's.
  // Throws Prisma's unique error (P2002) when the new phone is another customer's.
  async update(
    partnerId: string,
    id: string,
    fields: Partial<SavedCustomerFields>,
    markUsed: boolean
  ): Promise<SavedCustomer | null> {
    return this.prisma.$transaction(async (tx) => {
      // updateMany, not update: it takes a non-unique WHERE, so ownership is part of the write.
      const { count } = await tx.savedCustomer.updateMany({ where: { id, partnerId }, data: fields })
      if (count === 0) {
        return null
      }
      if (markUsed) {
        return markUsedInTransaction(tx, partnerId, id)
      }
      return tx.savedCustomer.findFirst({ where: { id, partnerId } })
    })
  }

  // An order used this customer. False when the id is not this restaurant's.
  async markUsed(partnerId: string, id: string): Promise<boolean> {
    const changed = await this.prisma.$executeRaw`
      UPDATE "SavedCustomer"
      SET "lastUsedAt" = GREATEST("lastUsedAt", now() AT TIME ZONE 'UTC')
      WHERE "id" = ${id} AND "partnerId" = ${partnerId}`
    return changed > 0
  }

  // A real delete: the row holds the address too, so nothing about the customer is left (AC-2).
  // Past deliveries keep their own copy and are not touched. False when the id is not this restaurant's.
  async delete(partnerId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.savedCustomer.deleteMany({ where: { id, partnerId } })
    return count > 0
  }

  // The retention rule (AC-7): deletes every customer nobody has ordered for in `months` months, in
  // one statement, so a customer used while it runs is judged on its new date and survives.
  async deleteUnusedForMonths(months: number): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM "SavedCustomer"
      WHERE "lastUsedAt" < (now() AT TIME ZONE 'UTC') - make_interval(months => ${months}::int)`
  }
}

// `lastUsedAt` only ever moves forward (GREATEST), even if two writes land out of order.
// The column is a timestamp without time zone holding UTC, as Prisma writes it, hence AT TIME ZONE.
// Returns the row as it now is, or null if it is not this restaurant's.
async function markUsedInTransaction(
  tx: Prisma.TransactionClient,
  partnerId: string,
  id: string
): Promise<SavedCustomer | null> {
  await tx.$executeRaw`
    UPDATE "SavedCustomer"
    SET "lastUsedAt" = GREATEST("lastUsedAt", now() AT TIME ZONE 'UTC')
    WHERE "id" = ${id} AND "partnerId" = ${partnerId}`
  return tx.savedCustomer.findFirst({ where: { id, partnerId } })
}

// Makes `%`, `_` and `\` match themselves in a LIKE pattern (backslash is PostgreSQL's default
// escape character). Exported for the tests.
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`)
}
