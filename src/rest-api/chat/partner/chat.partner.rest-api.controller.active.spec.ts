import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA } from '@nestjs/common/constants'
import { IS_API_KEY_AUTH } from 'src/decorators/api-key-auth.decorator'
import { ChatDomainService } from 'src/domains/chat/chat.domain.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { ChatPartnerRestApiController } from './chat.partner.rest-api.controller'

describe('ChatPartnerRestApiController (spec 0034, AC-4, AC-21, throttle, no ApiKeyAuth)', () => {
  let controller: ChatPartnerRestApiController
  let mockChatDomainService: jest.Mocked<ChatDomainService>

  const partner: PartnerEntity = {
    id: 'partner-login-id-1',
    userId: 'user-partner-1',
  } as unknown as PartnerEntity

  beforeEach(() => {
    mockChatDomainService = {
      listMessagesForParty: jest.fn().mockResolvedValue([]),
      send: jest.fn().mockResolvedValue({
        thread: { dispatchLastReadAt: null } as any,
        message: { id: 'm1', senderKind: 'PARTNER', createdAt: new Date() } as any,
      }),
    } as unknown as jest.Mocked<ChatDomainService>

    controller = new ChatPartnerRestApiController(mockChatDomainService)
  })

  describe('AC-21: partner routes derive partnerId strictly from logged in session', () => {
    test('listMessages uses authenticated partner id from CurrentUserPartner', async () => {
      await controller.listMessages(partner, { before: 'msg-prev' })

      expect(mockChatDomainService.listMessagesForParty).toHaveBeenCalledWith(
        { partnerId: 'partner-login-id-1' },
        { before: 'msg-prev', after: undefined }
      )
    })

    test('send uses authenticated partner and user id from CurrentUserPartner', async () => {
      await controller.send(partner, {
        body: 'Delay on order',
        clientMessageId: 'cli-p-1',
        deliveryId: 'del-p-1',
      })

      expect(mockChatDomainService.send).toHaveBeenCalledWith(
        {
          kind: 'PARTNER',
          userId: 'user-partner-1',
          partnerId: 'partner-login-id-1',
        },
        {
          body: 'Delay on order',
          deliveryId: 'del-p-1',
          clientMessageId: 'cli-p-1',
        }
      )
    })
  })

  describe('Decision 111.4: NO @ApiKeyAuth() on chat routes (signed in session only)', () => {
    test('neither the controller class nor any of its route handlers carry IS_API_KEY_AUTH metadata', () => {
      // Controller class level
      expect(Reflect.getMetadata(IS_API_KEY_AUTH, ChatPartnerRestApiController)).toBeFalsy()

      // Method handlers level
      expect(Reflect.getMetadata(IS_API_KEY_AUTH, controller.listMessages)).toBeFalsy()
      expect(Reflect.getMetadata(IS_API_KEY_AUTH, controller.send)).toBeFalsy()
    })
  })

  describe('Throttle metadata: GET routes skip throttle, POST routes do not', () => {
    test('GET route carries @SkipThrottle() metadata', () => {
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', controller.listMessages)).toBe(true)
    })

    test('POST route DOES NOT carry SkipThrottle metadata', () => {
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', controller.send)).toBeFalsy()
    })
  })

  describe('AC-4: immutability (no edit or delete routes exist)', () => {
    test('no route on ChatPartnerRestApiController uses PUT, PATCH, or DELETE', () => {
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
