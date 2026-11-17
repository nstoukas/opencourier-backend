import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { InstanceConfigSettingsAdminInput } from 'src/rest-api/config/admin/queries/instance-config-settings.admin.input'
import { ChatOpenThreadAdminInput, ChatSendInputDto } from './chat.inputs'

describe('ChatSendInputDto & RefuseIfNotSentAsString (spec 0034, commit 46d2cf5, row 111)', () => {
  // ValidationPipe configured with exact main.ts options (enableImplicitConversion: true)
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  })

  describe('deliveryId null handling (untagged messages from side menu, commit 46d2cf5)', () => {
    test('ChatSendInputDto with deliveryId: null is accepted and comes out as null (no tag)', async () => {
      const result = (await pipe.transform(
        {
          body: 'Hello dispatch',
          clientMessageId: 'cli-msg-1',
          deliveryId: null,
        },
        { type: 'body', metatype: ChatSendInputDto }
      )) as ChatSendInputDto

      expect(result).toBeInstanceOf(ChatSendInputDto)
      expect(result.deliveryId).toBeNull()
      expect(result.body).toBe('Hello dispatch')
      expect(result.clientMessageId).toBe('cli-msg-1')
    })

    test('ChatSendInputDto with deliveryId left out is accepted (comes out undefined)', async () => {
      const result = (await pipe.transform(
        {
          body: 'Hello dispatch',
          clientMessageId: 'cli-msg-2',
        },
        { type: 'body', metatype: ChatSendInputDto }
      )) as ChatSendInputDto

      expect(result).toBeInstanceOf(ChatSendInputDto)
      expect(result.deliveryId).toBeUndefined()
      expect(result.body).toBe('Hello dispatch')
      expect(result.clientMessageId).toBe('cli-msg-2')
    })

    test('ChatSendInputDto with deliveryId as a string is accepted as that string', async () => {
      const result = (await pipe.transform(
        {
          body: 'Problem at customer',
          clientMessageId: 'cli-msg-3',
          deliveryId: 'del-uuid-1234',
        },
        { type: 'body', metatype: ChatSendInputDto }
      )) as ChatSendInputDto

      expect(result).toBeInstanceOf(ChatSendInputDto)
      expect(result.deliveryId).toBe('del-uuid-1234')
      expect(result.body).toBe('Problem at customer')
      expect(result.clientMessageId).toBe('cli-msg-3')
    })

    test('ChatSendInputDto with deliveryId sent as a number (e.g. 42) is refused with 400 ("deliveryId must be sent as text")', async () => {
      for (const invalidNum of [42, 0, -1, 3.14]) {
        const promise = pipe.transform(
          {
            body: 'Hello',
            clientMessageId: 'cli-num-test',
            deliveryId: invalidNum,
          },
          { type: 'body', metatype: ChatSendInputDto }
        )
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow('deliveryId must be sent as text')
      }
    })

    test('ChatSendInputDto with deliveryId sent as an object, array or boolean is refused with 400 ("deliveryId must be sent as text")', async () => {
      for (const invalidVal of [{}, { id: 'del-1' }, [], ['del-1'], true, false]) {
        const promise = pipe.transform(
          {
            body: 'Hello',
            clientMessageId: 'cli-obj-test',
            deliveryId: invalidVal,
          },
          { type: 'body', metatype: ChatSendInputDto }
        )
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow('deliveryId must be sent as text')
      }
    })
  })

  describe('RefuseIfNotSentAsString() without option still refuses null with 400', () => {
    test('instance settings input dispatchPhoneNumber refuses null with 400 BadRequestException', async () => {
      const promise = pipe.transform(
        { dispatchPhoneNumber: null },
        { type: 'body', metatype: InstanceConfigSettingsAdminInput }
      )
      await expect(promise).rejects.toBeInstanceOf(BadRequestException)
      await expect(promise).rejects.toThrow('dispatchPhoneNumber must be sent as text')
    })

    test('instance settings input cancellationPayoutPolicy refuses null with 400 BadRequestException', async () => {
      const promise = pipe.transform(
        { cancellationPayoutPolicy: null },
        { type: 'body', metatype: InstanceConfigSettingsAdminInput }
      )
      await expect(promise).rejects.toBeInstanceOf(BadRequestException)
      await expect(promise).rejects.toThrow('cancellationPayoutPolicy must be sent as text')
    })

    test('ChatSendInputDto body and clientMessageId still refuse null with 400 BadRequestException', async () => {
      const promiseBody = pipe.transform(
        {
          body: null,
          clientMessageId: 'cli-1',
        },
        { type: 'body', metatype: ChatSendInputDto }
      )
      await expect(promiseBody).rejects.toBeInstanceOf(BadRequestException)
      await expect(promiseBody).rejects.toThrow('body must be sent as text')

      const promiseClientMsgId = pipe.transform(
        {
          body: 'Hello',
          clientMessageId: null,
        },
        { type: 'body', metatype: ChatSendInputDto }
      )
      await expect(promiseClientMsgId).rejects.toBeInstanceOf(BadRequestException)
      await expect(promiseClientMsgId).rejects.toThrow('clientMessageId must be sent as text')
    })

    test('ChatOpenThreadAdminInput courierId and partnerId refuse null with 400 BadRequestException', async () => {
      const promiseCourier = pipe.transform(
        { courierId: null },
        { type: 'body', metatype: ChatOpenThreadAdminInput }
      )
      await expect(promiseCourier).rejects.toBeInstanceOf(BadRequestException)
      await expect(promiseCourier).rejects.toThrow('courierId must be sent as text')

      const promisePartner = pipe.transform(
        { partnerId: null },
        { type: 'body', metatype: ChatOpenThreadAdminInput }
      )
      await expect(promisePartner).rejects.toBeInstanceOf(BadRequestException)
      await expect(promisePartner).rejects.toThrow('partnerId must be sent as text')
    })
  })
})
