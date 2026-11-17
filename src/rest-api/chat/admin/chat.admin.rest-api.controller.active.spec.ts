import { BadRequestException, RequestMethod } from '@nestjs/common'
import { METHOD_METADATA } from '@nestjs/common/constants'
import { ChatDomainService } from 'src/domains/chat/chat.domain.service'
import { ChatAdminRestApiController } from './chat.admin.rest-api.controller'

describe('ChatAdminRestApiController (spec 0034, AC-4, AC-15, throttle)', () => {
  let controller: ChatAdminRestApiController
  let mockChatDomainService: jest.Mocked<ChatDomainService>

  beforeEach(() => {
    mockChatDomainService = {
      listThreads: jest.fn(),
      unreadCount: jest.fn(),
      openThread: jest.fn(),
      getThreadDetail: jest.fn().mockResolvedValue({
        id: 'thread-1',
        kind: 'COURIER',
        courierId: 'c-1',
        partnerId: null,
        name: 'Nikos',
        phoneNumber: null,
        courierStatus: null,
        activeDeliveries: [],
        moreActiveDeliveries: 0,
        quickReplies: [],
        dispatchLastReadAt: null,
      }),
      listMessagesForAdmin: jest.fn(),
      send: jest.fn().mockResolvedValue({
        thread: { courier: { firstName: 'Nikos', lastName: 'Papas' } } as any,
        message: { id: 'm1', threadId: 't1', senderKind: 'DISPATCH', body: 'hi', createdAt: new Date() } as any,
      }),
      markReadByDispatch: jest.fn().mockResolvedValue(new Date()),
    } as unknown as jest.Mocked<ChatDomainService>

    controller = new ChatAdminRestApiController(mockChatDomainService)
  })

  describe('AC-15: openThread input validation (both or neither id refused)', () => {
    test('throws 400 when both courierId and partnerId are provided', async () => {
      await expect(
        controller.openThread({ courierId: 'courier-1', partnerId: 'partner-1' })
      ).rejects.toThrow(new BadRequestException('Send exactly one of courierId and partnerId'))
      expect(mockChatDomainService.openThread).not.toHaveBeenCalled()
    })

    test('throws 400 when neither courierId nor partnerId is provided (both empty)', async () => {
      await expect(
        controller.openThread({ courierId: '', partnerId: '' })
      ).rejects.toThrow(new BadRequestException('Send exactly one of courierId and partnerId'))

      await expect(
        controller.openThread({})
      ).rejects.toThrow(new BadRequestException('Send exactly one of courierId and partnerId'))

      expect(mockChatDomainService.openThread).not.toHaveBeenCalled()
    })

    test('calls domain service with courierId when only courierId is provided', async () => {
      mockChatDomainService.openThread.mockResolvedValue({ id: 'thread-c1' } as any)

      await controller.openThread({ courierId: 'courier-1' })

      expect(mockChatDomainService.openThread).toHaveBeenCalledWith({ courierId: 'courier-1' })
      expect(mockChatDomainService.getThreadDetail).toHaveBeenCalledWith('thread-c1')
    })

    test('calls domain service with partnerId when only partnerId is provided', async () => {
      mockChatDomainService.openThread.mockResolvedValue({ id: 'thread-p1' } as any)

      await controller.openThread({ partnerId: 'partner-1' })

      expect(mockChatDomainService.openThread).toHaveBeenCalledWith({ partnerId: 'partner-1' })
      expect(mockChatDomainService.getThreadDetail).toHaveBeenCalledWith('thread-p1')
    })
  })

  describe('Throttle metadata: GET routes skip throttle, POST routes do not', () => {
    test('GET routes carry @SkipThrottle() metadata', () => {
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', controller.listThreads)).toBe(true)
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', controller.unreadCount)).toBe(true)
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', controller.getThread)).toBe(true)
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', controller.listMessages)).toBe(true)
    })

    test('POST routes DO NOT carry SkipThrottle metadata', () => {
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', controller.openThread)).toBeFalsy()
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', controller.send)).toBeFalsy()
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', controller.markRead)).toBeFalsy()
    })
  })

  describe('AC-4: immutability (no edit or delete routes exist)', () => {
    test('no route on ChatAdminRestApiController uses PUT, PATCH, or DELETE', () => {
      const prototype = Object.getPrototypeOf(controller)
      const methods = Object.getOwnPropertyNames(prototype).filter((p) => p !== 'constructor')

      for (const method of methods) {
        const httpMethod = Reflect.getMetadata(METHOD_METADATA, prototype[method])
        expect(httpMethod).not.toBe(RequestMethod.PUT)
        expect(httpMethod).not.toBe(RequestMethod.PATCH)
        expect(httpMethod).not.toBe(RequestMethod.DELETE)
      }
    })
  })
})
