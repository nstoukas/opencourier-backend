import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { EnumProductReportKind } from '@prisma/types'
import { ProductReportCreatePartnerInput } from './product-report-create.partner.input'

describe('ProductReportCreatePartnerInput through ValidationPipe (Spec 0032, AC-1)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const transform = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: ProductReportCreatePartnerInput })

  test.each([EnumProductReportKind.WRONG_ITEM, EnumProductReportKind.MISSING_ITEM])(
    'accepts valid kind %s with optional fields',
    async (kind) => {
      const result = (await transform({
        kind,
        itemName: 'Coke Zero',
        note: 'Customer received normal Coke',
      })) as ProductReportCreatePartnerInput

      expect(result).toBeInstanceOf(ProductReportCreatePartnerInput)
      expect(result.kind).toBe(kind)
      expect(result.itemName).toBe('Coke Zero')
      expect(result.note).toBe('Customer received normal Coke')
    }
  )

  test('accepts missing optional fields', async () => {
    const result = (await transform({
      kind: EnumProductReportKind.MISSING_ITEM,
    })) as ProductReportCreatePartnerInput

    expect(result.kind).toBe(EnumProductReportKind.MISSING_ITEM)
    expect(result.itemName).toBeUndefined()
    expect(result.note).toBeUndefined()
  })

  test('refuses missing kind with 400 BadRequestException', async () => {
    await expect(transform({ itemName: 'Drink' })).rejects.toBeInstanceOf(BadRequestException)
  })

  test('refuses invalid kind enum value with 400 BadRequestException', async () => {
    await expect(transform({ kind: 'COLD_FOOD', itemName: 'Drink' })).rejects.toBeInstanceOf(
      BadRequestException
    )
  })

  test('refuses itemName longer than 120 characters with 400 BadRequestException', async () => {
    await expect(
      transform({
        kind: EnumProductReportKind.MISSING_ITEM,
        itemName: 'a'.repeat(121),
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  test('refuses note longer than 500 characters with 400 BadRequestException', async () => {
    await expect(
      transform({
        kind: EnumProductReportKind.MISSING_ITEM,
        note: 'b'.repeat(501),
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  test('refuses itemName sent as number (@RefuseIfNotSentAsString) with 400 BadRequestException', async () => {
    await expect(
      transform({
        kind: EnumProductReportKind.MISSING_ITEM,
        itemName: 999,
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  test('refuses note sent as boolean (@RefuseIfNotSentAsString) with 400 BadRequestException', async () => {
    await expect(
      transform({
        kind: EnumProductReportKind.MISSING_ITEM,
        note: false,
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
