import * as fs from 'fs'
import * as path from 'path'
import { EnumChatSenderKind, Prisma } from '@prisma/types'
import { PRISMA_UNIQUE_CONSTRAINT_ERROR } from 'src/prisma.util'
import { PrismaService } from '../../services/prisma/prisma.service'
import {
  ChatParty,
  ChatRepository,
  CHAT_UNREAD_SENDER_KINDS,
  CHAT_PAGE_SIZE,
} from './chat.repository'

describe('ChatRepository (spec 0034, AC-1, AC-7, AC-18, AC-19, AC-20)', () => {
  let repository: ChatRepository
  let mockPrisma: any

  const createUniqueError = () => {
    const error = new Error('Unique constraint failed')
    error.name = 'PrismaClientKnownRequestError'
    ;(error as any).code = PRISMA_UNIQUE_CONSTRAINT_ERROR
    return error
  }

  const sampleThread = {
    id: 'thread-1',
    courierId: 'courier-1',
    partnerId: null,
    lastMessageAt: new Date('2026-11-17T10:00:00.000Z'),
    dispatchLastReadAt: new Date('2026-11-17T09:00:00.000Z'),
    createdAt: new Date('2026-11-17T08:00:00.000Z'),
    courier: {
      id: 'courier-1',
      userId: 'user-c1',
      firstName: 'Nikos',
      lastName: 'Papas',
      phoneNumber: '+306912345678',
      status: 'ONLINE',
    },
    partner: null,
  }

  const sampleMessage = {
    id: 'msg-1',
    threadId: 'thread-1',
    senderKind: EnumChatSenderKind.COURIER,
    senderUserId: 'user-c1',
    body: 'Hello dispatch',
    deliveryId: null,
    clientMessageId: 'client-uuid-1',
    createdAt: new Date('2026-11-17T10:00:00.000Z'),
    senderUser: { username: 'nikos_c', email: 'nikos@example.com' },
    delivery: null,
  }

  beforeEach(() => {
    mockPrisma = {
      chatThread: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      chatMessage: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      courier: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      partner: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      delivery: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      deliveryEvent: {
        create: jest.fn(),
      },
      deliveryQuote: {
        create: jest.fn(),
      },
      courierCompensation: {
        create: jest.fn(),
      },
      partnerCharge: {
        create: jest.fn(),
      },
      user: {
        update: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => cb(mockPrisma)),
      $queryRaw: jest.fn(),
    }

    repository = new ChatRepository(mockPrisma as unknown as PrismaService)
  })

  describe('AC-1: thread creation, races, and migration CHECK invariant', () => {
    test('migration SQL text contains the CHECK constraint making exactly one party set', () => {
      const migrationPath = path.join(
        __dirname,
        '../../../prisma/migrations/20261117120000_add_chat/migration.sql'
      )
      const sql = fs.readFileSync(migrationPath, 'utf8')
      expect(sql).toContain('CHECK (num_nonnulls("courierId", "partnerId") = 1)')
    })

    test('findOrCreateThread creates a thread via upsert', async () => {
      mockPrisma.chatThread.upsert.mockResolvedValue(sampleThread)

      const party: ChatParty = { courierId: 'courier-1' }
      const result = await repository.findOrCreateThread(party)

      expect(mockPrisma.chatThread.upsert).toHaveBeenCalledWith({
        where: { courierId: 'courier-1' },
        create: { courierId: 'courier-1' },
        update: {},
        include: expect.any(Object),
      })
      expect(result).toBe(sampleThread)
    })

    test('findOrCreateThread creates a thread via upsert for a restaurant (partnerId)', async () => {
      const partnerThread = { ...sampleThread, id: 'thread-p1', courierId: null, partnerId: 'partner-1' }
      mockPrisma.chatThread.upsert.mockResolvedValue(partnerThread)

      const party: ChatParty = { partnerId: 'partner-1' }
      const result = await repository.findOrCreateThread(party)

      expect(mockPrisma.chatThread.upsert).toHaveBeenCalledWith({
        where: { partnerId: 'partner-1' },
        create: { partnerId: 'partner-1' },
        update: {},
        include: expect.any(Object),
      })
      expect(result).toBe(partnerThread)
    })

    test('findOrCreateThread handles race: on unique constraint error, reads the winner thread', async () => {
      mockPrisma.chatThread.upsert.mockRejectedValueOnce(createUniqueError())
      mockPrisma.chatThread.findUnique.mockResolvedValueOnce(sampleThread)

      const party: ChatParty = { courierId: 'courier-1' }
      const result = await repository.findOrCreateThread(party)

      expect(mockPrisma.chatThread.findUnique).toHaveBeenCalledWith({
        where: { courierId: 'courier-1' },
        include: expect.any(Object),
      })
      expect(result).toBe(sampleThread)
    })
  })

  describe('AC-7: markReadByDispatch moves forward only, and unread excludes SYSTEM lines', () => {
    test('findUnreadThreads executes queryRaw and returns unread threads', async () => {
      const unreadRow = { threadId: 'thread-1', oldestUnreadAt: new Date('2026-11-17T09:30:00.000Z') }
      mockPrisma.$queryRaw.mockResolvedValueOnce([unreadRow])

      const result = await repository.findUnreadThreads()

      expect(mockPrisma.$queryRaw).toHaveBeenCalled()
      expect(result).toEqual([unreadRow])
    })
    test('markReadByDispatch updates dispatchLastReadAt with conditional write (only lt newest.createdAt)', async () => {
      const newestDate = new Date('2026-11-17T11:30:00.000Z')
      mockPrisma.chatMessage.findFirst.mockResolvedValue({ createdAt: newestDate })
      mockPrisma.chatThread.updateMany.mockResolvedValue({ count: 1 })
      mockPrisma.chatThread.findUnique.mockResolvedValue({ dispatchLastReadAt: newestDate })

      const result = await repository.markReadByDispatch('thread-1')

      expect(mockPrisma.chatThread.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'thread-1',
          OR: [{ dispatchLastReadAt: null }, { dispatchLastReadAt: { lt: newestDate } }],
        },
        data: { dispatchLastReadAt: newestDate },
      })
      expect(result).toEqual({ dispatchLastReadAt: newestDate, moved: true })
    })

    test('markReadByDispatch reports moved: false when update count is 0 (stored time was already newer or equal)', async () => {
      const newestDate = new Date('2026-11-17T11:00:00.000Z')
      const storedLaterDate = new Date('2026-11-17T11:15:00.000Z')
      mockPrisma.chatMessage.findFirst.mockResolvedValue({ createdAt: newestDate })
      mockPrisma.chatThread.updateMany.mockResolvedValue({ count: 0 })
      mockPrisma.chatThread.findUnique.mockResolvedValue({ dispatchLastReadAt: storedLaterDate })

      const result = await repository.markReadByDispatch('thread-1')

      expect(result).toEqual({ dispatchLastReadAt: storedLaterDate, moved: false })
    })

    test('CHAT_UNREAD_SENDER_KINDS contains only COURIER and PARTNER, excluding SYSTEM and DISPATCH (decision 111.2)', () => {
      expect(CHAT_UNREAD_SENDER_KINDS).toEqual([
        EnumChatSenderKind.COURIER,
        EnumChatSenderKind.PARTNER,
      ])
      expect(CHAT_UNREAD_SENDER_KINDS).not.toContain(EnumChatSenderKind.SYSTEM)
      expect(CHAT_UNREAD_SENDER_KINDS).not.toContain(EnumChatSenderKind.DISPATCH)
    })
  })

  describe('AC-18: deleteMessagesOlderThan and clearing empty threads', () => {
    test('deletes messages with createdAt < cutoff and clears lastMessageAt only for threads with no messages', async () => {
      const cutoff = new Date('2026-08-19T00:00:00.000Z')
      mockPrisma.chatMessage.deleteMany.mockResolvedValue({ count: 42 })
      mockPrisma.chatThread.updateMany.mockResolvedValue({ count: 5 })

      const count = await repository.deleteMessagesOlderThan(cutoff)

      expect(mockPrisma.chatMessage.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: cutoff } },
      })
      expect(mockPrisma.chatThread.updateMany).toHaveBeenCalledWith({
        where: { lastMessageAt: { not: null }, messages: { none: {} } },
        data: { lastMessageAt: null },
      })
      expect(count).toBe(42)
    })
  })

  describe('AC-19: clientMessageId idempotency and race handling', () => {
    test('returns existing message with created: false when clientMessageId already stored', async () => {
      mockPrisma.chatMessage.findUnique.mockResolvedValue(sampleMessage)

      const result = await repository.createMessage({
        threadId: 'thread-1',
        senderKind: EnumChatSenderKind.COURIER,
        senderUserId: 'user-c1',
        body: 'Hello dispatch',
        deliveryId: null,
        clientMessageId: 'client-uuid-1',
      })

      expect(result).toEqual({ message: sampleMessage, created: false })
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    test('two sends at once: on unique error inside transaction, returns stored message with created: false', async () => {
      // First check returns null (neither is committed yet)
      mockPrisma.chatMessage.findUnique.mockResolvedValueOnce(null)
      // Transaction throws unique constraint error (the other request just committed)
      mockPrisma.$transaction.mockRejectedValueOnce(createUniqueError())
      // Catch block finds the newly committed message
      mockPrisma.chatMessage.findUnique.mockResolvedValueOnce(sampleMessage)

      const result = await repository.createMessage({
        threadId: 'thread-1',
        senderKind: EnumChatSenderKind.COURIER,
        senderUserId: 'user-c1',
        body: 'Hello dispatch',
        deliveryId: null,
        clientMessageId: 'client-uuid-1',
      })

      expect(result).toEqual({ message: sampleMessage, created: false })
    })
  })

  describe('AC-20: repository write boundaries (touches only chatThread and chatMessage)', () => {
    test('chat writes touch only chatThread and chatMessage tables', async () => {
      mockPrisma.chatThread.upsert.mockResolvedValue(sampleThread)
      await repository.findOrCreateThread({ courierId: 'courier-1' })

      mockPrisma.chatMessage.findUnique.mockResolvedValue(null)
      mockPrisma.chatMessage.create.mockResolvedValue(sampleMessage)
      mockPrisma.chatThread.updateMany.mockResolvedValue({ count: 1 })
      await repository.createMessage({
        threadId: 'thread-1',
        senderKind: EnumChatSenderKind.COURIER,
        senderUserId: 'user-c1',
        body: 'msg',
        deliveryId: null,
        clientMessageId: 'id-1',
      })

      mockPrisma.chatMessage.findFirst.mockResolvedValue({ createdAt: new Date() })
      await repository.markReadByDispatch('thread-1')

      mockPrisma.chatMessage.deleteMany.mockResolvedValue({ count: 0 })
      await repository.deleteMessagesOlderThan(new Date())

      const forbiddenWriteModels = [
        'delivery',
        'deliveryEvent',
        'deliveryQuote',
        'courierCompensation',
        'partnerCharge',
        'courier',
        'partner',
        'user',
      ]

      for (const model of forbiddenWriteModels) {
        if (mockPrisma[model]) {
          for (const method of ['create', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']) {
            if (mockPrisma[model][method]) {
              expect(mockPrisma[model][method]).not.toHaveBeenCalled()
            }
          }
        }
      }
    })
  })

  describe('findByClientMessageId (AC-19)', () => {
    test('looks up message by compound unique threadId_clientMessageId', async () => {
      mockPrisma.chatMessage.findUnique.mockResolvedValue(sampleMessage)

      const result = await repository.findByClientMessageId('thread-1', 'cli-123')

      expect(mockPrisma.chatMessage.findUnique).toHaveBeenCalledWith({
        where: { threadId_clientMessageId: { threadId: 'thread-1', clientMessageId: 'cli-123' } },
        include: expect.any(Object),
      })
      expect(result).toBe(sampleMessage)
    })
  })

  describe('findLastMessages (review Major 1)', () => {
    test('empty threadIds input returns empty maps and makes NO queries', async () => {
      const result = await repository.findLastMessages([])

      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
      expect(mockPrisma.chatMessage.findMany).not.toHaveBeenCalled()
      expect(result.last.size).toBe(0)
      expect(result.lastTagged.size).toBe(0)
    })

    test('picks newest message and newest tagged message per thread via $queryRaw DISTINCT ON, then reads messages by those ids', async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'msg-new-1' }, { id: 'msg-new-2' }])
        .mockResolvedValueOnce([{ id: 'msg-tagged-1' }])

      const msgNew1 = { ...sampleMessage, id: 'msg-new-1', threadId: 'thread-1', deliveryId: null }
      const msgNew2 = { ...sampleMessage, id: 'msg-new-2', threadId: 'thread-2', deliveryId: null }
      const msgTagged1 = { ...sampleMessage, id: 'msg-tagged-1', threadId: 'thread-1', deliveryId: 'del-1' }

      mockPrisma.chatMessage.findMany.mockResolvedValueOnce([msgNew1, msgNew2, msgTagged1])

      const result = await repository.findLastMessages(['thread-1', 'thread-2'])

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2)

      // Untagged query
      const [untaggedStrings, ...untaggedVals] = mockPrisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
      const untaggedSql = Prisma.sql(untaggedStrings, ...untaggedVals)
      expect(untaggedSql.text).toContain('SELECT DISTINCT ON ("threadId") "id"')
      expect(untaggedSql.text).toContain('ORDER BY "threadId", "createdAt" DESC, "id" DESC')
      expect(untaggedSql.text).not.toContain('"deliveryId" IS NOT NULL')

      // Tagged query
      const [taggedStrings, ...taggedVals] = mockPrisma.$queryRaw.mock.calls[1] as [TemplateStringsArray, ...unknown[]]
      const taggedSql = Prisma.sql(taggedStrings, ...taggedVals)
      expect(taggedSql.text).toContain('SELECT DISTINCT ON ("threadId") "id"')
      expect(taggedSql.text).toContain('ORDER BY "threadId", "createdAt" DESC, "id" DESC')
      expect(taggedSql.text).toContain('"deliveryId" IS NOT NULL')

      // findMany by collected ids
      expect(mockPrisma.chatMessage.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['msg-new-1', 'msg-new-2', 'msg-tagged-1'] } },
        include: expect.any(Object),
      })

      // Maps correctly keyed by threadId
      expect(result.last.get('thread-1')).toBe(msgNew1)
      expect(result.last.get('thread-2')).toBe(msgNew2)
      expect(result.lastTagged.get('thread-1')).toBe(msgTagged1)
      expect(result.lastTagged.get('thread-2')).toBeUndefined()
    })
  })

  describe('findThreadsByIds (AC-17 board support)', () => {
    test('empty threadIds input returns empty array without querying', async () => {
      const result = await repository.findThreadsByIds([])
      expect(mockPrisma.chatThread.findMany).not.toHaveBeenCalled()
      expect(result).toEqual([])
    })

    test('reads all specified threads by id without page limit', async () => {
      const threads = [sampleThread, { ...sampleThread, id: 'thread-2' }]
      mockPrisma.chatThread.findMany.mockResolvedValue(threads)

      const result = await repository.findThreadsByIds(['thread-1', 'thread-2'])

      expect(mockPrisma.chatThread.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['thread-1', 'thread-2'] } },
        include: expect.any(Object),
      })
      expect(result).toBe(threads)
    })
  })

  describe('findNewestUnreadBodies (AC-17 board preview)', () => {
    test('empty threadIds returns empty map without querying', async () => {
      const result = await repository.findNewestUnreadBodies([])
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
      expect(result.size).toBe(0)
    })

    test('queries DISTINCT ON newest unread body per thread filtering out DISPATCH and SYSTEM', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { threadId: 'thread-1', body: 'Customer door code 1234' },
        { threadId: 'thread-2', body: 'Order delayed 10 mins' },
      ])

      const result = await repository.findNewestUnreadBodies(['thread-1', 'thread-2'])

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
      const [strings, ...vals] = mockPrisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
      const sql = Prisma.sql(strings, ...vals)

      // Load-bearing SQL clauses
      expect(sql.text).toContain('SELECT DISTINCT ON (m."threadId") m."threadId", m."body"')
      expect(sql.text).toContain('FROM "ChatMessage" m')
      expect(sql.text).toContain('JOIN "ChatThread" t ON t."id" = m."threadId"')
      expect(sql.text).toContain('m."senderKind"::text IN (')
      expect(sql.text).toContain('(t."dispatchLastReadAt" IS NULL OR m."createdAt" > t."dispatchLastReadAt")')
      expect(sql.text).toContain('ORDER BY m."threadId", m."createdAt" DESC, m."id" DESC')

      // Check values include unread sender kinds (COURIER, PARTNER)
      expect(sql.values).toEqual(expect.arrayContaining(['thread-1', 'thread-2', 'COURIER', 'PARTNER']))
      expect(sql.values).not.toContain('DISPATCH')
      expect(sql.values).not.toContain('SYSTEM')

      expect(result.get('thread-1')).toBe('Customer door code 1234')
      expect(result.get('thread-2')).toBe('Order delayed 10 mins')
    })
  })

  describe('findMessages before and after paging branches (review Major 3, decision 111.5)', () => {
    const cursorDate = new Date('2026-11-17T10:00:00.000Z')

    test('after branch: queries messages newer than cursor with gt and orders asc', async () => {
      mockPrisma.chatMessage.findFirst.mockResolvedValue({ id: 'cursor-msg', createdAt: cursorDate })
      const m1 = { ...sampleMessage, id: 'msg-after-1' }
      const m2 = { ...sampleMessage, id: 'msg-after-2' }
      mockPrisma.chatMessage.findMany.mockResolvedValue([m1, m2])

      const result = await repository.findMessages('thread-1', { after: 'cursor-msg' })

      expect(mockPrisma.chatMessage.findFirst).toHaveBeenCalledWith({
        where: { id: 'cursor-msg', threadId: 'thread-1' },
        select: { id: true, createdAt: true },
      })
      expect(mockPrisma.chatMessage.findMany).toHaveBeenCalledWith({
        where: {
          threadId: 'thread-1',
          OR: [
            { createdAt: { gt: cursorDate } },
            { createdAt: cursorDate, id: { gt: 'cursor-msg' } },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: CHAT_PAGE_SIZE,
        include: expect.any(Object),
      })
      expect(result).toEqual([m1, m2])
    })

    test('before branch: queries messages older than cursor with lt, orders desc, and returns reversed (oldest first)', async () => {
      mockPrisma.chatMessage.findFirst.mockResolvedValue({ id: 'cursor-msg', createdAt: cursorDate })
      const older1 = { ...sampleMessage, id: 'msg-older-1', createdAt: new Date('2026-11-17T09:59:00.000Z') }
      const older2 = { ...sampleMessage, id: 'msg-older-2', createdAt: new Date('2026-11-17T09:58:00.000Z') }
      mockPrisma.chatMessage.findMany.mockResolvedValue([older1, older2])

      const result = await repository.findMessages('thread-1', { before: 'cursor-msg' })

      expect(mockPrisma.chatMessage.findFirst).toHaveBeenCalledWith({
        where: { id: 'cursor-msg', threadId: 'thread-1' },
        select: { id: true, createdAt: true },
      })
      expect(mockPrisma.chatMessage.findMany).toHaveBeenCalledWith({
        where: {
          threadId: 'thread-1',
          OR: [
            { createdAt: { lt: cursorDate } },
            { createdAt: cursorDate, id: { lt: 'cursor-msg' } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: CHAT_PAGE_SIZE,
        include: expect.any(Object),
      })
      // Should be reversed so oldest is first
      expect(result).toEqual([older2, older1])
    })

    test('an unknown message cursor returns the newest page instead of throwing (decision 111.5)', async () => {
      mockPrisma.chatMessage.findFirst.mockResolvedValue(null)
      mockPrisma.chatMessage.findMany.mockResolvedValue([sampleMessage])

      const messages = await repository.findMessages('thread-1', { before: 'unknown-id' })

      expect(mockPrisma.chatMessage.findFirst).toHaveBeenCalledWith({
        where: { id: 'unknown-id', threadId: 'thread-1' },
        select: { id: true, createdAt: true },
      })
      expect(mockPrisma.chatMessage.findMany).toHaveBeenCalledWith({
        where: { threadId: 'thread-1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: CHAT_PAGE_SIZE,
        include: expect.any(Object),
      })
      expect(messages).toEqual([sampleMessage])
    })
  })

  describe('Raw SQL queries load-bearing clauses (review Major 3)', () => {
    test('findUnreadThreads SQL text pins: lastMessageAt IS NOT NULL, sender kinds, and createdAt > dispatchLastReadAt', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([])

      await repository.findUnreadThreads()

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
      const [strings, ...vals] = mockPrisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
      const sql = Prisma.sql(strings, ...vals)

      expect(sql.text).toContain('t."lastMessageAt" IS NOT NULL')
      expect(sql.text).toContain('m."senderKind"::text IN (')
      expect(sql.text).toContain('(t."dispatchLastReadAt" IS NULL OR m."createdAt" > t."dispatchLastReadAt")')
      expect(sql.values).toEqual(expect.arrayContaining(['COURIER', 'PARTNER']))
      expect(sql.values).not.toContain('DISPATCH')
      expect(sql.values).not.toContain('SYSTEM')
    })

    test('findThreadIdsMatching SQL text pins: lastMessageAt IS NOT NULL, LIKE escaping for searchFold and name', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'thread-match-1' }])

      const result = await repository.findThreadIdsMatching(['pizza', '100%_special'])

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
      const [strings, ...vals] = mockPrisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
      const sql = Prisma.sql(strings, ...vals)

      expect(sql.text).toContain('t."lastMessageAt" IS NOT NULL')
      expect(sql.text).toContain('c."searchFold" LIKE')
      expect(sql.text).toContain('oc_search_fold(p."name") LIKE')
      expect(sql.text).toContain('d."searchFold" LIKE')

      // Wildcards % and _ must be escaped by escapeLikeText: % -> \% and _ -> \_
      expect(sql.values).toContain('%pizza%')
      expect(sql.values).toContain('%100\\%\\_special%')
      expect(result).toEqual(['thread-match-1'])
    })
  })
})
