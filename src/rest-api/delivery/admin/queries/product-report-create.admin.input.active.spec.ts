import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { EnumProductReportKind } from '@prisma/types'
import { ProductReportCreateAdminInput } from './product-report-create.admin.input'

describe('ProductReportCreateAdminInput through ValidationPipe (Spec 0032, AC-1)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const transform = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: ProductReportCreateAdminInput })

  test.each([EnumProductReportKind.WRONG_ITEM, EnumProductReportKind.MISSING_ITEM])(
    'accepts valid kind %s with optional fields',
    async (kind) => {
      const result = (await transform({
        kind,
        itemName: 'Gyros Plate',
        note: 'Customer phoned about order',
      })) as ProductReportCreateAdminInput

      expect(result).toBeInstanceOf(ProductReportCreateAdminInput)
      expect(result.kind).toBe(kind)
      expect(result.itemName).toBe('Gyros Plate')
      expect(result.note).toBe('Customer phoned about order')
    }
  )

  test('accepts missing optional fields', async () => {
    const result = (await transform({
      kind: EnumProductReportKind.WRONG_ITEM,
    })) as ProductReportCreateAdminInput

    expect(result.kind).toBe(EnumProductReportKind.WRONG_ITEM)
    expect(result.itemName).toBeUndefined()
    expect(result.note).toBeUndefined()
  })

  test('refuses missing kind with 400 BadRequestException', async () => {
    await expect(transform({ itemName: 'Gyros' })).rejects.toBeInstanceOf(BadRequestException)
  })

  test('refuses invalid kind enum value with 400 BadRequestException', async () => {
    await expect(transform({ kind: 'OTHER_ISSUE', itemName: 'Gyros' })).rejects.toBeInstanceOf(
      BadRequestException
    )
  })

  test('refuses itemName longer than 120 characters with 400 BadRequestException', async () => {
    await expect(
      transform({
        kind: EnumProductReportKind.WRONG_ITEM,
        itemName: 'x'.repeat(121),
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  test('refuses note longer than 500 characters with 400 BadRequestException', async () => {
    await expect(
      transform({
        kind: EnumProductReportKind.WRONG_ITEM,
        note: 'y'.repeat(501),
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  test('refuses itemName sent as number (@RefuseIfNotSentAsString) with 400 BadRequestException', async () => {
    await expect(
      transform({
        kind: EnumProductReportKind.WRONG_ITEM,
        itemName: 42,
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  test('refuses note sent as boolean (@RefuseIfNotSentAsString) with 400 BadRequestException', async () => {
    await expect(
      transform({
        kind: EnumProductReportKind.WRONG_ITEM,
        note: true,
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
