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
})
