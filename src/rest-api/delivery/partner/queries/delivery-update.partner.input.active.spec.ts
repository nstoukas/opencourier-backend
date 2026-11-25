import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { DeliveryUpdatePartnerInput } from './delivery-update.partner.input'

describe('DeliveryUpdatePartnerInput class-validator validation', () => {
  // The same options as main.ts's global ValidationPipe.
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const validVerification = {
    signature: false,
    signatureRequirement: {
      enabled: false,
      collectSignerName: false,
      collectSignerRelationship: false,
    },
    barcodes: [],
    identification: {
      minAge: 18,
      noSobrietyCheck: true,
    },
    picture: false,
  }

  const now = new Date()
  const validBody = {
    dropoffNotes: 'Floor: 3 · Doorbell: Dimas · Ring twice',
    dropoffVerification: validVerification,
    orderReference: 'ORD-123',
    pickupNotes: 'Kitchen entrance',
    pickupVerification: validVerification,
    tipByCustomer: 0,
    dropoffLatitude: 39.365,
    dropoffLongitude: 22.948,
    pickupReadyAt: now,
    pickupDeadlineAt: now,
    dropoffReadyAt: now,
    dropoffDeadlineAt: now,
  }

  describe('tipByCustomer validation', () => {
    // A restaurant tip is added to rider pay, so it can never be negative: 0 and positive accepted.
    it.each([0, 250])('accepts tipByCustomer of %d (0 or positive)', async (tipByCustomer) => {
      const result = (await pipe.transform(
        { ...validBody, tipByCustomer },
        { type: 'body', metatype: DeliveryUpdatePartnerInput }
      )) as DeliveryUpdatePartnerInput

      expect(result.tipByCustomer).toBe(tipByCustomer)
    })

    // Refuses negative values (-1 and -1000) with 400 BadRequestException.
    it.each([-1, -1000])('refuses negative tipByCustomer of %d with 400 BadRequestException', async (tipByCustomer) => {
      await expect(
        pipe.transform({ ...validBody, tipByCustomer }, { type: 'body', metatype: DeliveryUpdatePartnerInput })
      ).rejects.toThrow(BadRequestException)
    })
  })

  // Row 168: the portal's edit keeps the order's times as they are
  describe('Row 168: four times validation (pickupReadyAt, pickupDeadlineAt, dropoffReadyAt, dropoffDeadlineAt)', () => {
    const TIME_FIELDS = ['pickupReadyAt', 'pickupDeadlineAt', 'dropoffReadyAt', 'dropoffDeadlineAt'] as const

    describe('null passes for each time field', () => {
      it.each(TIME_FIELDS)('null for %s passes validation and remains null', async (field) => {
        const result = (await pipe.transform(
          { ...validBody, [field]: null },
          { type: 'body', metatype: DeliveryUpdatePartnerInput }
        )) as DeliveryUpdatePartnerInput

        expect(result).toBeInstanceOf(DeliveryUpdatePartnerInput)
        expect(result[field]).toBeNull()
      })

      it('all four times set to null passes validation and all remain null', async () => {
        const result = (await pipe.transform(
          {
            ...validBody,
            pickupReadyAt: null,
            pickupDeadlineAt: null,
            dropoffReadyAt: null,
            dropoffDeadlineAt: null,
          },
          { type: 'body', metatype: DeliveryUpdatePartnerInput }
        )) as DeliveryUpdatePartnerInput

        expect(result).toBeInstanceOf(DeliveryUpdatePartnerInput)
        expect(result.pickupReadyAt).toBeNull()
        expect(result.pickupDeadlineAt).toBeNull()
        expect(result.dropoffReadyAt).toBeNull()
        expect(result.dropoffDeadlineAt).toBeNull()
      })
    })

    describe('ISO string becomes a Date and passes', () => {
      it.each(TIME_FIELDS)('an ISO string for %s becomes a Date instance and passes', async (field) => {
        const isoString = '2026-11-25T14:30:00.000Z'
        const result = (await pipe.transform(
          { ...validBody, [field]: isoString },
          { type: 'body', metatype: DeliveryUpdatePartnerInput }
        )) as DeliveryUpdatePartnerInput

        expect(result).toBeInstanceOf(DeliveryUpdatePartnerInput)
        expect(result[field]).toBeInstanceOf(Date)
        expect((result[field] as Date).toISOString()).toBe(isoString)
      })
    })

    describe('non date string is refused', () => {
      it.each(TIME_FIELDS)('a non date string for %s is refused with BadRequestException', async (field) => {
        await expect(
          pipe.transform(
            { ...validBody, [field]: 'not-a-valid-date' },
            { type: 'body', metatype: DeliveryUpdatePartnerInput }
          )
        ).rejects.toThrow(BadRequestException)
      })
    })

    describe('missing time passes (undefined)', () => {
      it.each(TIME_FIELDS)('omitting %s passes validation with value undefined', async (field) => {
        const bodyWithoutField = { ...validBody }
        delete (bodyWithoutField as any)[field]

        const result = (await pipe.transform(
          bodyWithoutField,
          { type: 'body', metatype: DeliveryUpdatePartnerInput }
        )) as DeliveryUpdatePartnerInput

        expect(result).toBeInstanceOf(DeliveryUpdatePartnerInput)
        expect(result[field]).toBeUndefined()
      })

      it('omitting all four times passes validation with all undefined', async () => {
        const bodyWithoutTimes = { ...validBody }
        for (const field of TIME_FIELDS) {
          delete (bodyWithoutTimes as any)[field]
        }

        const result = (await pipe.transform(
          bodyWithoutTimes,
          { type: 'body', metatype: DeliveryUpdatePartnerInput }
        )) as DeliveryUpdatePartnerInput

        expect(result).toBeInstanceOf(DeliveryUpdatePartnerInput)
        expect(result.pickupReadyAt).toBeUndefined()
        expect(result.pickupDeadlineAt).toBeUndefined()
        expect(result.dropoffReadyAt).toBeUndefined()
        expect(result.dropoffDeadlineAt).toBeUndefined()
      })
    })
  })
})
