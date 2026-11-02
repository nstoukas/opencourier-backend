import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { AcceptDeliveryCourierInput } from './accept-delivery.courier.input'

describe('AcceptDeliveryCourierInput through ValidationPipe (Spec 0020 AC-1)', () => {
  // Global ValidationPipe in main.ts uses enableImplicitConversion: true
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const transform = (body: any) =>
    pipe.transform(body, { type: 'body', metatype: AcceptDeliveryCourierInput })

  it('accepts automatic sent as boolean true', async () => {
    const result = (await transform({ automatic: true })) as AcceptDeliveryCourierInput
    expect(result).toBeInstanceOf(AcceptDeliveryCourierInput)
    expect(result.automatic).toBe(true)
  })

  it('accepts automatic sent as boolean false', async () => {
    const result = (await transform({ automatic: false })) as AcceptDeliveryCourierInput
    expect(result).toBeInstanceOf(AcceptDeliveryCourierInput)
    expect(result.automatic).toBe(false)
  })

  it('accepts empty body or omitted automatic (automatic is undefined)', async () => {
    const emptyResult = (await transform({})) as AcceptDeliveryCourierInput
    expect(emptyResult).toBeInstanceOf(AcceptDeliveryCourierInput)
    expect(emptyResult.automatic).toBeUndefined()
  })

  it('refuses automatic sent as string "true" with BadRequestException (@RefuseIfNotSentAsBoolean)', async () => {
    await expect(transform({ automatic: 'true' })).rejects.toThrow(BadRequestException)
    await expect(transform({ automatic: 'true' })).rejects.toThrow('automatic must be sent as true or false')
  })

  it('refuses automatic sent as string "false" with BadRequestException (@RefuseIfNotSentAsBoolean)', async () => {
    await expect(transform({ automatic: 'false' })).rejects.toThrow(BadRequestException)
    await expect(transform({ automatic: 'false' })).rejects.toThrow('automatic must be sent as true or false')
  })

  it('refuses automatic sent as number (1 or 0) with BadRequestException', async () => {
    await expect(transform({ automatic: 1 })).rejects.toThrow(BadRequestException)
    await expect(transform({ automatic: 0 })).rejects.toThrow(BadRequestException)
  })

  it('refuses automatic sent as null with BadRequestException', async () => {
    await expect(transform({ automatic: null })).rejects.toThrow(BadRequestException)
  })
})
