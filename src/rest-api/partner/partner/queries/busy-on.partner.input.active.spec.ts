import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { BusyOnPartnerInput } from './busy-on.partner.input'

// Spec 0029, AC-1: extraMinutes must be a real JSON number from [5, 10, 15, 20, 30].
// Any other value or text number is 400.
describe('BusyOnPartnerInput through ValidationPipe (spec 0029, AC-1)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const transform = (body: unknown) => pipe.transform(body, { type: 'body', metatype: BusyOnPartnerInput })

  test.each([5, 10, 15, 20, 30])('accepts extraMinutes %d', async (extraMinutes) => {
    const result = (await transform({ extraMinutes })) as BusyOnPartnerInput

    expect(result).toBeInstanceOf(BusyOnPartnerInput)
    expect(result.extraMinutes).toBe(extraMinutes)
  })

  test.each([0, 1, 4, 6, 7, 12, 25, 45, 60, -5, 15.5])('refuses extraMinutes %p outside allowed list with 400', async (extraMinutes) => {
    await expect(transform({ extraMinutes })).rejects.toThrow(BadRequestException)
  })

  test('refuses text "15" with 400 (@RefuseIfNotSentAsNumber)', async () => {
    await expect(transform({ extraMinutes: '15' })).rejects.toThrow(BadRequestException)
  })

  test('refuses empty string, true, and missing extraMinutes with 400', async () => {
    await expect(transform({ extraMinutes: '' })).rejects.toThrow(BadRequestException)
    await expect(transform({ extraMinutes: true })).rejects.toThrow(BadRequestException)
    await expect(transform({})).rejects.toThrow(BadRequestException)
  })
})
