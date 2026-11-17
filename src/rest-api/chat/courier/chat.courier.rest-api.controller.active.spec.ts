import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA } from '@nestjs/common/constants'
import { ChatDomainService } from 'src/domains/chat/chat.domain.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { ChatCourierRestApiController } from './chat.courier.rest-api.controller'

describe('ChatCourierRestApiController (spec 0034, AC-4, AC-21, throttle)', () => {
  let controller: ChatCourierRestApiController
  let mockChatDomainService: jest.Mocked<ChatDomainService>

  const courier: CourierEntity = {
    id: 'courier-login-id-1',
    userId: 'user-login-id-1',
  } as unknown as CourierEntity

  beforeEach(() => {
    mockChatDomainService = {
      listMessagesForParty: jest.fn().mockResolvedValue([]),
      send: jest.fn().mockResolvedValue({
        thread: { dispatchLastReadAt: null } as any,
        message: { id: 'm1', senderKind: 'COURIER', createdAt: new Date() } as any,
      }),
      courierQuickReplies: jest.fn().mockResolvedValue(['Έφτασα']),
    } as unknown as jest.Mocked<ChatDomainService>

    controller = new ChatCourierRestApiController(mockChatDomainService)
  })

  describe('AC-21: courier routes derive courierId strictly from logged in session', () => {
    test('listMessages uses the authenticated courier id from CurrentUserCourier', async () => {
      await controller.listMessages(courier, { before: 'msg-prev' })

      expect(mockChatDomainService.listMessagesForParty).toHaveBeenCalledWith(
        { courierId: 'courier-login-id-1' },
        { before: 'msg-prev', after: undefined }
      )
    })

    test('send uses the authenticated courier and user id from CurrentUserCourier', async () => {
      await controller.send(courier, {
        body: 'At the door',
        clientMessageId: 'cli-1',
        deliveryId: 'del-1',
      })

      expect(mockChatDomainService.send).toHaveBeenCalledWith(
        {
          kind: 'COURIER',
          userId: 'user-login-id-1',
          courierId: 'courier-login-id-1',
        },
        {
          body: 'At the door',
          deliveryId: 'del-1',
          clientMessageId: 'cli-1',
        }
      )
    })
  })

  describe('Throttle metadata: GET routes skip throttle, POST routes do not', () => {
    test('GET routes carry @SkipThrottle() metadata', () => {
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', controller.listMessages)).toBe(true)
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', controller.quickReplies)).toBe(true)
    })

    test('POST routes DO NOT carry SkipThrottle metadata', () => {
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', controller.send)).toBeFalsy()
    })
  })

  describe('AC-4: immutability (no edit or delete routes exist)', () => {
    test('no route on ChatCourierRestApiController uses PUT, PATCH, or DELETE', () => {
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
