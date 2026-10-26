import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { SavedCustomerUpdateInput } from './saved-customer-update.input'

describe('SavedCustomerUpdateInput through ValidationPipe (Spec 0005)', () => {
  // Real Nest ValidationPipe built with exact options from src/main.ts
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  })

  const transform = (body: any) =>
    pipe.transform(body, { type: 'body', metatype: SavedCustomerUpdateInput })

  it('allows null to pass the pipe for name (@IsOptional allows null; domain service handles 422)', async () => {
    const transformed = await transform({ name: null })
    expect(transformed).toBeInstanceOf(SavedCustomerUpdateInput)
    expect(transformed.name).toBeNull()
  })

  it('refuses markUsed "false" with 400 BadRequestException (@RefuseIfNotSentAsBoolean)', async () => {
    await expect(transform({ markUsed: 'false' })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('passes validation for an empty body', async () => {
    const transformed = await transform({})
    expect(transformed).toBeInstanceOf(SavedCustomerUpdateInput)
    expect(Object.keys(transformed).length).toBe(0)
  })
})
