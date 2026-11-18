import { BadRequestException, ValidationPipe } from '@nestjs/common'
import {
  PartnerBillCreateAdminInput,
  PartnerBillUndoAdminInput,
} from './partner-charge.admin.input'

describe('PartnerChargeAdminInput ValidationPipe (Spec 0036, Decision 109.6)', () => {
  // Real ValidationPipe configured with exact main.ts options (enableImplicitConversion: true)
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  })

  describe('PartnerBillCreateAdminInput', () => {
    const validBody = {
      partnerId: 'partner-1',
      month: '2026-11',
      chargeIds: ['ch-1', 'ch-2'],
      reference: 'ΤΠΥ 41',
    }

    test('a valid body passes', async () => {
      const result = (await pipe.transform(validBody, {
        type: 'body',
        metatype: PartnerBillCreateAdminInput,
      })) as PartnerBillCreateAdminInput

      expect(result).toBeInstanceOf(PartnerBillCreateAdminInput)
      expect(result.partnerId).toBe('partner-1')
      expect(result.month).toBe('2026-11')
      expect(result.chargeIds).toEqual(['ch-1', 'ch-2'])
      expect(result.reference).toBe('ΤΠΥ 41')
    })

    test('a valid body without reference passes', async () => {
      const { reference, ...withoutRef } = validBody
      const result = (await pipe.transform(withoutRef, {
        type: 'body',
        metatype: PartnerBillCreateAdminInput,
      })) as PartnerBillCreateAdminInput

      expect(result).toBeInstanceOf(PartnerBillCreateAdminInput)
      expect(result.reference).toBeUndefined()
    })

    test('month sent as a number is refused', async () => {
      const body = { ...validBody, month: 202611 }
      await expect(
        pipe.transform(body, { type: 'body', metatype: PartnerBillCreateAdminInput })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    test('chargeIds missing is refused', async () => {
      const { chargeIds, ...withoutChargeIds } = validBody
      await expect(
        pipe.transform(withoutChargeIds, { type: 'body', metatype: PartnerBillCreateAdminInput })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    test('chargeIds empty is refused', async () => {
      const body = { ...validBody, chargeIds: [] }
      await expect(
        pipe.transform(body, { type: 'body', metatype: PartnerBillCreateAdminInput })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    test('chargeIds not an array is refused', async () => {
      const bodyString = { ...validBody, chargeIds: 'ch-1' }
      await expect(
        pipe.transform(bodyString, { type: 'body', metatype: PartnerBillCreateAdminInput })
      ).rejects.toBeInstanceOf(BadRequestException)

      const bodyNumber = { ...validBody, chargeIds: 123 }
      await expect(
        pipe.transform(bodyNumber, { type: 'body', metatype: PartnerBillCreateAdminInput })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    test('chargeIds with a duplicate is refused', async () => {
      const body = { ...validBody, chargeIds: ['ch-1', 'ch-1'] }
      await expect(
        pipe.transform(body, { type: 'body', metatype: PartnerBillCreateAdminInput })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    test('chargeIds with a non string is refused', async () => {
      const body = { ...validBody, chargeIds: ['ch-1', 42 as unknown as string] }
      await expect(
        pipe.transform(body, { type: 'body', metatype: PartnerBillCreateAdminInput })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    test('chargeIds with 501 items is refused', async () => {
      const tooMany = Array.from({ length: 501 }, (_, i) => `ch-${i}`)
      const body = { ...validBody, chargeIds: tooMany }
      await expect(
        pipe.transform(body, { type: 'body', metatype: PartnerBillCreateAdminInput })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    test('reference sent as a number is refused', async () => {
      const body = { ...validBody, reference: 12345 }
      await expect(
        pipe.transform(body, { type: 'body', metatype: PartnerBillCreateAdminInput })
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('PartnerBillUndoAdminInput', () => {
    test('a valid body passes', async () => {
      const result = (await pipe.transform(
        { reason: 'Mistake in invoice' },
        { type: 'body', metatype: PartnerBillUndoAdminInput }
      )) as PartnerBillUndoAdminInput

      expect(result).toBeInstanceOf(PartnerBillUndoAdminInput)
      expect(result.reason).toBe('Mistake in invoice')
    })

    test('refuses a missing reason', async () => {
      await expect(
        pipe.transform({}, { type: 'body', metatype: PartnerBillUndoAdminInput })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    test('refuses a number reason', async () => {
      await expect(
        pipe.transform({ reason: 12345 }, { type: 'body', metatype: PartnerBillUndoAdminInput })
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })
})
