import { Injectable } from '@nestjs/common'
import { EnumChatSenderKind, EnumDeliveryStatus, Prisma } from '@prisma/types'

import { escapeLikeText } from 'src/rest-api/common/search-fold'
import { isUniqueConstraintError } from 'src/prisma.util'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

// Spec 0034 (chat). One thread per rider or per restaurant: exactly one of these is set.
export type ChatParty = { courierId: string; partnerId?: undefined } | { partnerId: string; courierId?: undefined }

// The senders whose messages dispatch has to read (AC-7). A SYSTEM line is the server repeating a
// rider's report, which already has its own row on the Dispatch board, so it never marks a thread unread.
export const CHAT_UNREAD_SENDER_KINDS: EnumChatSenderKind[] = [EnumChatSenderKind.COURIER, EnumChatSenderKind.PARTNER]

// A delivery is shown in a conversation's header while it is still going (AC-3).
export const CHAT_ENDED_DELIVERY_STATUSES: EnumDeliveryStatus[] = [
  EnumDeliveryStatus.DROPPED_OFF,
  EnumDeliveryStatus.CANCELED,
  EnumDeliveryStatus.FAILED,
]

// Every message is read with its writer's name fields and the delivery's reference, so each audience's
// DTO can pick what it may show. `satisfies` checks the object against Prisma's type without widening it.
export const CHAT_MESSAGE_INCLUDE = {
  senderUser: { select: { username: true, email: true } },
  delivery: { select: { orderReference: true } },
} satisfies Prisma.ChatMessageInclude

export type ChatMessageRow = Prisma.ChatMessageGetPayload<{ include: typeof CHAT_MESSAGE_INCLUDE }>

const THREAD_INCLUDE = {
  courier: { select: { id: true, userId: true, firstName: true, lastName: true, phoneNumber: true, status: true } },
  partner: { select: { id: true, userId: true, name: true, phoneNumber: true } },
} satisfies Prisma.ChatThreadInclude

export type ChatThreadRow = Prisma.ChatThreadGetPayload<{ include: typeof THREAD_INCLUDE }>

export type ChatMessagePage = { before?: string; after?: string }

export const CHAT_PAGE_SIZE = 50

@Injectable()
export class ChatRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async findThreadById(threadId: string): Promise<ChatThreadRow | null> {
    return this.prisma.chatThread.findUnique({ where: { id: threadId }, include: THREAD_INCLUDE })
  }

  async findThreadByParty(party: ChatParty): Promise<ChatThreadRow | null> {
    return this.prisma.chatThread.findUnique({ where: partyWhere(party), include: THREAD_INCLUDE })
  }

  // AC-1 and its invariant: two first messages at once make one thread. An upsert can still lose the
  // race on the unique column, so a unique error means the other request just made it: read that one.
  async findOrCreateThread(party: ChatParty): Promise<ChatThreadRow> {
    try {
      return await this.prisma.chatThread.upsert({
        where: partyWhere(party),
        create: party.courierId ? { courierId: party.courierId } : { partnerId: party.partnerId },
        update: {},
        include: THREAD_INCLUDE,
      })
    } catch (error) {
      if (error instanceof Error && isUniqueConstraintError(error)) {
        const thread = await this.findThreadByParty(party)
        if (thread) return thread
      }
      throw error
    }
  }

  // Saves one message and moves the thread's lastMessageAt forward, in one transaction. A second send
  // with the same clientMessageId (a retry after bad signal, AC-19) makes nothing new: `created` is false
  // and the stored message is returned.
  async createMessage(input: {
    threadId: string
    senderKind: EnumChatSenderKind
    senderUserId: string | null
    body: string
    deliveryId: string | null
    clientMessageId: string | null
  }): Promise<{ message: ChatMessageRow; created: boolean }> {
    if (input.clientMessageId !== null) {
      const existing = await this.findByClientMessageId(input.threadId, input.clientMessageId)
      if (existing) return { message: existing, created: false }
    }
    try {
      const message = await this.prisma.$transaction(async (tx) => {
        const created = await tx.chatMessage.create({ data: input, include: CHAT_MESSAGE_INCLUDE })
        // Only ever forward: two messages saved at once never move it back.
        await tx.chatThread.updateMany({
          where: {
            id: input.threadId,
            OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: created.createdAt } }],
          },
          data: { lastMessageAt: created.createdAt },
        })
        return created
      })
      return { message, created: true }
    } catch (error) {
      // Two retries at once: the other one saved it.
      if (input.clientMessageId !== null && error instanceof Error && isUniqueConstraintError(error)) {
        const existing = await this.findByClientMessageId(input.threadId, input.clientMessageId)
        if (existing) return { message: existing, created: false }
      }
      throw error
    }
  }

  private async findByClientMessageId(threadId: string, clientMessageId: string): Promise<ChatMessageRow | null> {
    return this.prisma.chatMessage.findUnique({
      where: { threadId_clientMessageId: { threadId, clientMessageId } },
      include: CHAT_MESSAGE_INCLUDE,
    })
  }

  // A page of one thread's messages, oldest first, 50 at most. `before` gives the 50 just older than that
  // message, `after` the 50 just newer, neither the newest 50. A cursor that is not in this thread (a
  // message retention removed) is ignored, so the newest page comes back instead of an error.
  async findMessages(threadId: string, page: ChatMessagePage): Promise<ChatMessageRow[]> {
    const cursorId = page.after ?? page.before
    const cursor = cursorId
      ? await this.prisma.chatMessage.findFirst({ where: { id: cursorId, threadId }, select: { id: true, createdAt: true } })
      : null

    if (cursor && page.after) {
      return this.prisma.chatMessage.findMany({
        where: {
          threadId,
          OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: CHAT_PAGE_SIZE,
        include: CHAT_MESSAGE_INCLUDE,
      })
    }

    const newestFirst = await this.prisma.chatMessage.findMany({
      where: {
        threadId,
        ...(cursor && {
          OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: CHAT_PAGE_SIZE,
      include: CHAT_MESSAGE_INCLUDE,
    })
    return newestFirst.reverse()
  }

  // AC-7: read up to the newest message, for every admin. The write is conditional on the stored time
  // being earlier, so two admins opening at once never move it back. Returns the time now stored, and
  // whether this call moved it.
  async markReadByDispatch(threadId: string): Promise<{ dispatchLastReadAt: Date | null; moved: boolean }> {
    const newest = await this.prisma.chatMessage.findFirst({
      where: { threadId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true },
    })
    let moved = false
    if (newest) {
      const result = await this.prisma.chatThread.updateMany({
        where: {
          id: threadId,
          OR: [{ dispatchLastReadAt: null }, { dispatchLastReadAt: { lt: newest.createdAt } }],
        },
        data: { dispatchLastReadAt: newest.createdAt },
      })
      moved = result.count > 0
    }
    const thread = await this.prisma.chatThread.findUnique({ where: { id: threadId }, select: { dispatchLastReadAt: true } })
    return { dispatchLastReadAt: thread?.dispatchLastReadAt ?? null, moved }
  }

  // Every unread thread (AC-7) with the time of its oldest unread message, for the list's Unread tab,
  // the sidebar count and the board's UNREAD_MESSAGE rows (AC-17). Postgres compares the two columns,
  // which Prisma's query builder can't. Only threads someone can see (lastMessageAt set, AC-18).
  async findUnreadThreads(): Promise<{ threadId: string; oldestUnreadAt: Date }[]> {
    return this.prisma.$queryRaw<{ threadId: string; oldestUnreadAt: Date }[]>`
      SELECT t."id" AS "threadId", MIN(m."createdAt") AS "oldestUnreadAt"
      FROM "ChatThread" t
      JOIN "ChatMessage" m ON m."threadId" = t."id"
      WHERE t."lastMessageAt" IS NOT NULL
        AND m."senderKind"::text IN (${Prisma.join(CHAT_UNREAD_SENDER_KINDS)})
        AND (t."dispatchLastReadAt" IS NULL OR m."createdAt" > t."dispatchLastReadAt")
      GROUP BY t."id"`
  }

  // The threads whose rider's name or phone, restaurant's name, or any tagged order matches every folded
  // word (AC-2). Riders and orders match their trigger written `searchFold`; a restaurant has no such
  // column, so its name is folded here with spec 0025's `oc_search_fold`, as the restaurants list does
  // (decision 106.1). Each word is folded and LIKE escaped by the caller's rule before it arrives here,
  // and Prisma's tagged template sends it as a parameter, never as SQL text.
  async findThreadIdsMatching(foldedWords: string[]): Promise<string[]> {
    const conditions = foldedWords.map((word) => {
      const like = '%' + escapeLikeText(word) + '%'
      return Prisma.sql`(c."searchFold" LIKE ${like}
        OR oc_search_fold(p."name") LIKE ${like}
        OR EXISTS (SELECT 1 FROM "ChatMessage" m JOIN "Delivery" d ON d."id" = m."deliveryId"
                   WHERE m."threadId" = t."id" AND d."searchFold" LIKE ${like}))`
    })
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT t."id" FROM "ChatThread" t
      LEFT JOIN "Courier" c ON c."id" = t."courierId"
      LEFT JOIN "Partner" p ON p."id" = t."partnerId"
      WHERE t."lastMessageAt" IS NOT NULL AND ${Prisma.join(conditions, ' AND ')}`
    return rows.map((row) => row.id)
  }

  // One page of the thread list, newest first (AC-2). Threads retention emptied are hidden (AC-18).
  async findThreadPage(input: {
    courierOnly: boolean
    partnerOnly: boolean
    ids: string[] | null
    page: number
  }): Promise<{ threads: ChatThreadRow[]; total: number }> {
    const where: Prisma.ChatThreadWhereInput = {
      lastMessageAt: { not: null },
      ...(input.courierOnly && { courierId: { not: null } }),
      ...(input.partnerOnly && { partnerId: { not: null } }),
      ...(input.ids !== null && { id: { in: input.ids } }),
    }
    const [threads, total] = await Promise.all([
      this.prisma.chatThread.findMany({
        where,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * CHAT_PAGE_SIZE,
        take: CHAT_PAGE_SIZE,
        include: THREAD_INCLUDE,
      }),
      this.prisma.chatThread.count({ where }),
    ])
    return { threads, total }
  }

  // The newest message of each thread, and the newest one tagged with a delivery (the row's linked order).
  async findLastMessages(
    threadIds: string[]
  ): Promise<{ last: Map<string, ChatMessageRow>; lastTagged: Map<string, ChatMessageRow> }> {
    if (threadIds.length === 0) return { last: new Map(), lastTagged: new Map() }
    const [last, lastTagged] = await Promise.all([
      this.prisma.chatMessage.findMany({
        where: { threadId: { in: threadIds } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['threadId'],
        include: CHAT_MESSAGE_INCLUDE,
      }),
      this.prisma.chatMessage.findMany({
        where: { threadId: { in: threadIds }, deliveryId: { not: null } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['threadId'],
        include: CHAT_MESSAGE_INCLUDE,
      }),
    ])
    return {
      last: new Map(last.map((message) => [message.threadId, message])),
      lastTagged: new Map(lastTagged.map((message) => [message.threadId, message])),
    }
  }

  // The deliveries a rider or restaurant has going now (AC-3): the first 5 by age, and how many in all.
  async findActiveDeliveries(
    party: ChatParty
  ): Promise<{ deliveries: { id: string; orderReference: string | null; status: EnumDeliveryStatus }[]; total: number }> {
    const where: Prisma.DeliveryWhereInput = {
      ...(party.courierId ? { courierId: party.courierId } : { partnerId: party.partnerId }),
      status: { notIn: CHAT_ENDED_DELIVERY_STATUSES },
    }
    const [deliveries, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 5,
        select: { id: true, orderReference: true, status: true },
      }),
      this.prisma.delivery.count({ where }),
    ])
    return { deliveries, total }
  }

  // Whether a rider or restaurant exists, and the restaurant's login (AC-15), before an admin opens a thread.
  async findCourierForChat(courierId: string): Promise<{ id: string } | null> {
    return this.prisma.courier.findUnique({ where: { id: courierId }, select: { id: true } })
  }

  async findPartnerForChat(partnerId: string): Promise<{ id: string; userId: string | null } | null> {
    return this.prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true, userId: true } })
  }

  // The delivery a message is tagged with, if it exists, with who it belongs to, so the service can
  // refuse a rider or restaurant tagging another's order (AC-21).
  async findDeliveryOwners(deliveryId: string): Promise<{ courierId: string | null; partnerId: string | null } | null> {
    return this.prisma.delivery.findUnique({ where: { id: deliveryId }, select: { courierId: true, partnerId: true } })
  }

  // AC-18: deletes every message older than the cutoff, then hides the threads left with none. A thread
  // that still has messages keeps its lastMessageAt. Returns how many messages went.
  async deleteMessagesOlderThan(cutoff: Date): Promise<number> {
    const deleted = await this.prisma.chatMessage.deleteMany({ where: { createdAt: { lt: cutoff } } })
    await this.prisma.chatThread.updateMany({
      where: { lastMessageAt: { not: null }, messages: { none: {} } },
      data: { lastMessageAt: null },
    })
    return deleted.count
  }
}

function partyWhere(party: ChatParty): Prisma.ChatThreadWhereUniqueInput {
  return party.courierId ? { courierId: party.courierId } : { partnerId: party.partnerId }
}
