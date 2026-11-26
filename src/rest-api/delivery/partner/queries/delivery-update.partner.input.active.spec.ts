import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { DeliveryUpdatePartnerInput } from './delivery-update.partner.input'
import { TIP_CENTS_CEILING } from 'src/domains/delivery/partner-edit'

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

  // Row 169: the portal's edit keeps the tip as it is (optional tipByCustomer)
  describe('Row 169: optional tipByCustomer (decision 169.1)', () => {
    it('a body with no tipByCustomer passes validation and result has no tip (undefined)', async () => {
      const bodyWithoutTip = { ...validBody }
      delete (bodyWithoutTip as any).tipByCustomer

      const result = (await pipe.transform(bodyWithoutTip, {
        type: 'body',
        metatype: DeliveryUpdatePartnerInput,
      })) as DeliveryUpdatePartnerInput

      expect(result).toBeInstanceOf(DeliveryUpdatePartnerInput)
      expect(result.tipByCustomer).toBeUndefined()
    })

    it('refuses tipByCustomer: null with 400 BadRequestException (@ValidateIf checks non-undefined)', async () => {
      await expect(
        pipe.transform({ ...validBody, tipByCustomer: null }, { type: 'body', metatype: DeliveryUpdatePartnerInput })
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses non-numeric string "abc" for tipByCustomer with 400 BadRequestException', async () => {
      await expect(
        pipe.transform({ ...validBody, tipByCustomer: 'abc' }, { type: 'body', metatype: DeliveryUpdatePartnerInput })
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses empty string "" for tipByCustomer with 400 BadRequestException (@RefuseIfNotSentAsNumber)', async () => {
      await expect(
        pipe.transform({ ...validBody, tipByCustomer: '' }, { type: 'body', metatype: DeliveryUpdatePartnerInput })
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses boolean false for tipByCustomer with 400 BadRequestException (@RefuseIfNotSentAsNumber)', async () => {
      await expect(
        pipe.transform({ ...validBody, tipByCustomer: false }, { type: 'body', metatype: DeliveryUpdatePartnerInput })
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses boolean true for tipByCustomer with 400 BadRequestException (@RefuseIfNotSentAsNumber)', async () => {
      await expect(
        pipe.transform({ ...validBody, tipByCustomer: true }, { type: 'body', metatype: DeliveryUpdatePartnerInput })
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses numeric string "250" for tipByCustomer with 400 BadRequestException (@RefuseIfNotSentAsNumber)', async () => {
      await expect(
        pipe.transform({ ...validBody, tipByCustomer: '250' }, { type: 'body', metatype: DeliveryUpdatePartnerInput })
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses fractional number 2.5 for tipByCustomer with 400 BadRequestException (@IsInt)', async () => {
      await expect(
        pipe.transform({ ...validBody, tipByCustomer: 2.5 }, { type: 'body', metatype: DeliveryUpdatePartnerInput })
      ).rejects.toThrow(BadRequestException)
    })
  })

  // Row 171: the tips column's ceiling (decision 171.1)
  describe('Row 171: tipByCustomer ceiling (decision 171.1)', () => {
    it('accepts tipByCustomer equal to TIP_CENTS_CEILING (2147483647)', async () => {
      const result = (await pipe.transform(
        { ...validBody, tipByCustomer: TIP_CENTS_CEILING },
        { type: 'body', metatype: DeliveryUpdatePartnerInput }
      )) as DeliveryUpdatePartnerInput

      expect(result.tipByCustomer).toBe(TIP_CENTS_CEILING)
    })

    it('refuses tipByCustomer above TIP_CENTS_CEILING (2147483648) with 400 BadRequestException (@Max)', async () => {
      await expect(
        pipe.transform(
          { ...validBody, tipByCustomer: 2147483648 },
          { type: 'body', metatype: DeliveryUpdatePartnerInput }
        )
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

    // Row 168: empty string '' is refused with 400 (not parsed as null or silently ignored)
    describe('empty string is refused', () => {
      it.each(TIME_FIELDS)('an empty string for %s is refused with BadRequestException', async (field) => {
        await expect(
          pipe.transform({ ...validBody, [field]: '' }, { type: 'body', metatype: DeliveryUpdatePartnerInput })
        ).rejects.toThrow(BadRequestException)
      })
    })

    describe('missing time passes (undefined)', () => {
      it.each(TIME_FIELDS)('omitting %s passes validation with value undefined', async (field) => {
        const bodyWithoutField = { ...validBody }
        delete (bodyWithoutField as any)[field]

        const result = (await pipe.transform(bodyWithoutField, {
          type: 'body',
          metatype: DeliveryUpdatePartnerInput,
        })) as DeliveryUpdatePartnerInput

        expect(result).toBeInstanceOf(DeliveryUpdatePartnerInput)
        expect(result[field]).toBeUndefined()
      })

      it('omitting all four times passes validation with all undefined', async () => {
        const bodyWithoutTimes = { ...validBody }
        for (const field of TIME_FIELDS) {
          delete (bodyWithoutTimes as any)[field]
        }

        const result = (await pipe.transform(bodyWithoutTimes, {
          type: 'body',
          metatype: DeliveryUpdatePartnerInput,
        })) as DeliveryUpdatePartnerInput

        expect(result).toBeInstanceOf(DeliveryUpdatePartnerInput)
        expect(result.pickupReadyAt).toBeUndefined()
        expect(result.pickupDeadlineAt).toBeUndefined()
        expect(result.dropoffReadyAt).toBeUndefined()
        expect(result.dropoffDeadlineAt).toBeUndefined()
      })
    })
  })

  // Row 178: the portal's edit sends only what the restaurant changed (decisions 178.1 to 178.3 and 178.6)
  describe('Row 178: optional fields (orderReference, pickupNotes, dropoffNotes, dropoffLatitude, dropoffLongitude, pickupVerification, dropoffVerification)', () => {
    const ROW_178_FIELDS = [
      'orderReference',
      'pickupNotes',
      'dropoffNotes',
      'dropoffLatitude',
      'dropoffLongitude',
      'pickupVerification',
      'dropoffVerification',
    ] as const

    it('an entirely empty body {} passes validation with all fields undefined', async () => {
      const result = (await pipe.transform(
        {},
        {
          type: 'body',
          metatype: DeliveryUpdatePartnerInput,
        }
      )) as DeliveryUpdatePartnerInput

      expect(result).toBeInstanceOf(DeliveryUpdatePartnerInput)
      expect(result.orderReference).toBeUndefined()
      expect(result.pickupNotes).toBeUndefined()
      expect(result.dropoffNotes).toBeUndefined()
      expect(result.dropoffLatitude).toBeUndefined()
      expect(result.dropoffLongitude).toBeUndefined()
      expect(result.pickupVerification).toBeUndefined()
      expect(result.dropoffVerification).toBeUndefined()
      expect(result.tipByCustomer).toBeUndefined()
      expect(result.pickupReadyAt).toBeUndefined()
      expect(result.pickupDeadlineAt).toBeUndefined()
      expect(result.dropoffReadyAt).toBeUndefined()
      expect(result.dropoffDeadlineAt).toBeUndefined()
    })

    it('a body with only pickupNotes passes validation and other fields are undefined', async () => {
      const result = (await pipe.transform(
        { pickupNotes: 'Ring doorbell twice' },
        { type: 'body', metatype: DeliveryUpdatePartnerInput }
      )) as DeliveryUpdatePartnerInput

      expect(result).toBeInstanceOf(DeliveryUpdatePartnerInput)
      expect(result.pickupNotes).toBe('Ring doorbell twice')
      expect(result.dropoffNotes).toBeUndefined()
      expect(result.orderReference).toBeUndefined()
      expect(result.dropoffLatitude).toBeUndefined()
      expect(result.dropoffLongitude).toBeUndefined()
      expect(result.pickupVerification).toBeUndefined()
      expect(result.dropoffVerification).toBeUndefined()
    })

    it.each([
      'orderReference',
      'pickupNotes',
      'dropoffNotes',
      'pickupVerification',
      'dropoffVerification',
    ] as const)('omitting %s passes validation with value undefined', async (field) => {
      const body = { ...validBody }
      delete (body as any)[field]

      const result = (await pipe.transform(body, {
        type: 'body',
        metatype: DeliveryUpdatePartnerInput,
      })) as DeliveryUpdatePartnerInput

      expect(result).toBeInstanceOf(DeliveryUpdatePartnerInput)
      expect(result[field]).toBeUndefined()
    })

    it('omitting both coordinates together passes validation with both undefined', async () => {
      const body = { ...validBody }
      delete (body as any).dropoffLatitude
      delete (body as any).dropoffLongitude

      const result = (await pipe.transform(body, {
        type: 'body',
        metatype: DeliveryUpdatePartnerInput,
      })) as DeliveryUpdatePartnerInput

      expect(result).toBeInstanceOf(DeliveryUpdatePartnerInput)
      expect(result.dropoffLatitude).toBeUndefined()
      expect(result.dropoffLongitude).toBeUndefined()
    })

    describe('null is refused for each of the seven fields', () => {
      it.each(ROW_178_FIELDS)(
        'refuses %s: null with 400 BadRequestException (@ValidateIf checks non-undefined)',
        async (field) => {
          await expect(
            pipe.transform({ ...validBody, [field]: null }, { type: 'body', metatype: DeliveryUpdatePartnerInput })
          ).rejects.toThrow(BadRequestException)
        }
      )
    })

    describe('one coordinate without the other, or a null coordinate, is refused with 400 BadRequestException (decisions 178.2, 178.3)', () => {
      it('refuses body with dropoffLatitude only (dropoffLongitude missing)', async () => {
        const bodyWithoutLng = { ...validBody }
        delete (bodyWithoutLng as any).dropoffLongitude

        await expect(
          pipe.transform(bodyWithoutLng, { type: 'body', metatype: DeliveryUpdatePartnerInput })
        ).rejects.toThrow(BadRequestException)
      })

      it('refuses body with dropoffLongitude only (dropoffLatitude missing)', async () => {
        const bodyWithoutLat = { ...validBody }
        delete (bodyWithoutLat as any).dropoffLatitude

        await expect(
          pipe.transform(bodyWithoutLat, { type: 'body', metatype: DeliveryUpdatePartnerInput })
        ).rejects.toThrow(BadRequestException)
      })

      it('refuses body with dropoffLatitude: 39.365 alone on an empty body', async () => {
        await expect(
          pipe.transform({ dropoffLatitude: 39.365 }, { type: 'body', metatype: DeliveryUpdatePartnerInput })
        ).rejects.toThrow(BadRequestException)
      })

      it('refuses body with dropoffLongitude: 22.948 alone on an empty body', async () => {
        await expect(
          pipe.transform({ dropoffLongitude: 22.948 }, { type: 'body', metatype: DeliveryUpdatePartnerInput })
        ).rejects.toThrow(BadRequestException)
      })

      it('refuses body with both dropoffLatitude: null and dropoffLongitude: null with 400 BadRequestException', async () => {
        await expect(
          pipe.transform(
            { ...validBody, dropoffLatitude: null, dropoffLongitude: null },
            { type: 'body', metatype: DeliveryUpdatePartnerInput }
          )
        ).rejects.toThrow(BadRequestException)
      })

      it('refuses body with dropoffLatitude: null and dropoffLongitude: null on an empty body with 400 BadRequestException', async () => {
        await expect(
          pipe.transform(
            { dropoffLatitude: null, dropoffLongitude: null },
            { type: 'body', metatype: DeliveryUpdatePartnerInput }
          )
        ).rejects.toThrow(BadRequestException)
      })

      it('refuses body with dropoffLatitude: null and dropoffLongitude: 22.948 with 400 BadRequestException', async () => {
        await expect(
          pipe.transform(
            { ...validBody, dropoffLatitude: null, dropoffLongitude: 22.948 },
            { type: 'body', metatype: DeliveryUpdatePartnerInput }
          )
        ).rejects.toThrow(BadRequestException)
      })

      it('refuses body with dropoffLatitude: null and dropoffLongitude: 22.948 on an empty body with 400 BadRequestException', async () => {
        await expect(
          pipe.transform(
            { dropoffLatitude: null, dropoffLongitude: 22.948 },
            { type: 'body', metatype: DeliveryUpdatePartnerInput }
          )
        ).rejects.toThrow(BadRequestException)
      })
    })

    describe('sent fields keep their type checks', () => {
      it('refuses non-number string "abc" for dropoffLatitude', async () => {
        await expect(
          pipe.transform(
            { ...validBody, dropoffLatitude: 'abc' },
            { type: 'body', metatype: DeliveryUpdatePartnerInput }
          )
        ).rejects.toThrow(BadRequestException)
      })

      it('refuses non-number string "abc" for dropoffLongitude', async () => {
        await expect(
          pipe.transform(
            { ...validBody, dropoffLongitude: 'abc' },
            { type: 'body', metatype: DeliveryUpdatePartnerInput }
          )
        ).rejects.toThrow(BadRequestException)
      })

      it('refuses malformed pickupVerification object (e.g. nested identification.minAge is not a number)', async () => {
        const malformed = {
          ...validVerification,
          identification: {
            ...validVerification.identification,
            minAge: null,
          },
        }
        await expect(
          pipe.transform(
            { ...validBody, pickupVerification: malformed },
            { type: 'body', metatype: DeliveryUpdatePartnerInput }
          )
        ).rejects.toThrow(BadRequestException)
      })

      it('refuses malformed dropoffVerification object (e.g. nested identification.minAge is not a number)', async () => {
        const malformed = {
          ...validVerification,
          identification: {
            ...validVerification.identification,
            minAge: null,
          },
        }
        await expect(
          pipe.transform(
            { ...validBody, dropoffVerification: malformed },
            { type: 'body', metatype: DeliveryUpdatePartnerInput }
          )
        ).rejects.toThrow(BadRequestException)
      })

      it('refuses malformed verification object with invalid nested signatureRequirement (e.g. enabled is null)', async () => {
        const malformed = {
          ...validVerification,
          signatureRequirement: {
            enabled: null,
            collectSignerName: false,
            collectSignerRelationship: false,
          },
        }
        await expect(
          pipe.transform(
            { ...validBody, pickupVerification: malformed },
            { type: 'body', metatype: DeliveryUpdatePartnerInput }
          )
        ).rejects.toThrow(BadRequestException)
      })
    })
  })
})
