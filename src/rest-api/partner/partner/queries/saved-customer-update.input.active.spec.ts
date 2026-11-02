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

  it('accepts valid floor (<= 20 chars) and doorbell (<= 60 chars) (Spec 0016 AC-3)', async () => {
    const transformed = await transform({
      floor: '3rd floor',
      doorbell: 'Papadopoulou',
    })
    expect(transformed.floor).toBe('3rd floor')
    expect(transformed.doorbell).toBe('Papadopoulou')
  })

  it('allows null for floor and doorbell', async () => {
    const transformed = await transform({
      floor: null,
      doorbell: null,
    })
    expect(transformed.floor).toBeNull()
    expect(transformed.doorbell).toBeNull()
  })

  it('refuses floor longer than 20 characters with 400 BadRequestException (Spec 0016 AC-3)', async () => {
    await expect(
      transform({ floor: '123456789012345678901' })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses doorbell longer than 60 characters with 400 BadRequestException (Spec 0016 AC-3)', async () => {
    await expect(
      transform({ doorbell: 'A'.repeat(61) })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses non-string floor or doorbell with 400 BadRequestException (Spec 0016 AC-3)', async () => {
    await expect(
      transform({ floor: 123 })
    ).rejects.toBeInstanceOf(BadRequestException)

    await expect(
      transform({ doorbell: true })
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
