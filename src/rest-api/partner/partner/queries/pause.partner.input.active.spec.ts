import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { PausePartnerInput } from './pause.partner.input'

// Spec 0029, AC-3: minutes must be a real JSON number from [15, 30, 60, 120].
// Any other value or text number is 400.
describe('PausePartnerInput through ValidationPipe (spec 0029, AC-3)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const transform = (body: unknown) => pipe.transform(body, { type: 'body', metatype: PausePartnerInput })

  test.each([15, 30, 60, 120])('accepts minutes %d', async (minutes) => {
    const result = (await transform({ minutes })) as PausePartnerInput

    expect(result).toBeInstanceOf(PausePartnerInput)
    expect(result.minutes).toBe(minutes)
  })

  test.each([0, 5, 10, 20, 25, 45, 90, 180, -15, 30.5])('refuses minutes %p outside allowed list with 400', async (minutes) => {
    await expect(transform({ minutes })).rejects.toThrow(BadRequestException)
  })

  test('refuses text "30" with 400 (@RefuseIfNotSentAsNumber)', async () => {
    await expect(transform({ minutes: '30' })).rejects.toThrow(BadRequestException)
  })

  test('refuses empty string, true, and missing minutes with 400', async () => {
    await expect(transform({ minutes: '' })).rejects.toThrow(BadRequestException)
    await expect(transform({ minutes: true })).rejects.toThrow(BadRequestException)
    await expect(transform({})).rejects.toThrow(BadRequestException)
  })
})
