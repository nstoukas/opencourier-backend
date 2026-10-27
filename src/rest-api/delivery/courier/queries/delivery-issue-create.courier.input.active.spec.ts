import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { EnumDeliveryIssueReason } from '@prisma/types'
import { DeliveryIssueCreateCourierInput } from './delivery-issue-create.courier.input'

describe('DeliveryIssueCreateCourierInput (clause 2)', () => {
  const allReasons = [
    EnumDeliveryIssueReason.WRONG_ADDRESS,
    EnumDeliveryIssueReason.NO_SIGNAL,
    EnumDeliveryIssueReason.ORDER_HANDED,
    EnumDeliveryIssueReason.OTHER,
  ]

  test.each(allReasons)('accepts valid reason %s with no note', async (reason) => {
    const input = plainToInstance(DeliveryIssueCreateCourierInput, { reason })
    const errors = await validate(input)
    expect(errors).toHaveLength(0)
  })

  test('accepts valid reason with optional note at max limit (500 characters)', async () => {
    const note500 = 'x'.repeat(500)
    const input = plainToInstance(DeliveryIssueCreateCourierInput, {
      reason: EnumDeliveryIssueReason.OTHER,
      note: note500,
    })
    const errors = await validate(input)
    expect(errors).toHaveLength(0)
  })

  test('accepts valid reason with null note', async () => {
    const input = plainToInstance(DeliveryIssueCreateCourierInput, {
      reason: EnumDeliveryIssueReason.OTHER,
      note: null,
    })
    const errors = await validate(input)
    expect(errors).toHaveLength(0)
  })

  test('rejects missing reason', async () => {
    const input = plainToInstance(DeliveryIssueCreateCourierInput, {
      note: 'Door was locked',
    })
    const errors = await validate(input)
    expect(errors.some((e) => e.property === 'reason')).toBe(true)
  })

  test('rejects reason not in EnumDeliveryIssueReason', async () => {
    const input = plainToInstance(DeliveryIssueCreateCourierInput, {
      reason: 'FLAT_TIRE' as any,
    })
    const errors = await validate(input)
    expect(errors.some((e) => e.property === 'reason')).toBe(true)
  })

  test('refuses note with 501 characters (exceeds 500 char limit)', async () => {
    const note501 = 'x'.repeat(501)
    const input = plainToInstance(DeliveryIssueCreateCourierInput, {
      reason: EnumDeliveryIssueReason.OTHER,
      note: note501,
    })
    const errors = await validate(input)
    const noteError = errors.find((e) => e.property === 'note')
    expect(noteError).toBeDefined()
    expect(noteError?.constraints?.maxLength).toBeDefined()
  })

  test('refuses non-string note', async () => {
    const input = plainToInstance(DeliveryIssueCreateCourierInput, {
      reason: EnumDeliveryIssueReason.OTHER,
      note: 12345 as any,
    })
    const errors = await validate(input)
    const noteError = errors.find((e) => e.property === 'note')
    expect(noteError).toBeDefined()
    expect(noteError?.constraints?.isString).toBeDefined()
  })
})
