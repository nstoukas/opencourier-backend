import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { EnumChatSenderKind, EnumCourierStatus } from '@prisma/types'
import { CHAT_MESSAGE_MAX_LENGTH } from 'src/constants'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import {
  ChatMessageRow,
  ChatRepository,
  ChatThreadRow,
  CHAT_PAGE_SIZE,
} from 'src/persistence/repositories/chat.repository'
import { OfferPushService } from 'src/services/pushNotification/offer-push.service'
import { WebsocketDispatcher } from 'src/services/websocket/models/WebsocketDispatcher'
import {
  ChatDomainService,
  CHAT_BODY_REFUSAL,
  CHAT_NO_LOGIN_REFUSAL,
  CHAT_CLIENT_ID_TAKEN_REFUSAL,
  CHAT_TAG_REFUSAL,
  checkBody,
} from './chat.domain.service'

describe('ChatDomainService (spec 0034, AC-4, AC-7, AC-10, AC-11, AC-15, AC-19, AC-21)', () => {
  let service: ChatDomainService
  let mockChatRepo: jest.Mocked<ChatRepository>
  let mockConfigService: jest.Mocked<ConfigDomainService>
  let mockDispatcher: jest.Mocked<WebsocketDispatcher>
  let mockPushService: jest.Mocked<OfferPushService>

  const createCourierThread = (status: EnumCourierStatus = EnumCourierStatus.ONLINE): ChatThreadRow =>
    ({
      id: 'thread-c1',
      courierId: 'courier-1',
      partnerId: null,
      lastMessageAt: new Date('2026-11-17T10:00:00.000Z'),
      dispatchLastReadAt: null,
      createdAt: new Date('2026-11-17T08:00:00.000Z'),
      courier: {
        id: 'courier-1',
        userId: 'user-c1',
        firstName: 'Nikos',
        lastName: 'Papas',
        phoneNumber: '+306912345678',
        status,
      },
      partner: null,
    } as unknown as ChatThreadRow)

  const createPartnerThread = (): ChatThreadRow =>
    ({
      id: 'thread-p1',
      courierId: null,
      partnerId: 'partner-1',
      lastMessageAt: new Date('2026-11-17T10:00:00.000Z'),
      dispatchLastReadAt: null,
      createdAt: new Date('2026-11-17T08:00:00.000Z'),
      courier: null,
      partner: {
        id: 'partner-1',
        userId: 'user-p1',
        name: 'Volos Pizza',
        phoneNumber: '+302421011111',
      },
    } as unknown as ChatThreadRow)

  const createMessageRow = (
    senderKind: EnumChatSenderKind,
    threadId: string,
    body = 'Hello'
  ): ChatMessageRow =>
    ({
      id: 'msg-1',
      threadId,
      senderKind,
      senderUserId: 'user-1',
      body,
      deliveryId: null,
      clientMessageId: 'cli-1',
      createdAt: new Date('2026-11-17T10:00:00.000Z'),
      senderUser: { username: 'dispatch_user', email: 'dispatch@opencourier.org' },
      delivery: null,
    } as unknown as ChatMessageRow)

  beforeEach(() => {
    mockChatRepo = {
      findThreadById: jest.fn(),
      findThreadByParty: jest.fn(),
      findOrCreateThread: jest.fn(),
      findByClientMessageId: jest.fn().mockResolvedValue(null),
      createMessage: jest.fn(),
      markReadByDispatch: jest.fn(),
      findDeliveryOwners: jest.fn(),
      findCourierForChat: jest.fn(),
      findPartnerForChat: jest.fn(),
      findMessages: jest.fn(),
      findUnreadThreads: jest.fn(),
      findThreadPage: jest.fn(),
      findThreadIdsMatching: jest.fn(),
      findThreadsByIds: jest.fn().mockResolvedValue([]),
      findLastMessages: jest.fn().mockResolvedValue({ last: new Map(), lastTagged: new Map() }),
      findNewestUnreadBodies: jest.fn().mockResolvedValue(new Map()),
      findActiveDeliveries: jest.fn(),
      deleteMessagesOlderThan: jest.fn(),
    } as unknown as jest.Mocked<ChatRepository>

    mockConfigService = {
      instanceConfig: {
        getChatQuickRepliesDispatch: jest.fn().mockResolvedValue([]),
        getChatQuickRepliesCourier: jest.fn().mockResolvedValue([]),
        getChatRetentionDays: jest.fn().mockResolvedValue(90),
      },
    } as unknown as jest.Mocked<ConfigDomainService>

    mockDispatcher = {
      sendChatMessageToDispatch: jest.fn(),
      sendChatMessageToCourier: jest.fn().mockResolvedValue(undefined),
      sendChatReadByDispatch: jest.fn().mockResolvedValue(undefined),
      sendChatThreadRead: jest.fn(),
    } as unknown as jest.Mocked<WebsocketDispatcher>

    mockPushService = {
      chatMessage: jest.fn(),
    } as unknown as jest.Mocked<OfferPushService>

    service = new ChatDomainService(
      mockChatRepo,
      mockConfigService,
      mockDispatcher,
      mockPushService
    )
  })

  describe('AC-4: message body check (trimmed, 1 to 1000 characters)', () => {
    test('checkBody refuses empty or blank text with 400 CHAT_BODY_REFUSAL', () => {
      expect(() => checkBody('')).toThrow(BadRequestException)
      expect(() => checkBody('   ')).toThrow(BadRequestException)
      expect(() => checkBody('\t\n')).toThrow(BadRequestException)
      try {
        checkBody('')
      } catch (err: any) {
        expect(err.message).toBe(CHAT_BODY_REFUSAL)
      }
    })

    test('checkBody refuses text over 1000 characters with 400 CHAT_BODY_REFUSAL', () => {
      const overMax = 'a'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1)
      expect(() => checkBody(overMax)).toThrow(BadRequestException)
      try {
        checkBody(overMax)
      } catch (err: any) {
        expect(err.message).toBe(CHAT_BODY_REFUSAL)
      }
    })

    test('checkBody trims leading and trailing whitespace and accepts 1 to 1000 characters', () => {
      expect(checkBody('   valid message   ')).toBe('valid message')
      const exactly1000 = 'x'.repeat(1000)
      expect(checkBody(exactly1000)).toBe(exactly1000)
      expect(checkBody('  ' + exactly1000 + '  ')).toBe(exactly1000)
    })

    test('send refuses empty, blank, or over-long body with 400 CHAT_BODY_REFUSAL', async () => {
      await expect(
        service.send(
          { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
          { body: '   ', clientMessageId: 'cli-1' }
        )
      ).rejects.toThrow(new BadRequestException(CHAT_BODY_REFUSAL))

      await expect(
        service.send(
          { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
          { body: 'x'.repeat(1001), clientMessageId: 'cli-1' }
        )
      ).rejects.toThrow(new BadRequestException(CHAT_BODY_REFUSAL))
    })
  })

  describe('AC-10 & AC-11: push decisions (offline rider, online rider, message kinds)', () => {
    test('DISPATCH message to an OFFLINE rider sends NO push', async () => {
      const thread = createCourierThread(EnumCourierStatus.OFFLINE)
      const message = createMessageRow(EnumChatSenderKind.DISPATCH, thread.id)
      mockChatRepo.findThreadById.mockResolvedValue(thread)
      mockChatRepo.createMessage.mockResolvedValue({ message, created: true })

      await service.send(
        { kind: 'DISPATCH', userId: 'user-admin', threadId: thread.id },
        { body: 'Are you available?', clientMessageId: 'cli-1' }
      )

      expect(mockPushService.chatMessage).not.toHaveBeenCalled()
      expect(mockDispatcher.sendChatMessageToDispatch).toHaveBeenCalledTimes(1)
      expect(mockDispatcher.sendChatMessageToCourier).toHaveBeenCalledTimes(1)
    })

    test('DISPATCH message to an ONLINE rider calls offerPushService.chatMessage with courierId and threadId', async () => {
      const thread = createCourierThread(EnumCourierStatus.ONLINE)
      const message = createMessageRow(EnumChatSenderKind.DISPATCH, thread.id)
      mockChatRepo.findThreadById.mockResolvedValue(thread)
      mockChatRepo.createMessage.mockResolvedValue({ message, created: true })

      await service.send(
        { kind: 'DISPATCH', userId: 'user-admin', threadId: thread.id },
        { body: 'Order ready at Nosh', clientMessageId: 'cli-1' }
      )

      expect(mockPushService.chatMessage).toHaveBeenCalledWith('courier-1', 'thread-c1')
    })

    test('DISPATCH message to a LAST_CALL rider calls offerPushService.chatMessage', async () => {
      const thread = createCourierThread(EnumCourierStatus.LAST_CALL)
      const message = createMessageRow(EnumChatSenderKind.DISPATCH, thread.id)
      mockChatRepo.findThreadById.mockResolvedValue(thread)
      mockChatRepo.createMessage.mockResolvedValue({ message, created: true })

      await service.send(
        { kind: 'DISPATCH', userId: 'user-admin', threadId: thread.id },
        { body: 'Last order of the shift', clientMessageId: 'cli-1' }
      )

      expect(mockPushService.chatMessage).toHaveBeenCalledWith('courier-1', 'thread-c1')
    })

    test('COURIER, PARTNER, and SYSTEM messages NEVER trigger a push', async () => {
      // 1. Courier sender
      const courierThread = createCourierThread(EnumCourierStatus.ONLINE)
      const courierMsg = createMessageRow(EnumChatSenderKind.COURIER, courierThread.id)
      mockChatRepo.findOrCreateThread.mockResolvedValue(courierThread)
      mockChatRepo.createMessage.mockResolvedValue({ message: courierMsg, created: true })

      await service.send(
        { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
        { body: 'At the restaurant', clientMessageId: 'cli-c' }
      )
      expect(mockPushService.chatMessage).not.toHaveBeenCalled()

      // 2. Partner sender
      const partnerThread = createPartnerThread()
      const partnerMsg = createMessageRow(EnumChatSenderKind.PARTNER, partnerThread.id)
      mockChatRepo.findOrCreateThread.mockResolvedValue(partnerThread)
      mockChatRepo.createMessage.mockResolvedValue({ message: partnerMsg, created: true })

      await service.send(
        { kind: 'PARTNER', userId: 'user-p1', partnerId: 'partner-1' },
        { body: 'Food will take 5 more minutes', clientMessageId: 'cli-p' }
      )
      expect(mockPushService.chatMessage).not.toHaveBeenCalled()

      // 3. System line
      mockChatRepo.findOrCreateThread.mockResolvedValue(courierThread)
      mockChatRepo.createMessage.mockResolvedValue({
        message: createMessageRow(EnumChatSenderKind.SYSTEM, courierThread.id),
        created: true,
      })
      await service.addSystemLine('courier-1', 'del-1', 'Reported: Food not ready')
      expect(mockPushService.chatMessage).not.toHaveBeenCalled()
    })
  })

  describe('AC-15: openThread validation (no login restaurant, unknown IDs)', () => {
    test('openThread throws 400 CHAT_NO_LOGIN_REFUSAL for restaurant with userId null', async () => {
      mockChatRepo.findPartnerForChat.mockResolvedValue({ id: 'partner-no-login', userId: null })

      await expect(service.openThread({ partnerId: 'partner-no-login' })).rejects.toThrow(
        new BadRequestException(CHAT_NO_LOGIN_REFUSAL)
      )
    })

    test('openThread throws 404 for unknown partnerId', async () => {
      mockChatRepo.findPartnerForChat.mockResolvedValue(null)

      await expect(service.openThread({ partnerId: 'unknown-p' })).rejects.toThrow(
        NotFoundException
      )
    })

    test('openThread throws 404 for unknown courierId', async () => {
      mockChatRepo.findCourierForChat.mockResolvedValue(null)

      await expect(service.openThread({ courierId: 'unknown-c' })).rejects.toThrow(
        NotFoundException
      )
    })

    test('openThread succeeds and creates thread for valid courier or partner', async () => {
      mockChatRepo.findCourierForChat.mockResolvedValue({ id: 'courier-1' })
      const thread = createCourierThread()
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)

      const result = await service.openThread({ courierId: 'courier-1' })
      expect(result).toBe(thread)
    })
  })

  describe('AC-19: clientMessageId duplicate handling (idempotency)', () => {
    test('a retry with clientMessageId already stored by the same sender returns stored message without calling checkDeliveryTag or publishing (AC-19)', async () => {
      const thread = createCourierThread(EnumCourierStatus.ONLINE)
      const storedMessage = createMessageRow(EnumChatSenderKind.COURIER, thread.id)
      storedMessage.clientMessageId = 'cli-retry-1'
      storedMessage.senderUserId = 'user-c1'

      // Spec 0034 / row 115: existing thread is looked up via findThreadByParty before checking retry
      mockChatRepo.findThreadByParty.mockResolvedValue(thread)
      mockChatRepo.findByClientMessageId.mockResolvedValue(storedMessage)

      // Rider retries with a delivery tag for a delivery they may no longer hold
      const result = await service.send(
        { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
        { body: 'At the restaurant', clientMessageId: 'cli-retry-1', deliveryId: 'del-ended' }
      )

      expect(result).toEqual({ thread, message: storedMessage })
      // Crucial: findDeliveryOwners was never called, so a moved delivery does not cause 404
      expect(mockChatRepo.findDeliveryOwners).not.toHaveBeenCalled()
      expect(mockChatRepo.findOrCreateThread).not.toHaveBeenCalled()
      expect(mockChatRepo.createMessage).not.toHaveBeenCalled()
      expect(mockDispatcher.sendChatMessageToDispatch).not.toHaveBeenCalled()
      expect(mockDispatcher.sendChatMessageToCourier).not.toHaveBeenCalled()
      expect(mockPushService.chatMessage).not.toHaveBeenCalled()
    })

    test('a send whose clientMessageId is stored by another sender in the thread answers 409 ConflictException', async () => {
      const thread = createCourierThread(EnumCourierStatus.ONLINE)
      const storedMessage = createMessageRow(EnumChatSenderKind.COURIER, thread.id)
      storedMessage.clientMessageId = 'cli-clash-1'
      storedMessage.senderUserId = 'user-someone-else'

      mockChatRepo.findThreadByParty.mockResolvedValue(thread)
      mockChatRepo.findByClientMessageId.mockResolvedValue(storedMessage)

      await expect(
        service.send(
          { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
          { body: 'Hello', clientMessageId: 'cli-clash-1' }
        )
      ).rejects.toThrow(new ConflictException(CHAT_CLIENT_ID_TAKEN_REFUSAL))

      expect(mockChatRepo.createMessage).not.toHaveBeenCalled()
      expect(mockDispatcher.sendChatMessageToDispatch).not.toHaveBeenCalled()
    })

    test('a send where stored message has different senderKind answers 409 ConflictException', async () => {
      const thread = createCourierThread(EnumCourierStatus.ONLINE)
      const storedMessage = createMessageRow(EnumChatSenderKind.DISPATCH, thread.id)
      storedMessage.clientMessageId = 'cli-clash-2'
      storedMessage.senderUserId = 'user-c1'

      mockChatRepo.findThreadByParty.mockResolvedValue(thread)
      mockChatRepo.findByClientMessageId.mockResolvedValue(storedMessage)

      await expect(
        service.send(
          { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
          { body: 'Hello', clientMessageId: 'cli-clash-2' }
        )
      ).rejects.toThrow(new ConflictException(CHAT_CLIENT_ID_TAKEN_REFUSAL))
    })

    test('a PARTNER retry with clientMessageId already stored returns stored message (findThreadByParty lookup)', async () => {
      const thread = createPartnerThread()
      const storedMessage = createMessageRow(EnumChatSenderKind.PARTNER, thread.id, 'Food ready')
      storedMessage.clientMessageId = 'cli-partner-retry'
      storedMessage.senderUserId = 'user-p1'

      mockChatRepo.findThreadByParty.mockResolvedValue(thread)
      mockChatRepo.findByClientMessageId.mockResolvedValue(storedMessage)

      const result = await service.send(
        { kind: 'PARTNER', userId: 'user-p1', partnerId: 'partner-1' },
        { body: 'Food ready', clientMessageId: 'cli-partner-retry', deliveryId: 'del-ended' }
      )

      expect(result).toEqual({ thread, message: storedMessage })
      expect(mockChatRepo.findDeliveryOwners).not.toHaveBeenCalled()
      expect(mockChatRepo.findOrCreateThread).not.toHaveBeenCalled()
      expect(mockChatRepo.createMessage).not.toHaveBeenCalled()
      expect(mockDispatcher.sendChatMessageToDispatch).not.toHaveBeenCalled()
    })

    test('a DISPATCH retry with clientMessageId already stored returns stored message (findThreadById lookup)', async () => {
      const thread = createCourierThread()
      const storedMessage = createMessageRow(EnumChatSenderKind.DISPATCH, thread.id, 'Order assigned')
      storedMessage.clientMessageId = 'cli-dispatch-retry'
      storedMessage.senderUserId = 'user-admin'

      mockChatRepo.findThreadById.mockResolvedValue(thread)
      mockChatRepo.findByClientMessageId.mockResolvedValue(storedMessage)

      const result = await service.send(
        { kind: 'DISPATCH', userId: 'user-admin', threadId: thread.id },
        { body: 'Order assigned', clientMessageId: 'cli-dispatch-retry', deliveryId: 'del-ended' }
      )

      expect(result).toEqual({ thread, message: storedMessage })
      expect(mockChatRepo.findDeliveryOwners).not.toHaveBeenCalled()
      expect(mockChatRepo.createMessage).not.toHaveBeenCalled()
      expect(mockDispatcher.sendChatMessageToCourier).not.toHaveBeenCalled()
    })

    test('concurrent retry race: createMessage returns created: false and publishes nothing', async () => {
      const thread = createCourierThread(EnumCourierStatus.ONLINE)
      const storedMessage = createMessageRow(EnumChatSenderKind.COURIER, thread.id)
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)
      mockChatRepo.findByClientMessageId.mockResolvedValue(null)
      mockChatRepo.createMessage.mockResolvedValue({ message: storedMessage, created: false })

      const result = await service.send(
        { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
        { body: 'At the restaurant', clientMessageId: 'cli-dup-1' }
      )

      expect(result).toEqual({ thread, message: storedMessage })
      expect(mockDispatcher.sendChatMessageToDispatch).not.toHaveBeenCalled()
      expect(mockDispatcher.sendChatMessageToCourier).not.toHaveBeenCalled()
      expect(mockPushService.chatMessage).not.toHaveBeenCalled()
    })
  })

  describe('AC-21: delivery tagging authorization', () => {
    test('rider tagging a delivery that belongs to another courier gets 404', async () => {
      const thread = createCourierThread()
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)
      mockChatRepo.findDeliveryOwners.mockResolvedValue({
        courierId: 'courier-other',
        partnerId: 'partner-other',
      })

      await expect(
        service.send(
          { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
          { body: 'Wrong address', deliveryId: 'del-other', clientMessageId: 'cli-1' }
        )
      ).rejects.toThrow(new NotFoundException(CHAT_TAG_REFUSAL))
    })

    test('restaurant tagging a delivery that belongs to another restaurant gets 404', async () => {
      const thread = createPartnerThread()
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)
      mockChatRepo.findDeliveryOwners.mockResolvedValue({
        courierId: 'courier-1',
        partnerId: 'partner-other',
      })

      await expect(
        service.send(
          { kind: 'PARTNER', userId: 'user-p1', partnerId: 'partner-1' },
          { body: 'Delay on order', deliveryId: 'del-other', clientMessageId: 'cli-1' }
        )
      ).rejects.toThrow(new NotFoundException(CHAT_TAG_REFUSAL))
    })

    test('tagging a non-existent delivery gets 404', async () => {
      const thread = createCourierThread()
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)
      mockChatRepo.findDeliveryOwners.mockResolvedValue(null)

      await expect(
        service.send(
          { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
          { body: 'Note', deliveryId: 'del-nonexistent', clientMessageId: 'cli-1' }
        )
      ).rejects.toThrow(new NotFoundException(CHAT_TAG_REFUSAL))
    })

    test('pin that non-existent delivery and foreign delivery give the exact same refusal message (AC-21)', async () => {
      const thread = createCourierThread()
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)

      // 1. Missing delivery
      mockChatRepo.findDeliveryOwners.mockResolvedValue(null)
      let missingRefusal = ''
      try {
        await service.send(
          { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
          { body: 'Note', deliveryId: 'del-missing', clientMessageId: 'cli-1' }
        )
      } catch (err: any) {
        missingRefusal = err.message
      }

      // 2. Foreign delivery
      mockChatRepo.findDeliveryOwners.mockResolvedValue({
        courierId: 'courier-other',
        partnerId: 'partner-other',
      })
      let foreignRefusal = ''
      try {
        await service.send(
          { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
          { body: 'Note', deliveryId: 'del-foreign', clientMessageId: 'cli-2' }
        )
      } catch (err: any) {
        foreignRefusal = err.message
      }

      expect(missingRefusal).toBe(CHAT_TAG_REFUSAL)
      expect(foreignRefusal).toBe(CHAT_TAG_REFUSAL)
      expect(missingRefusal).toBe(foreignRefusal)
    })

    test('admin may tag any existing delivery', async () => {
      const thread = createCourierThread()
      const message = createMessageRow(EnumChatSenderKind.DISPATCH, thread.id)
      mockChatRepo.findThreadById.mockResolvedValue(thread)
      mockChatRepo.findDeliveryOwners.mockResolvedValue({
        courierId: 'courier-someone-else',
        partnerId: 'partner-someone-else',
      })
      mockChatRepo.createMessage.mockResolvedValue({ message, created: true })

      const result = await service.send(
        { kind: 'DISPATCH', userId: 'user-admin', threadId: thread.id },
        { body: 'Checking order', deliveryId: 'del-existing', clientMessageId: 'cli-1' }
      )

      expect(result.message).toBe(message)
    })

    test('rider tagging their own delivery succeeds', async () => {
      const thread = createCourierThread()
      const message = createMessageRow(EnumChatSenderKind.COURIER, thread.id)
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)
      mockChatRepo.findDeliveryOwners.mockResolvedValue({
        courierId: 'courier-1',
        partnerId: 'partner-1',
      })
      mockChatRepo.createMessage.mockResolvedValue({ message, created: true })

      const result = await service.send(
        { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
        { body: 'At door', deliveryId: 'del-mine', clientMessageId: 'cli-1' }
      )

      expect(result.message).toBe(message)
    })

    test('restaurant tagging their own delivery succeeds', async () => {
      const thread = createPartnerThread()
      const message = createMessageRow(EnumChatSenderKind.PARTNER, thread.id)
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)
      mockChatRepo.findDeliveryOwners.mockResolvedValue({
        courierId: 'courier-1',
        partnerId: 'partner-1',
      })
      mockChatRepo.createMessage.mockResolvedValue({ message, created: true })

      const result = await service.send(
        { kind: 'PARTNER', userId: 'user-p1', partnerId: 'partner-1' },
        { body: 'Order delayed', deliveryId: 'del-partner-order', clientMessageId: 'cli-1' }
      )

      expect(result.message).toBe(message)
    })
  })

  describe('row 115: refused tagged send leaves no thread behind (AC-1, AC-21)', () => {
    test('refused tag makes no thread: rider with no chat thread yet sending a foreign delivery tag gets 404 and leaves no thread behind (findOrCreateThread never called)', async () => {
      const thread = createCourierThread()
      mockChatRepo.findThreadByParty.mockResolvedValue(null)
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)
      mockChatRepo.findDeliveryOwners.mockResolvedValue({
        courierId: 'courier-other',
        partnerId: 'partner-other',
      })

      await expect(
        service.send(
          { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
          { body: 'Need help with this order', deliveryId: 'del-foreign', clientMessageId: 'cli-1' }
        )
      ).rejects.toThrow(new NotFoundException(CHAT_TAG_REFUSAL))

      expect(mockChatRepo.findOrCreateThread).not.toHaveBeenCalled()
      expect(mockChatRepo.createMessage).not.toHaveBeenCalled()
      expect(mockDispatcher.sendChatMessageToDispatch).not.toHaveBeenCalled()
      expect(mockDispatcher.sendChatMessageToCourier).not.toHaveBeenCalled()
    })

    test('refused tag makes no thread: rider with no chat thread yet sending a non-existent delivery tag gets 404 and leaves no thread behind', async () => {
      const thread = createCourierThread()
      mockChatRepo.findThreadByParty.mockResolvedValue(null)
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)
      mockChatRepo.findDeliveryOwners.mockResolvedValue(null)

      await expect(
        service.send(
          { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
          { body: 'Where is the pickup?', deliveryId: 'del-missing', clientMessageId: 'cli-1' }
        )
      ).rejects.toThrow(new NotFoundException(CHAT_TAG_REFUSAL))

      expect(mockChatRepo.findOrCreateThread).not.toHaveBeenCalled()
      expect(mockChatRepo.createMessage).not.toHaveBeenCalled()
    })

    test('refused tag makes no thread: restaurant with no chat thread yet sending a foreign delivery tag gets 404 and leaves no thread behind (findOrCreateThread never called)', async () => {
      const thread = createPartnerThread()
      mockChatRepo.findThreadByParty.mockResolvedValue(null)
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)
      mockChatRepo.findDeliveryOwners.mockResolvedValue({
        courierId: 'courier-1',
        partnerId: 'partner-other',
      })

      await expect(
        service.send(
          { kind: 'PARTNER', userId: 'user-p1', partnerId: 'partner-1' },
          { body: 'Delay on this order', deliveryId: 'del-foreign', clientMessageId: 'cli-1' }
        )
      ).rejects.toThrow(new NotFoundException(CHAT_TAG_REFUSAL))

      expect(mockChatRepo.findOrCreateThread).not.toHaveBeenCalled()
      expect(mockChatRepo.createMessage).not.toHaveBeenCalled()
      expect(mockDispatcher.sendChatMessageToDispatch).not.toHaveBeenCalled()
    })

    test('refused tag makes no thread: restaurant with no chat thread yet sending a non-existent delivery tag gets 404 and leaves no thread behind', async () => {
      const thread = createPartnerThread()
      mockChatRepo.findThreadByParty.mockResolvedValue(null)
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)
      mockChatRepo.findDeliveryOwners.mockResolvedValue(null)

      await expect(
        service.send(
          { kind: 'PARTNER', userId: 'user-p1', partnerId: 'partner-1' },
          { body: 'Question about delivery', deliveryId: 'del-missing', clientMessageId: 'cli-1' }
        )
      ).rejects.toThrow(new NotFoundException(CHAT_TAG_REFUSAL))

      expect(mockChatRepo.findOrCreateThread).not.toHaveBeenCalled()
      expect(mockChatRepo.createMessage).not.toHaveBeenCalled()
    })

    test('with an allowed tag, the first send creates the thread (AC-1) for a rider (COURIER) who has no chat thread yet', async () => {
      const thread = createCourierThread()
      const message = createMessageRow(EnumChatSenderKind.COURIER, thread.id, 'At pickup')
      message.deliveryId = 'del-mine'

      mockChatRepo.findThreadByParty.mockResolvedValue(null)
      mockChatRepo.findDeliveryOwners.mockResolvedValue({
        courierId: 'courier-1',
        partnerId: 'partner-1',
      })
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)
      mockChatRepo.createMessage.mockResolvedValue({ message, created: true })

      const result = await service.send(
        { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
        { body: 'At pickup', deliveryId: 'del-mine', clientMessageId: 'cli-1' }
      )

      expect(mockChatRepo.findOrCreateThread).toHaveBeenCalledWith({ courierId: 'courier-1' })
      expect(mockChatRepo.createMessage).toHaveBeenCalledWith({
        threadId: thread.id,
        senderKind: EnumChatSenderKind.COURIER,
        senderUserId: 'user-c1',
        body: 'At pickup',
        deliveryId: 'del-mine',
        clientMessageId: 'cli-1',
      })
      expect(result).toEqual({ thread, message })
      expect(mockDispatcher.sendChatMessageToDispatch).toHaveBeenCalledTimes(1)
    })

    test('with an allowed tag, the first send creates the thread (AC-1) for a restaurant (PARTNER) who has no chat thread yet', async () => {
      const thread = createPartnerThread()
      const message = createMessageRow(EnumChatSenderKind.PARTNER, thread.id, 'Food is ready')
      message.deliveryId = 'del-mine'

      mockChatRepo.findThreadByParty.mockResolvedValue(null)
      mockChatRepo.findDeliveryOwners.mockResolvedValue({
        courierId: 'courier-1',
        partnerId: 'partner-1',
      })
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)
      mockChatRepo.createMessage.mockResolvedValue({ message, created: true })

      const result = await service.send(
        { kind: 'PARTNER', userId: 'user-p1', partnerId: 'partner-1' },
        { body: 'Food is ready', deliveryId: 'del-mine', clientMessageId: 'cli-1' }
      )

      expect(mockChatRepo.findOrCreateThread).toHaveBeenCalledWith({ partnerId: 'partner-1' })
      expect(mockChatRepo.createMessage).toHaveBeenCalledWith({
        threadId: thread.id,
        senderKind: EnumChatSenderKind.PARTNER,
        senderUserId: 'user-p1',
        body: 'Food is ready',
        deliveryId: 'del-mine',
        clientMessageId: 'cli-1',
      })
      expect(result).toEqual({ thread, message })
      expect(mockDispatcher.sendChatMessageToDispatch).toHaveBeenCalledTimes(1)
    })

    test('with no tag, the first send creates the thread (AC-1) for a rider (COURIER) who has no chat thread yet', async () => {
      const thread = createCourierThread()
      const message = createMessageRow(EnumChatSenderKind.COURIER, thread.id, 'Hello dispatch')

      mockChatRepo.findThreadByParty.mockResolvedValue(null)
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)
      mockChatRepo.createMessage.mockResolvedValue({ message, created: true })

      const result = await service.send(
        { kind: 'COURIER', userId: 'user-c1', courierId: 'courier-1' },
        { body: 'Hello dispatch', clientMessageId: 'cli-1' }
      )

      expect(mockChatRepo.findOrCreateThread).toHaveBeenCalledWith({ courierId: 'courier-1' })
      expect(mockChatRepo.findDeliveryOwners).not.toHaveBeenCalled()
      expect(result).toEqual({ thread, message })
      expect(mockDispatcher.sendChatMessageToDispatch).toHaveBeenCalledTimes(1)
    })

    test('with no tag, the first send creates the thread (AC-1) for a restaurant (PARTNER) who has no chat thread yet', async () => {
      const thread = createPartnerThread()
      const message = createMessageRow(EnumChatSenderKind.PARTNER, thread.id, 'Hello dispatch')

      mockChatRepo.findThreadByParty.mockResolvedValue(null)
      mockChatRepo.findOrCreateThread.mockResolvedValue(thread)
      mockChatRepo.createMessage.mockResolvedValue({ message, created: true })

      const result = await service.send(
        { kind: 'PARTNER', userId: 'user-p1', partnerId: 'partner-1' },
        { body: 'Hello dispatch', clientMessageId: 'cli-1' }
      )

      expect(mockChatRepo.findOrCreateThread).toHaveBeenCalledWith({ partnerId: 'partner-1' })
      expect(mockChatRepo.findDeliveryOwners).not.toHaveBeenCalled()
      expect(result).toEqual({ thread, message })
      expect(mockDispatcher.sendChatMessageToDispatch).toHaveBeenCalledTimes(1)
    })
  })

  describe('AC-7: markReadByDispatch live event emission', () => {
    test('when markReadByDispatch moved: true, emits CHAT_THREAD_READ to dispatch and CHAT_READ_BY_DISPATCH to courier', async () => {
      const thread = createCourierThread()
      const readAt = new Date('2026-11-17T12:00:00.000Z')
      mockChatRepo.findThreadById.mockResolvedValue(thread)
      mockChatRepo.markReadByDispatch.mockResolvedValue({
        dispatchLastReadAt: readAt,
        moved: true,
      })

      const result = await service.markReadByDispatch(thread.id)

      expect(result).toBe(readAt)
      expect(mockDispatcher.sendChatThreadRead).toHaveBeenCalledWith({
        threadId: thread.id,
        dispatchLastReadAt: readAt.toISOString(),
      })
      expect(mockDispatcher.sendChatReadByDispatch).toHaveBeenCalledWith('user-c1', {
        dispatchLastReadAt: readAt.toISOString(),
      })
    })

    test('when markReadByDispatch moved: false, emits NO live events', async () => {
      const thread = createCourierThread()
      const readAt = new Date('2026-11-17T12:00:00.000Z')
      mockChatRepo.findThreadById.mockResolvedValue(thread)
      mockChatRepo.markReadByDispatch.mockResolvedValue({
        dispatchLastReadAt: readAt,
        moved: false,
      })

      const result = await service.markReadByDispatch(thread.id)

      expect(result).toBe(readAt)
      expect(mockDispatcher.sendChatThreadRead).not.toHaveBeenCalled()
      expect(mockDispatcher.sendChatReadByDispatch).not.toHaveBeenCalled()
    })
  })

  describe('unreadThreadsForBoard (AC-17 board support)', () => {
    test('returns empty array when there are no unread threads', async () => {
      mockChatRepo.findUnreadThreads.mockResolvedValue([])

      const result = await service.unreadThreadsForBoard()

      expect(result).toEqual([])
      expect(mockChatRepo.findThreadsByIds).not.toHaveBeenCalled()
      expect(mockChatRepo.findNewestUnreadBodies).not.toHaveBeenCalled()
    })

    test('uses findThreadsByIds with every unread id (more than 50 unread threads all appear; none dropped)', async () => {
      const unread = Array.from({ length: 60 }, (_, i) => ({
        threadId: `thread-${i + 1}`,
        oldestUnreadAt: new Date(`2026-11-17T09:${String(i).padStart(2, '0')}:00.000Z`),
      }))
      mockChatRepo.findUnreadThreads.mockResolvedValue(unread)

      const threads = unread.map((u, i) => ({
        id: u.threadId,
        courierId: `courier-${i + 1}`,
        partnerId: null,
        lastMessageAt: new Date('2026-11-17T10:00:00.000Z'),
        dispatchLastReadAt: null,
        createdAt: new Date('2026-11-17T08:00:00.000Z'),
        courier: {
          id: `courier-${i + 1}`,
          userId: `user-${i + 1}`,
          firstName: `Rider${i + 1}`,
          lastName: 'Test',
          phoneNumber: '+3069000000',
          status: EnumCourierStatus.ONLINE,
        },
        partner: null,
      } as unknown as ChatThreadRow))
      mockChatRepo.findThreadsByIds.mockResolvedValue(threads)

      const previews = new Map(unread.map((u, i) => [u.threadId, `Preview message ${i + 1}`]))
      mockChatRepo.findNewestUnreadBodies.mockResolvedValue(previews)

      const result = await service.unreadThreadsForBoard()

      expect(mockChatRepo.findThreadsByIds).toHaveBeenCalledWith(unread.map((u) => u.threadId))
      expect(mockChatRepo.findNewestUnreadBodies).toHaveBeenCalledWith(unread.map((u) => u.threadId))
      expect(result).toHaveLength(60)
      expect(result[0]).toEqual({
        threadId: 'thread-1',
        oldestUnreadAt: unread[0]!.oldestUnreadAt,
        courierId: 'courier-1',
        name: 'Rider1 Test',
        lastMessageBody: 'Preview message 1',
      })
      expect(result[59]).toEqual({
        threadId: 'thread-60',
        oldestUnreadAt: unread[59]!.oldestUnreadAt,
        courierId: 'courier-60',
        name: 'Rider60 Test',
        lastMessageBody: 'Preview message 60',
      })
    })

    test('preview is the newest unread COURIER or PARTNER body from findNewestUnreadBodies, never DISPATCH or SYSTEM', async () => {
      const oldestUnreadAt = new Date('2026-11-17T09:00:00.000Z')
      mockChatRepo.findUnreadThreads.mockResolvedValue([
        { threadId: 'thread-c1', oldestUnreadAt },
      ])
      const thread = createCourierThread()
      mockChatRepo.findThreadsByIds.mockResolvedValue([thread])
      mockChatRepo.findNewestUnreadBodies.mockResolvedValue(
        new Map([['thread-c1', 'Rider message text']])
      )

      const result = await service.unreadThreadsForBoard()

      expect(result).toHaveLength(1)
      expect(result[0]!.lastMessageBody).toBe('Rider message text')
    })
  })

  describe('listThreads (AC-2, review Major 3)', () => {
    test('Unread tab intersected with search: filters search match ids by unread ids', async () => {
      mockChatRepo.findUnreadThreads.mockResolvedValue([
        { threadId: 'thread-2', oldestUnreadAt: new Date() },
        { threadId: 'thread-3', oldestUnreadAt: new Date() },
        { threadId: 'thread-4', oldestUnreadAt: new Date() },
      ])
      mockChatRepo.findThreadIdsMatching.mockResolvedValue(['thread-1', 'thread-2', 'thread-3'])
      mockChatRepo.findThreadPage.mockResolvedValue({ threads: [], total: 0 })
      mockChatRepo.findLastMessages.mockResolvedValue({ last: new Map(), lastTagged: new Map() })

      await service.listThreads({ tab: 'UNREAD', search: 'Pizza', page: 1 })

      expect(mockChatRepo.findThreadPage).toHaveBeenCalledWith({
        courierOnly: false,
        partnerOnly: false,
        ids: ['thread-2', 'thread-3'],
        page: 1,
      })
    })

    test('Unread tab without search passes all unread ids to findThreadPage', async () => {
      mockChatRepo.findUnreadThreads.mockResolvedValue([
        { threadId: 'thread-A', oldestUnreadAt: new Date() },
        { threadId: 'thread-B', oldestUnreadAt: new Date() },
      ])
      mockChatRepo.findThreadPage.mockResolvedValue({ threads: [], total: 0 })
      mockChatRepo.findLastMessages.mockResolvedValue({ last: new Map(), lastTagged: new Map() })

      await service.listThreads({ tab: 'UNREAD', page: 1 })

      expect(mockChatRepo.findThreadPage).toHaveBeenCalledWith({
        courierOnly: false,
        partnerOnly: false,
        ids: ['thread-A', 'thread-B'],
        page: 1,
      })
    })

    test('Couriers filter sets courierOnly: true, partnerOnly: false', async () => {
      mockChatRepo.findUnreadThreads.mockResolvedValue([])
      mockChatRepo.findThreadPage.mockResolvedValue({ threads: [], total: 0 })
      mockChatRepo.findLastMessages.mockResolvedValue({ last: new Map(), lastTagged: new Map() })

      await service.listThreads({ tab: 'COURIERS', page: 2 })

      expect(mockChatRepo.findThreadPage).toHaveBeenCalledWith({
        courierOnly: true,
        partnerOnly: false,
        ids: null,
        page: 2,
      })
    })

    test('Restaurants filter sets courierOnly: false, partnerOnly: true', async () => {
      mockChatRepo.findUnreadThreads.mockResolvedValue([])
      mockChatRepo.findThreadPage.mockResolvedValue({ threads: [], total: 0 })
      mockChatRepo.findLastMessages.mockResolvedValue({ last: new Map(), lastTagged: new Map() })

      await service.listThreads({ tab: 'RESTAURANTS', page: 1 })

      expect(mockChatRepo.findThreadPage).toHaveBeenCalledWith({
        courierOnly: false,
        partnerOnly: true,
        ids: null,
        page: 1,
      })
    })

    test('pages with 50 per page and attaches last and tagged messages to each thread', async () => {
      mockChatRepo.findUnreadThreads.mockResolvedValue([{ threadId: 'thread-c1', oldestUnreadAt: new Date() }])
      const thread = createCourierThread()
      mockChatRepo.findThreadPage.mockResolvedValue({ threads: [thread], total: 105 })

      const lastMsg = createMessageRow(EnumChatSenderKind.COURIER, thread.id, 'Last message')
      const taggedMsg = {
        ...createMessageRow(EnumChatSenderKind.COURIER, thread.id, 'Tagged message'),
        deliveryId: 'del-101',
        delivery: { orderReference: 'ORD-500' } as any,
      }

      mockChatRepo.findLastMessages.mockResolvedValue({
        last: new Map([[thread.id, lastMsg]]),
        lastTagged: new Map([[thread.id, taggedMsg]]),
      })

      const result = await service.listThreads({ tab: 'ALL', page: 2 })

      expect(result.perPage).toBe(CHAT_PAGE_SIZE)
      expect(result.perPage).toBe(50)
      expect(result.page).toBe(2)
      expect(result.total).toBe(105)
      expect(result.threads).toHaveLength(1)
      expect(result.threads[0]).toEqual({
        id: thread.id,
        kind: 'COURIER',
        courierId: 'courier-1',
        partnerId: null,
        name: 'Nikos Papas',
        lastMessageAt: thread.lastMessageAt,
        lastMessage: expect.objectContaining({ body: 'Last message' }),
        linkedDeliveryId: 'del-101',
        linkedOrderReference: 'ORD-500',
        unread: true,
      })
    })
  })

  describe('getThreadDetail (AC-3, review Major 3)', () => {
    test('throws 404 NotFoundException for unknown thread', async () => {
      mockChatRepo.findThreadById.mockResolvedValue(null)

      await expect(service.getThreadDetail('unknown-id')).rejects.toThrow(
        new NotFoundException('Chat thread unknown-id not found')
      )
    })

    test('computes moreActiveDeliveries from total minus deliveries length', async () => {
      const thread = createCourierThread()
      mockChatRepo.findThreadById.mockResolvedValue(thread)

      mockChatRepo.findActiveDeliveries.mockResolvedValue({
        deliveries: [
          { id: 'd1', orderReference: 'ORD-1', status: 'DISPATCHED' } as any,
          { id: 'd2', orderReference: 'ORD-2', status: 'ACCEPTED' } as any,
          { id: 'd3', orderReference: 'ORD-3', status: 'ACCEPTED' } as any,
          { id: 'd4', orderReference: 'ORD-4', status: 'ACCEPTED' } as any,
          { id: 'd5', orderReference: 'ORD-5', status: 'ACCEPTED' } as any,
        ],
        total: 7,
      })
      ;(mockConfigService.instanceConfig.getChatQuickRepliesDispatch as jest.Mock).mockResolvedValue([
        'Περίμενε 5 λεπτά',
      ])

      const detail = await service.getThreadDetail(thread.id)

      expect(detail.id).toBe(thread.id)
      expect(detail.kind).toBe('COURIER')
      expect(detail.name).toBe('Nikos Papas')
      expect(detail.activeDeliveries).toHaveLength(5)
      expect(detail.moreActiveDeliveries).toBe(2)
      expect(detail.quickReplies).toEqual(['Περίμενε 5 λεπτά'])
    })
  })

  describe('listMessagesForAdmin (review Major 3)', () => {
    test('throws 404 NotFoundException for unknown thread', async () => {
      mockChatRepo.findThreadById.mockResolvedValue(null)

      await expect(service.listMessagesForAdmin('thread-none', { before: 'm1' })).rejects.toThrow(
        new NotFoundException('Chat thread thread-none not found')
      )
    })

    test('maps messages to ChatMessageAdminDto with thread participant name', async () => {
      const thread = createCourierThread()
      mockChatRepo.findThreadById.mockResolvedValue(thread)
      const msg = createMessageRow(EnumChatSenderKind.COURIER, thread.id, 'Hello')
      mockChatRepo.findMessages.mockResolvedValue([msg])

      const result = await service.listMessagesForAdmin(thread.id, { before: 'm1' })

      expect(result).toHaveLength(1)
      expect(result[0]!.senderName).toBe('Nikos Papas')
      expect(result[0]!.body).toBe('Hello')
    })
  })

  describe('listMessagesForParty (AC-21, AC-6, review Major 3)', () => {
    test('returns empty array when party has no thread yet (never creates or accesses another thread)', async () => {
      mockChatRepo.findThreadByParty.mockResolvedValue(null)

      const result = await service.listMessagesForParty({ courierId: 'courier-new' }, {})

      expect(result).toEqual([])
      expect(mockChatRepo.findMessages).not.toHaveBeenCalled()
    })

    test('computes readByDispatch from dispatchLastReadAt on COURIER and PARTNER messages only, and absent on others', async () => {
      const readAt = new Date('2026-11-17T12:00:00.000Z')
      const thread = { ...createCourierThread(), dispatchLastReadAt: readAt }
      mockChatRepo.findThreadByParty.mockResolvedValue(thread)

      const courierReadMsg = {
        ...createMessageRow(EnumChatSenderKind.COURIER, thread.id, 'Read courier message'),
        createdAt: new Date('2026-11-17T11:59:00.000Z'),
      }
      const courierUnreadMsg = {
        ...createMessageRow(EnumChatSenderKind.COURIER, thread.id, 'Unread courier message'),
        createdAt: new Date('2026-11-17T12:01:00.000Z'),
      }
      const dispatchMsg = {
        ...createMessageRow(EnumChatSenderKind.DISPATCH, thread.id, 'Dispatch reply'),
        createdAt: new Date('2026-11-17T11:50:00.000Z'),
      }
      const systemMsg = {
        ...createMessageRow(EnumChatSenderKind.SYSTEM, thread.id, 'System line'),
        createdAt: new Date('2026-11-17T11:55:00.000Z'),
      }

      mockChatRepo.findMessages.mockResolvedValue([
        courierReadMsg,
        courierUnreadMsg,
        dispatchMsg,
        systemMsg,
      ])

      const result = await service.listMessagesForParty({ courierId: 'courier-1' }, {})

      expect(result).toHaveLength(4)

      // Courier message before readAt -> readByDispatch: true
      expect(result[0]!.readByDispatch).toBe(true)

      // Courier message after readAt -> readByDispatch: false
      expect(result[1]!.readByDispatch).toBe(false)

      // DISPATCH message -> readByDispatch is absent (not false)
      expect(result[2]!.readByDispatch).toBeUndefined()
      expect('readByDispatch' in result[2]!).toBe(false)

      // SYSTEM message -> readByDispatch is absent (not false)
      expect(result[3]!.readByDispatch).toBeUndefined()
      expect('readByDispatch' in result[3]!).toBe(false)
    })
  })
})
