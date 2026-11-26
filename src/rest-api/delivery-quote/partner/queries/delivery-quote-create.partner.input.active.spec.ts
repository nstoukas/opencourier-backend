import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { EnumCountryCode } from '@prisma/types'
import { ORDER_TOTAL_CENTS_CEILING } from 'src/domains/delivery/partner-edit'
import { DeliverQuoteCreatePartnerInput } from './delivery-quote-create.partner.input'
import { DeliveryQuotePartnerRestApiService } from '../delivery-quote.partner.rest-api.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'

describe('DeliverQuoteCreatePartnerInput and partner quote (Row 177)', () => {
  // The same options as main.ts's global ValidationPipe.
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const validAddress = {
    streetAddress: 'Iasonos 10',
    city: 'Volos',
    state: 'Thessaly',
    countryCode: EnumCountryCode.GR,
    zipCode: '38221',
  }

  const validQuoteBody = {
    pickupAddress: validAddress,
    dropoffAddress: validAddress,
    pickupLatitude: 39.362,
    pickupLongitude: 22.945,
    dropoffLatitude: 39.365,
    dropoffLongitude: 22.948,
    orderTotalValue: 1250,
  }

  describe('Row 177: quote orderTotalValue whole cents sent as a number and ceiling', () => {
    // Clause 3: whole number totals pass and DTO receives that number
    it('accepts orderTotalValue of 0', async () => {
      const result = (await pipe.transform(
        { ...validQuoteBody, orderTotalValue: 0 },
        { type: 'body', metatype: DeliverQuoteCreatePartnerInput }
      )) as DeliverQuoteCreatePartnerInput
      expect(result.orderTotalValue).toBe(0)
    })

    it('accepts orderTotalValue of 1250', async () => {
      const result = (await pipe.transform(
        { ...validQuoteBody, orderTotalValue: 1250 },
        { type: 'body', metatype: DeliverQuoteCreatePartnerInput }
      )) as DeliverQuoteCreatePartnerInput
      expect(result.orderTotalValue).toBe(1250)
    })

    it('accepts orderTotalValue equal to ORDER_TOTAL_CENTS_CEILING (2147483647)', async () => {
      const result = (await pipe.transform(
        { ...validQuoteBody, orderTotalValue: ORDER_TOTAL_CENTS_CEILING },
        { type: 'body', metatype: DeliverQuoteCreatePartnerInput }
      )) as DeliverQuoteCreatePartnerInput
      expect(result.orderTotalValue).toBe(ORDER_TOTAL_CENTS_CEILING)
    })

    // Clause 4: a left out total stays allowed on the quote (omitted, and null)
    it('accepts body with orderTotalValue key omitted', async () => {
      const { orderTotalValue, ...withoutOrderTotal } = validQuoteBody
      const result = (await pipe.transform(withoutOrderTotal, {
        type: 'body',
        metatype: DeliverQuoteCreatePartnerInput,
      })) as DeliverQuoteCreatePartnerInput
      expect(result.orderTotalValue).toBeUndefined()
    })

    it('accepts orderTotalValue: null', async () => {
      const result = (await pipe.transform(
        { ...validQuoteBody, orderTotalValue: null },
        { type: 'body', metatype: DeliverQuoteCreatePartnerInput }
      )) as DeliverQuoteCreatePartnerInput
      expect(result.orderTotalValue).toBeNull()
    })

    // Clause 1: bad values answer 400 BadRequestException
    it('refuses empty string "" for orderTotalValue with 400 BadRequestException (@RefuseIfNotSentAsNumber)', async () => {
      await expect(
        pipe.transform(
          { ...validQuoteBody, orderTotalValue: '' },
          { type: 'body', metatype: DeliverQuoteCreatePartnerInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses boolean false for orderTotalValue with 400 BadRequestException (@RefuseIfNotSentAsNumber)', async () => {
      await expect(
        pipe.transform(
          { ...validQuoteBody, orderTotalValue: false },
          { type: 'body', metatype: DeliverQuoteCreatePartnerInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses boolean true for orderTotalValue with 400 BadRequestException (@RefuseIfNotSentAsNumber)', async () => {
      await expect(
        pipe.transform(
          { ...validQuoteBody, orderTotalValue: true },
          { type: 'body', metatype: DeliverQuoteCreatePartnerInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses numeric string "1250" for orderTotalValue with 400 BadRequestException (@RefuseIfNotSentAsNumber)', async () => {
      await expect(
        pipe.transform(
          { ...validQuoteBody, orderTotalValue: '1250' },
          { type: 'body', metatype: DeliverQuoteCreatePartnerInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses fractional number 12.5 for orderTotalValue with 400 BadRequestException (@IsInt)', async () => {
      await expect(
        pipe.transform(
          { ...validQuoteBody, orderTotalValue: 12.5 },
          { type: 'body', metatype: DeliverQuoteCreatePartnerInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses negative orderTotalValue -1 with 400 BadRequestException (@Min)', async () => {
      await expect(
        pipe.transform(
          { ...validQuoteBody, orderTotalValue: -1 },
          { type: 'body', metatype: DeliverQuoteCreatePartnerInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses orderTotalValue above ORDER_TOTAL_CENTS_CEILING (2147483648) with 400 BadRequestException (@Max)', async () => {
      await expect(
        pipe.transform(
          { ...validQuoteBody, orderTotalValue: 2147483648 },
          { type: 'body', metatype: DeliverQuoteCreatePartnerInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    // Clause 2: with nothing written, pipe asserts body never becomes DTO
    it('with nothing written: a refused total never becomes a DTO (pipe rejects with BadRequestException)', async () => {
      const invalidBody = { ...validQuoteBody, orderTotalValue: '1250' }
      await expect(
        pipe.transform(invalidBody, { type: 'body', metatype: DeliverQuoteCreatePartnerInput })
      ).rejects.toThrow(BadRequestException)
    })
  })

  // Clause 2: at the rest-api service level, showing a refused total never reaches the domain service write
  describe('DeliveryQuotePartnerRestApiService.create - with nothing written (AC-2)', () => {
    let service: DeliveryQuotePartnerRestApiService
    let mockDeliveryQuoteDomainService: any
    let mockPartnerDomainService: any
    let mockLocationDomainService: any
    let mockCourierMatcherService: any
    let mockConfigDomainService: any
    let mockDispatchStopRepository: any

    const partnerId = 'partner-1'

    beforeEach(() => {
      mockDeliveryQuoteDomainService = {
        create: jest.fn(),
      }
      mockPartnerDomainService = {
        getById: jest.fn().mockResolvedValue(new PartnerEntity({ id: partnerId } as any)),
      }
      mockLocationDomainService = {
        findOrCreate: jest.fn().mockResolvedValue({ id: 'loc-1', latitude: 39.362, longitude: 22.945 }),
      }
      mockCourierMatcherService = {
        findCourierForDelivery: jest.fn().mockResolvedValue({ id: 'courier-1' }),
      }
      mockConfigDomainService = {
        instanceConfig: {
          getDetails: jest.fn().mockResolvedValue({
            region: {
              type: 'Polygon',
              coordinates: [
                [
                  [22.90, 39.35],
                  [23.00, 39.35],
                  [23.00, 39.40],
                  [22.90, 39.40],
                  [22.90, 39.35],
                ],
              ],
            },
          }),
        },
      }
      mockDispatchStopRepository = {
        findOn: jest.fn().mockResolvedValue(null),
      }

      service = new DeliveryQuotePartnerRestApiService(
        mockDeliveryQuoteDomainService,
        mockPartnerDomainService,
        mockLocationDomainService,
        mockCourierMatcherService,
        mockConfigDomainService,
        mockDispatchStopRepository
      )
    })

    it('with nothing written: a refused total never reaches the quote domain service write', async () => {
      const invalidBody = { ...validQuoteBody, orderTotalValue: '1250' }
      let transformedInput: DeliverQuoteCreatePartnerInput | undefined

      try {
        transformedInput = (await pipe.transform(invalidBody, {
          type: 'body',
          metatype: DeliverQuoteCreatePartnerInput,
        })) as DeliverQuoteCreatePartnerInput
        await service.create(partnerId, transformedInput)
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException)
      }

      expect(transformedInput).toBeUndefined()
      expect(mockDeliveryQuoteDomainService.create).not.toHaveBeenCalled()
    })
  })
})
