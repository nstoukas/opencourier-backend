import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { EnumProductReportKind } from '@prisma/types'
import { ProductReportCreateCourierInput } from './product-report-create.courier.input'

describe('ProductReportCreateCourierInput through ValidationPipe (Spec 0032, AC-1)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const transform = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: ProductReportCreateCourierInput })

  test.each([EnumProductReportKind.WRONG_ITEM, EnumProductReportKind.MISSING_ITEM])(
    'accepts valid kind %s with optional fields',
    async (kind) => {
      const result = (await transform({
        kind,
        itemName: 'Cheeseburger',
        note: 'Customer got veggie burger',
      })) as ProductReportCreateCourierInput

      expect(result).toBeInstanceOf(ProductReportCreateCourierInput)
      expect(result.kind).toBe(kind)
      expect(result.itemName).toBe('Cheeseburger')
      expect(result.note).toBe('Customer got veggie burger')
    }
  )

  test('accepts missing itemName and note at DTO level (domain checks that at least one is present)', async () => {
    const result = (await transform({
      kind: EnumProductReportKind.WRONG_ITEM,
    })) as ProductReportCreateCourierInput

    expect(result.kind).toBe(EnumProductReportKind.WRONG_ITEM)
    expect(result.itemName).toBeUndefined()
    expect(result.note).toBeUndefined()
  })

  test('accepts maximum length of 120 characters for itemName and 500 for note', async () => {
    const item120 = 'x'.repeat(120)
    const note500 = 'y'.repeat(500)
    const result = (await transform({
      kind: EnumProductReportKind.WRONG_ITEM,
      itemName: item120,
      note: note500,
    })) as ProductReportCreateCourierInput

    expect(result.itemName).toBe(item120)
    expect(result.note).toBe(note500)
  })

  test('refuses missing kind with 400 BadRequestException', async () => {
    await expect(transform({ itemName: 'Pizza' })).rejects.toBeInstanceOf(BadRequestException)
  })

  test('refuses invalid kind enum value with 400 BadRequestException', async () => {
    await expect(transform({ kind: 'DAMAGED_ITEM', itemName: 'Pizza' })).rejects.toBeInstanceOf(
      BadRequestException
    )
  })

  test('refuses itemName longer than 120 characters with 400 BadRequestException', async () => {
    await expect(
      transform({
        kind: EnumProductReportKind.WRONG_ITEM,
        itemName: 'a'.repeat(121),
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  test('refuses note longer than 500 characters with 400 BadRequestException', async () => {
    await expect(
      transform({
        kind: EnumProductReportKind.WRONG_ITEM,
        note: 'b'.repeat(501),
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  test('refuses itemName sent as number (@RefuseIfNotSentAsString) with 400 BadRequestException', async () => {
    await expect(
      transform({
        kind: EnumProductReportKind.WRONG_ITEM,
        itemName: 12345,
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
