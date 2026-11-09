import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { EnumDeliverableAction } from '@prisma/types'
import { DeliveryCreatePartnerInput } from './delivery-create.partner.input'
import { DeliveryPartnerRestApiService } from '../delivery.partner.rest-api.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'

// Spec 0028 (row 103), AC-1: an order item may carry `kind`, DRINK or SIDE (absent means neither).
// The partner create route refuses any other value with a 400, and the stored JSON carries it as sent.
describe('DeliveryOrderItemInput.kind on partner delivery create (spec 0028 AC-1)', () => {
  // The same options as main.ts's global ValidationPipe.
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const address = {
    street: 'Iasonos 10',
    city: 'Volos',
    state: 'Thessaly',
    country: 'GR',
    zipCode: '38221',
  }

  const baseBody = {
    quoteId: 'quote-1',
    pickupName: 'Taverna Nosh',
    pickupBusinessName: 'Taverna Nosh OE',
    pickupPhoneNumber: '+302421012345',
    pickupNotes: 'Kitchen entrance',
    pickupLatitude: 39.362,
    pickupLongitude: 22.945,
    pickupAddress: address,
    dropoffName: 'Nikos Dimas',
    dropoffBusinessName: '',
    dropoffPhoneNumber: '+306912345678',
    dropoffLatitude: 39.365,
    dropoffLongitude: 22.948,
    dropoffAddress: address,
    dropoffNotes: 'Ring twice',
    dropoffSellerNotes: 'Ring twice',
    deliverableAction: EnumDeliverableAction.MEET_AT_DOOR,
    orderReference: 'ORD-103',
    orderTotalValue: 1200,
    tip: 0,
    requiresDropoffSignature: false,
    requiresId: false,
  }

  const bodyWithItems = (orderItems: unknown[]) => ({ ...baseBody, orderItems })

  const transform = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: DeliveryCreatePartnerInput }) as Promise<DeliveryCreatePartnerInput>

  // Collects every text the 400 carries (a validation list, or a single message).
  const messagesOf = async (promise: Promise<unknown>): Promise<string[]> => {
    try {
      await promise
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException)
      const response = (error as BadRequestException).getResponse() as { message?: string | string[] } | string
      const message = typeof response === 'string' ? response : response.message
      return Array.isArray(message) ? message : [String(message)]
    }
    throw new Error('expected a 400, but the body was accepted')
  }

  // The 400 names the field, and nothing else in the body is wrong (so the refusal is kind's own).
  const expectOnlyKindNamed = (messages: string[]) => {
    expect(messages.length).toBeGreaterThan(0)
    for (const message of messages) {
      expect(message).toMatch(/kind/)
    }
  }

  // Spec 0028: a non string kind (null included) is refused by @RefuseIfNotSentAsString, and that
  // is pinned; its sentence is the one a restaurant's developer sees.
  const NOT_TEXT = 'kind must be sent as text'

  describe('accepted kinds', () => {
    it('accepts the base body as it is (so every refusal below is the kind alone)', async () => {
      await expect(transform(bodyWithItems([{ name: 'Cola', quantity: 1 }]))).resolves.toBeDefined()
    })

    it('accepts DRINK and SIDE, and keeps them on the transformed items', async () => {
      const result = await transform(
        bodyWithItems([
          { name: 'Cola', quantity: 2, kind: 'DRINK' },
          { name: 'Fries', quantity: 1, kind: 'SIDE' },
        ])
      )

      expect(result.orderItems[0]?.kind).toBe('DRINK')
      expect(result.orderItems[1]?.kind).toBe('SIDE')
    })

    it('accepts an item with no kind (absent means neither)', async () => {
      const result = await transform(bodyWithItems([{ name: 'Package', quantity: 1, size: 'MEDIUM' }]))

      expect(result.orderItems[0]?.kind).toBeUndefined()
    })

    it('accepts a mix of marked and unmarked items', async () => {
      const result = await transform(
        bodyWithItems([
          { name: 'Souvlaki', quantity: 2, size: 'LARGE' },
          { name: 'Cola', quantity: 1, kind: 'DRINK' },
        ])
      )

      expect(result.orderItems.map((item) => item.kind)).toEqual([undefined, 'DRINK'])
    })
  })

  describe('refused kinds (a 400 naming the field)', () => {
    it('refuses another text ("dessert")', async () => {
      const message = await messagesOf(transform(bodyWithItems([{ name: 'Baklava', quantity: 1, kind: 'dessert' }])))
      expectOnlyKindNamed(message)
    })

    it('refuses lower case "drink" (the list is exact)', async () => {
      const message = await messagesOf(transform(bodyWithItems([{ name: 'Cola', quantity: 1, kind: 'drink' }])))
      expectOnlyKindNamed(message)
    })

    it('refuses an empty text', async () => {
      const message = await messagesOf(transform(bodyWithItems([{ name: 'Cola', quantity: 1, kind: '' }])))
      expectOnlyKindNamed(message)
    })

    it('refuses null (only a missing kind means neither)', async () => {
      const message = await messagesOf(transform(bodyWithItems([{ name: 'Cola', quantity: 1, kind: null }])))
      expectOnlyKindNamed(message)
      expect(message).toContain(NOT_TEXT)
    })

    it('refuses a number', async () => {
      const message = await messagesOf(transform(bodyWithItems([{ name: 'Cola', quantity: 1, kind: 1 }])))
      expectOnlyKindNamed(message)
      expect(message).toContain(NOT_TEXT)
    })

    it('refuses a boolean', async () => {
      for (const kind of [true, false]) {
        const message = await messagesOf(transform(bodyWithItems([{ name: 'Cola', quantity: 1, kind }])))
        expectOnlyKindNamed(message)
        expect(message).toContain(NOT_TEXT)
      }
    })

    it('refuses an array, even one holding a valid kind', async () => {
      const message = await messagesOf(transform(bodyWithItems([{ name: 'Cola', quantity: 1, kind: ['DRINK'] }])))
      expectOnlyKindNamed(message)
      expect(message).toContain(NOT_TEXT)
    })

    it('refuses a bad kind on a later item while the first is valid', async () => {
      const message = await messagesOf(
        transform(
          bodyWithItems([
            { name: 'Cola', quantity: 1, kind: 'DRINK' },
            { name: 'Ice cream', quantity: 1, kind: 'DESSERT' },
          ])
        )
      )
      expectOnlyKindNamed(message)
    })
  })

  describe('the stored item keeps kind', () => {
    let prismaDeliveryCreate: jest.Mock
    let service: DeliveryPartnerRestApiService

    const futureDate = new Date(Date.now() + 60_000)
    const pickupLocation = { id: 'loc-pickup-1', latitude: 39.362, longitude: 22.945 }
    const dropoffLocation = { id: 'loc-dropoff-1', latitude: 39.365, longitude: 22.948 }

    beforeEach(() => {
      // The real repository and domain service, so the test follows orderItems all the way to
      // the data handed to Prisma; only Prisma itself and the event service are fakes.
      prismaDeliveryCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'del-new', ...data }))
      const repository = new DeliveryRepository({ delivery: { create: prismaDeliveryCreate } } as any)
      const deliveryEventService = { processDeliveryEvent: jest.fn().mockResolvedValue(undefined) }
      const domain = new DeliveryDomainService(
        repository,
        {} as any,
        {} as any,
        deliveryEventService as any,
        {} as any,
        {} as any,
        {} as any,
        // Row 21: the domain service reads the restaurant's usual prep time on create.
        { findById: jest.fn().mockResolvedValue(null) } as any
      )
      jest.spyOn(domain, 'getByDeliveryQuoteId').mockResolvedValue(null as any)

      service = new DeliveryPartnerRestApiService(
        {
          getByIdOrThrow: jest.fn().mockResolvedValue({
            id: 'quote-1',
            expiresAt: futureDate,
            pickupLocationId: pickupLocation.id,
            dropoffLocationId: dropoffLocation.id,
            currency: 'EUR',
            quote: 500,
            dropoffEta: futureDate,
          }),
        } as any,
        domain,
        { getById: jest.fn().mockResolvedValue(new PartnerEntity({ id: 'partner-1' } as any)) } as any,
        {
          getByIds: jest.fn().mockResolvedValue([pickupLocation, dropoffLocation]),
          findOrCreate: jest.fn().mockImplementation((loc) => Promise.resolve({ id: `loc-${loc.latitude}`, ...loc })),
        } as any,
        {} as any,
        { isValidDeliveryLocationDrift: jest.fn().mockResolvedValue(true) } as any,
        { findOn: jest.fn().mockResolvedValue(null) } as any,
        { instanceConfig: { getRestaurantHistoryDays: () => Promise.resolve(30) } } as any,
        {} as any
      )
    })

    it('hands Prisma the items with kind as sent, in order, and nothing added to unmarked ones', async () => {
      const input = await transform(
        bodyWithItems([
          { name: 'Souvlaki', quantity: 2, size: 'LARGE' },
          { name: 'Cola', quantity: 2, kind: 'DRINK' },
          { name: 'Fries', quantity: 1, kind: 'SIDE' },
        ])
      )

      await service.create('partner-1', input)

      expect(prismaDeliveryCreate).toHaveBeenCalledTimes(1)
      const stored = prismaDeliveryCreate.mock.calls[0][0].data.orderItems
      // What a JSON column would hold.
      expect(JSON.parse(JSON.stringify(stored))).toEqual([
        { name: 'Souvlaki', quantity: 2, size: 'LARGE' },
        { name: 'Cola', quantity: 2, kind: 'DRINK' },
        { name: 'Fries', quantity: 1, kind: 'SIDE' },
      ])
    })

    it("stores today's single Package item unchanged (no kind)", async () => {
      const input = await transform(bodyWithItems([{ name: 'Package', quantity: 1, size: 'MEDIUM' }]))

      await service.create('partner-1', input)

      const stored = prismaDeliveryCreate.mock.calls[0][0].data.orderItems
      expect(JSON.parse(JSON.stringify(stored))).toEqual([{ name: 'Package', quantity: 1, size: 'MEDIUM' }])
    })
  })
})
