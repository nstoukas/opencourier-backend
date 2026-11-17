import { EnumChatSenderKind } from '@prisma/types'
import { ChatMessageRow } from 'src/persistence/repositories/chat.repository'
import {
  ChatMessageAdminDto,
  ChatMessagePartyDto,
  ChatMessagesPartyDto,
  DISPATCH_SENDER_NAME,
} from './chat-message.dto'

describe('ChatMessage DTOs (spec 0034, AC-5 & AC-6)', () => {
  const createMessageRow = (overrides: Partial<ChatMessageRow> = {}): ChatMessageRow =>
    ({
      id: 'msg-1',
      threadId: 'thread-1',
      senderKind: EnumChatSenderKind.DISPATCH,
      senderUserId: 'user-admin-1',
      body: 'Hello from dispatch',
      deliveryId: null,
      clientMessageId: null,
      createdAt: new Date('2026-11-17T12:00:00.000Z'),
      senderUser: { username: 'dispatch_admin', email: 'admin@opencourier.org' },
      delivery: null,
      ...overrides,
    } as ChatMessageRow)

  describe('AC-5: sender names for admin vs party', () => {
    test('ChatMessagePartyDto shows "Dispatch" for DISPATCH sender and never colleague username or email', () => {
      const row = createMessageRow({
        senderKind: EnumChatSenderKind.DISPATCH,
        senderUser: { username: 'vasilis_admin', email: 'vasilis@opencourier.org' },
      })
      const dto = new ChatMessagePartyDto(row, null)

      expect(dto.senderName).toBe(DISPATCH_SENDER_NAME)
      expect(dto.senderName).toBe('Dispatch')
      expect(dto.senderName).not.toContain('vasilis')
      expect(dto.senderName).not.toContain('opencourier.org')
      expect((dto as any).senderUser).toBeUndefined()
    })

    test('ChatMessageAdminDto shows colleague username when present for DISPATCH', () => {
      const row = createMessageRow({
        senderKind: EnumChatSenderKind.DISPATCH,
        senderUser: { username: 'elena_disp', email: 'elena@opencourier.org' },
      })
      const dto = new ChatMessageAdminDto(row, 'Rider Nikos')

      expect(dto.senderName).toBe('elena_disp')
    })

    test('ChatMessageAdminDto falls back to colleague email when username is null or empty for DISPATCH', () => {
      const rowWithoutUsername = createMessageRow({
        senderKind: EnumChatSenderKind.DISPATCH,
        senderUser: { username: '', email: 'kostas@opencourier.org' },
      })
      const dto = new ChatMessageAdminDto(rowWithoutUsername, 'Rider Nikos')

      expect(dto.senderName).toBe('kostas@opencourier.org')

      const rowWithNullUsername = createMessageRow({
        senderKind: EnumChatSenderKind.DISPATCH,
        senderUser: { username: null as any, email: 'kostas2@opencourier.org' },
      })
      const dto2 = new ChatMessageAdminDto(rowWithNullUsername, 'Rider Nikos')
      expect(dto2.senderName).toBe('kostas2@opencourier.org')
    })

    test('ChatMessageAdminDto shows partyName for COURIER and PARTNER', () => {
      const courierRow = createMessageRow({
        senderKind: EnumChatSenderKind.COURIER,
        senderUser: null,
      })
      const partnerRow = createMessageRow({
        senderKind: EnumChatSenderKind.PARTNER,
        senderUser: null,
      })

      expect(new ChatMessageAdminDto(courierRow, 'Nikos Papas').senderName).toBe('Nikos Papas')
      expect(new ChatMessageAdminDto(partnerRow, 'Volos Pizza').senderName).toBe('Volos Pizza')
    })

    test('ChatMessageAdminDto shows null for SYSTEM line', () => {
      const systemRow = createMessageRow({
        senderKind: EnumChatSenderKind.SYSTEM,
        senderUser: null,
      })
      expect(new ChatMessageAdminDto(systemRow, 'Nikos Papas').senderName).toBeNull()
    })

    test('ChatMessagePartyDto shows null senderName for COURIER, PARTNER, and SYSTEM lines', () => {
      for (const kind of [EnumChatSenderKind.COURIER, EnumChatSenderKind.PARTNER, EnumChatSenderKind.SYSTEM]) {
        const row = createMessageRow({ senderKind: kind })
        const dto = new ChatMessagePartyDto(row, null)
        expect(dto.senderName).toBeNull()
      }
    })
  })

  describe('AC-6: read marks guard (no rider/restaurant reading data, readByDispatch presence)', () => {
    test('readByDispatch appears on COURIER and PARTNER messages and is true when createdAt <= dispatchLastReadAt', () => {
      const readAt = new Date('2026-11-17T12:00:00.000Z')
      const olderMessage = createMessageRow({
        senderKind: EnumChatSenderKind.COURIER,
        createdAt: new Date('2026-11-17T11:59:59.000Z'),
      })
      const exactMessage = createMessageRow({
        senderKind: EnumChatSenderKind.PARTNER,
        createdAt: new Date('2026-11-17T12:00:00.000Z'),
      })

      const dtoOlder = new ChatMessagePartyDto(olderMessage, readAt)
      const dtoExact = new ChatMessagePartyDto(exactMessage, readAt)

      expect(dtoOlder.readByDispatch).toBe(true)
      expect(dtoExact.readByDispatch).toBe(true)
    })

    test('readByDispatch is false on COURIER and PARTNER messages when createdAt > dispatchLastReadAt or readAt is null', () => {
      const readAt = new Date('2026-11-17T12:00:00.000Z')
      const newerMessage = createMessageRow({
        senderKind: EnumChatSenderKind.COURIER,
        createdAt: new Date('2026-11-17T12:00:01.000Z'),
      })
      const unreadMessage = createMessageRow({
        senderKind: EnumChatSenderKind.PARTNER,
        createdAt: new Date('2026-11-17T11:00:00.000Z'),
      })

      const dtoNewer = new ChatMessagePartyDto(newerMessage, readAt)
      const dtoNullRead = new ChatMessagePartyDto(unreadMessage, null)

      expect(dtoNewer.readByDispatch).toBe(false)
      expect(dtoNullRead.readByDispatch).toBe(false)
    })

    test('readByDispatch is ABSENT (not false) on DISPATCH messages', () => {
      const readAt = new Date('2026-11-17T12:00:00.000Z')
      const dispatchRow = createMessageRow({
        senderKind: EnumChatSenderKind.DISPATCH,
        createdAt: new Date('2026-11-17T11:00:00.000Z'),
      })

      const dto = new ChatMessagePartyDto(dispatchRow, readAt)

      expect(dto.readByDispatch).toBeUndefined()
      expect('readByDispatch' in dto).toBe(false)
      expect(Object.keys(dto)).not.toContain('readByDispatch')
    })

    test('readByDispatch is ABSENT (not false) on SYSTEM messages', () => {
      const readAt = new Date('2026-11-17T12:00:00.000Z')
      const systemRow = createMessageRow({
        senderKind: EnumChatSenderKind.SYSTEM,
        createdAt: new Date('2026-11-17T11:00:00.000Z'),
      })

      const dto = new ChatMessagePartyDto(systemRow, readAt)

      expect(dto.readByDispatch).toBeUndefined()
      expect('readByDispatch' in dto).toBe(false)
      expect(Object.keys(dto)).not.toContain('readByDispatch')
    })

    test('GUARD: no courier, partner, or admin DTO has any field about a rider or restaurant reading', () => {
      const row = createMessageRow({
        senderKind: EnumChatSenderKind.COURIER,
        clientMessageId: 'cli-123',
      })
      const partyDto = new ChatMessagePartyDto(row, new Date())
      const adminDto = new ChatMessageAdminDto(row, 'Rider')
      const partyListDto = new ChatMessagesPartyDto([partyDto])

      // Socket payload objects (spec 0034, AC-6)
      const courierSocketPayload = { message: partyDto }
      const dispatchSocketPayload = { threadId: 'thread-1', message: adminDto }
      const courierReadPayload = { dispatchLastReadAt: new Date().toISOString() }
      const dispatchReadPayload = { threadId: 'thread-1', dispatchLastReadAt: new Date().toISOString() }

      const FORBIDDEN_SUBSTRINGS = [
        'riderread',
        'courierread',
        'partnerread',
        'readbyrider',
        'readbycourier',
        'readbypartner',
        'riderseen',
        'courierseen',
        'partnerseen',
        'clientread',
        'userread',
      ]

      for (const obj of [
        partyDto,
        adminDto,
        partyListDto,
        courierSocketPayload,
        dispatchSocketPayload,
        courierReadPayload,
        dispatchReadPayload,
      ]) {
        const keys = Object.keys(obj).map((k) => k.toLowerCase())
        for (const key of keys) {
          for (const forbidden of FORBIDDEN_SUBSTRINGS) {
            expect(key).not.toContain(forbidden)
          }
        }
      }
    })
  })
})
