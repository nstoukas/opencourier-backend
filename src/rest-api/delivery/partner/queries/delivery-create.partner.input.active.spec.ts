import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { DeliveryCreatePartnerInput } from './delivery-create.partner.input'
import { DeliveryPartnerRestApiService } from '../delivery.partner.rest-api.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { EnumDeliverableAction } from '@prisma/types'

describe('DeliveryCreatePartnerInput and partner create (Spec 0016 AC-2)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const validAddress = {
    street: 'Iasonos 10',
    city: 'Volos',
    state: 'Thessaly',
    country: 'GR',
    zipCode: '38221',
  }

  const validBody = {
    quoteId: 'quote-1',
    pickupName: 'Taverna Nosh',
    pickupBusinessName: 'Taverna Nosh OE',
    pickupPhoneNumber: '+302421012345',
    pickupNotes: 'Kitchen entrance',
    pickupLatitude: 39.362,
    pickupLongitude: 22.945,
    pickupAddress: validAddress,
    dropoffName: 'Nikos Dimas',
    dropoffBusinessName: '',
    dropoffPhoneNumber: '+306912345678',
    dropoffLatitude: 39.365,
    dropoffLongitude: 22.948,
    dropoffAddress: validAddress,
    dropoffNotes: 'Floor: 3 · Doorbell: Dimas · Ring twice',
    dropoffSellerNotes: 'Ring twice',
    dropoffFloor: '3',
    dropoffDoorbell: 'Dimas',
    orderItems: [],
    deliverableAction: EnumDeliverableAction.MEET_AT_DOOR,
    orderReference: 'ORD-123',
    orderTotalValue: 1200,
    tip: 0,
    requiresDropoffSignature: false,
    requiresId: false,
  }

  describe('DeliveryCreatePartnerInput class-validator validation', () => {
    it('accepts valid dropoffFloor (<= 20 chars) and dropoffDoorbell (<= 60 chars)', async () => {
      const result = (await pipe.transform(
        {
          ...validBody,
          dropoffFloor: 'A'.repeat(20),
          dropoffDoorbell: 'B'.repeat(60),
        },
        { type: 'body', metatype: DeliveryCreatePartnerInput }
      )) as DeliveryCreatePartnerInput

      expect(result.dropoffFloor).toBe('A'.repeat(20))
      expect(result.dropoffDoorbell).toBe('B'.repeat(60))
    })

    it('accepts omitted, undefined or null dropoffFloor and dropoffDoorbell', async () => {
      const { dropoffFloor, dropoffDoorbell, ...withoutFields } = validBody
      const omittedResult = (await pipe.transform(withoutFields, {
        type: 'body',
        metatype: DeliveryCreatePartnerInput,
      })) as DeliveryCreatePartnerInput
      expect(omittedResult.dropoffFloor).toBeUndefined()
      expect(omittedResult.dropoffDoorbell).toBeUndefined()

      const nullResult = (await pipe.transform(
        { ...validBody, dropoffFloor: null, dropoffDoorbell: null },
        { type: 'body', metatype: DeliveryCreatePartnerInput }
      )) as DeliveryCreatePartnerInput
      expect(nullResult.dropoffFloor).toBeNull()
      expect(nullResult.dropoffDoorbell).toBeNull()
    })

    it('refuses dropoffFloor longer than 20 characters with 400 BadRequestException', async () => {
      await expect(
        pipe.transform(
          { ...validBody, dropoffFloor: '123456789012345678901' }, // 21 chars
          { type: 'body', metatype: DeliveryCreatePartnerInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses dropoffDoorbell longer than 60 characters with 400 BadRequestException', async () => {
      await expect(
        pipe.transform(
          { ...validBody, dropoffDoorbell: 'A'.repeat(61) }, // 61 chars
          { type: 'body', metatype: DeliveryCreatePartnerInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses non-string dropoffFloor or dropoffDoorbell with 400 BadRequestException', async () => {
      await expect(
        pipe.transform(
          { ...validBody, dropoffFloor: 123 },
          { type: 'body', metatype: DeliveryCreatePartnerInput }
        )
      ).rejects.toThrow(BadRequestException)

      await expect(
        pipe.transform(
          { ...validBody, dropoffDoorbell: { name: 'Papadopoulou' } },
          { type: 'body', metatype: DeliveryCreatePartnerInput }
        )
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('DeliveryPartnerRestApiService.create trimming and null storage', () => {
    let service: DeliveryPartnerRestApiService
    let mockDeliveryDomainService: any
    let mockDeliveryQuoteDomainService: any
    let mockLocationDomainService: any
    let mockPartnerDomainService: any
    let mockCourierDomainService: any
    let mockQuoteToDeliveryConversionService: any
    let mockDispatchStopRepository: any

    const partnerId = 'partner-1'
    const futureDate = new Date(Date.now() + 60000)
    const quotePickupLocation = { id: 'loc-pickup-1', latitude: 39.362, longitude: 22.945 }
    const quoteDropoffLocation = { id: 'loc-dropoff-1', latitude: 39.365, longitude: 22.948 }

    beforeEach(() => {
      mockPartnerDomainService = {
        getById: jest.fn().mockResolvedValue(new PartnerEntity({ id: partnerId } as any)),
      }
      mockDispatchStopRepository = {
        findOn: jest.fn().mockResolvedValue(null),
      }
      mockDeliveryQuoteDomainService = {
        getByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'quote-1',
          expiresAt: futureDate,
          pickupLocationId: quotePickupLocation.id,
          dropoffLocationId: quoteDropoffLocation.id,
          currency: 'EUR',
          quote: 500,
          dropoffEta: futureDate,
        }),
      }
      mockDeliveryDomainService = {
        getByDeliveryQuoteId: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'del-new' }),
      }
      mockLocationDomainService = {
        getByIds: jest.fn().mockResolvedValue([quotePickupLocation, quoteDropoffLocation]),
        findOrCreate: jest.fn().mockImplementation(async (loc) => ({ id: `loc-${loc.latitude}`, ...loc })),
      }
      mockQuoteToDeliveryConversionService = {
        isValidDeliveryLocationDrift: jest.fn().mockResolvedValue(true),
      }
      mockCourierDomainService = {}

      service = new DeliveryPartnerRestApiService(
        mockDeliveryQuoteDomainService,
        mockDeliveryDomainService,
        mockPartnerDomainService,
        mockLocationDomainService,
        mockCourierDomainService as any,
        mockQuoteToDeliveryConversionService,
        mockDispatchStopRepository,
        // Spec 0017: the history period (30 days), added by hand so the suite compiles.
        { instanceConfig: { getRestaurantHistoryDays: async () => 30 } } as any,
        {} as any
      )
    })

    it('trims dropoffFloor and dropoffDoorbell, and passes them to delivery create', async () => {
      const input: any = {
        ...validBody,
        dropoffFloor: '  3rd floor  ',
        dropoffDoorbell: '  Papadopoulou  ',
      }

      await service.create(partnerId, input)

      expect(mockDeliveryDomainService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          dropoffFloor: '3rd floor',
          dropoffDoorbell: 'Papadopoulou',
        })
      )
    })

    it('stores empty or whitespace-only dropoffFloor and dropoffDoorbell as null', async () => {
      const input: any = {
        ...validBody,
        dropoffFloor: '   ',
        dropoffDoorbell: '',
      }

      await service.create(partnerId, input)

      expect(mockDeliveryDomainService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          dropoffFloor: null,
          dropoffDoorbell: null,
        })
      )
    })

    it('stores undefined or null dropoffFloor and dropoffDoorbell as null', async () => {
      const input: any = {
        ...validBody,
        dropoffFloor: undefined,
        dropoffDoorbell: null,
      }

      await service.create(partnerId, input)

      expect(mockDeliveryDomainService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          dropoffFloor: null,
          dropoffDoorbell: null,
        })
      )
    })
  })
})
