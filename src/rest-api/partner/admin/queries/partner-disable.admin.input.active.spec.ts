import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { PartnerDisableAdminInput } from './partner-disable.admin.input'

// Spec 0029, AC-5: reason is trimmed, 1 to 200 characters.
// Empty or over-long reason is 400.
describe('PartnerDisableAdminInput through ValidationPipe (spec 0029, AC-5)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const transform = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: PartnerDisableAdminInput })

  test('accepts valid reason between 1 and 200 characters', async () => {
    const result = (await transform({ reason: 'Overdue invoices' })) as PartnerDisableAdminInput

    expect(result).toBeInstanceOf(PartnerDisableAdminInput)
    expect(result.reason).toBe('Overdue invoices')
  })

  test('trims leading and trailing whitespace from reason', async () => {
    const result = (await transform({ reason: '   Kitchen under renovation   ' })) as PartnerDisableAdminInput

    expect(result.reason).toBe('Kitchen under renovation')
  })

  test('accepts maximum length of exactly 200 characters', async () => {
    const exactly200 = 'a'.repeat(200)
    const result = (await transform({ reason: exactly200 })) as PartnerDisableAdminInput

    expect(result.reason).toBe(exactly200)
  })

  test('refuses empty string reason with 400', async () => {
    await expect(transform({ reason: '' })).rejects.toThrow(BadRequestException)
  })

  test('refuses whitespace-only reason with 400 (trimmed down to 0 length)', async () => {
    await expect(transform({ reason: '     ' })).rejects.toThrow(BadRequestException)
  })

  test('refuses reason exceeding 200 characters with 400', async () => {
    const tooLong = 'a'.repeat(201)
    await expect(transform({ reason: tooLong })).rejects.toThrow(BadRequestException)
  })

  test('refuses missing reason with 400', async () => {
    await expect(transform({})).rejects.toThrow(BadRequestException)
  })

  test('refuses null or empty array reason with 400', async () => {
    await expect(transform({ reason: null })).rejects.toThrow(BadRequestException)
    await expect(transform({ reason: [] })).rejects.toThrow(BadRequestException)
  })
})
