import { EnumDeliveryStatus } from '@prisma/types'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryCourierDto } from './delivery.courier.dto'
import { DeliveryCourierPaginatedDto } from './delivery.courier.paginated.dto'
import { InProgressDeliveryCourierDto } from './in-progress-delivery.courier.dto'
import { NewDeliveryCourierDto } from './new-delivery.courier.dto'
import { InProgressDeliveryCourier } from '../types/in-progress-delivery.courier.type'
import { NewDeliveryCourier } from '../types/new-delivery.courier.type'

/**
 * Scope Row 33 & Decision 33.1: Hide customer phone after delivery.
 *
 * Source of truth:
 * - Scope Row 33: "the rider can call the customer during an active delivery, and after drop off
 *   or cancellation the number no longer appears in the app or in any courier API response"
 * - Decision 33.1: DeliveryCourierDto carries dropoffPhoneNumber from ACCEPTED until the rider
 *   reaches the drop off, and leaves the field undefined (absent from JSON) otherwise: in an offer
 *   (CREATED / ASSIGNING_COURIER) and once dropped off, cancelled, or failed.
 * - Pickup phone number (restaurant) is always visible in all statuses.
 */
describe('DeliveryCourierDto - Customer Phone Number Privacy (Row 33, Decision 33.1)', () => {
  const restaurantPhone = '+302421012345'
  const customerPhone = '+306912345678'

  // Helper creating a delivery fixture for any status with realistic data
  function createMockDelivery(
    status: EnumDeliveryStatus,
    overrides: Partial<DeliveryEntity> = {}
  ): DeliveryEntity {
    return {
      id: `del-${status.toLowerCase()}-1`,
      createdAt: new Date('2026-11-01T08:00:00.000Z'),
      pickupName: 'Taverna Nosh',
      pickupPhoneNumber: restaurantPhone,
      pickupBusinessName: 'Taverna Nosh OE',
      pickupNotes: 'Kitchen entrance at back',
      pickupVerification: null,
      pickupLocationId: 'loc-pickup-1',
      pickupReadyAt: new Date('2026-11-01T08:15:00.000Z'),
      pickupDeadlineAt: new Date('2026-11-01T08:30:00.000Z'),
      dropoffName: 'Giannis Papadopoulos',
      dropoffPhoneNumber: customerPhone,
      dropoffBusinessName: null,
      dropoffNotes: '3rd floor, ring bell',
      dropoffSellerNotes: null,
      dropoffFloor: '3',
      dropoffDoorbell: 'Papadopoulou',
      dropoffPointCorrectedAt: null,
      dropoffVerification: null,
      dropoffReadyAt: null,
      dropoffEta: new Date('2026-11-01T08:45:00.000Z'),
      dropoffDeadlineAt: new Date('2026-11-01T08:50:00.000Z'),
      deliverableAction: 'HAND_DELIVERY' as any,
      undeliverableAction: null,
      undeliverableReason: null,
      dropoffLocationId: 'loc-dropoff-1',
      deliveryTypes: ['FOOD'],
      requiresDropoffSignature: false,
      requiresId: false,
      orderReference: 'ORD-999',
      orderTotalValue: 1550,
      orderItems: null,
      status,
      customerNotes: [],
      currencyCode: 'EUR',
      totalCost: 1550,
      fee: 250,
      feePercentage: null,
      pay: 300,
      tips: 50,
      totalCompensation: 350,
      pickupTypes: ['FOOD'],
      imageType: null,
      imageName: null,
      imageData: null,
      idempotencyKey: null,
      externalStoreId: null,
      returnVerification: null,
      externalUserInfo: null,
      externalId: null,
      courierId: 'courier-1',
      partnerId: 'partner-1',
      deliveryQuoteId: 'quote-1',
      customerName: 'Giannis Papadopoulos',
      customerPhoneNumber: customerPhone,
      offeredAt: null,
      offerExpiresAt: null,
      pickupLocation: {
        id: 'loc-pickup-1',
        street: 'Iasonos 45',
        city: 'Volos',
        state: 'Magnesia',
      },
      dropoffLocation: {
        id: 'loc-dropoff-1',
        street: 'Dimitriadis 120',
        city: 'Volos',
        state: 'Magnesia',
      },
      ...overrides,
    } as unknown as DeliveryEntity
  }

  describe('Held deliveries (active statuses) carry dropoffPhoneNumber (Requirement 1)', () => {
    test('carries dropoffPhoneNumber when status is ACCEPTED', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.ACCEPTED)
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.dropoffPhoneNumber).toBe(customerPhone)
      // Confirm JSON serialization includes the dropoffPhoneNumber key and value
      const serialized = JSON.parse(JSON.stringify(dto))
      expect(serialized.dropoffPhoneNumber).toBe(customerPhone)
      expect('dropoffPhoneNumber' in serialized).toBe(true)
    })

    test('carries dropoffPhoneNumber when status is DISPATCHED', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.DISPATCHED)
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.dropoffPhoneNumber).toBe(customerPhone)
      const serialized = JSON.parse(JSON.stringify(dto))
      expect(serialized.dropoffPhoneNumber).toBe(customerPhone)
      expect('dropoffPhoneNumber' in serialized).toBe(true)
    })

    test('carries dropoffPhoneNumber when status is COURIER_ARRIVED_AT_PICKUP_LOCATION', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.dropoffPhoneNumber).toBe(customerPhone)
      const serialized = JSON.parse(JSON.stringify(dto))
      expect(serialized.dropoffPhoneNumber).toBe(customerPhone)
      expect('dropoffPhoneNumber' in serialized).toBe(true)
    })

    test('carries dropoffPhoneNumber when status is PICKED_UP', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.PICKED_UP)
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.dropoffPhoneNumber).toBe(customerPhone)
      const serialized = JSON.parse(JSON.stringify(dto))
      expect(serialized.dropoffPhoneNumber).toBe(customerPhone)
      expect('dropoffPhoneNumber' in serialized).toBe(true)
    })

    test('carries dropoffPhoneNumber when status is ON_THE_WAY', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.ON_THE_WAY)
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.dropoffPhoneNumber).toBe(customerPhone)
      const serialized = JSON.parse(JSON.stringify(dto))
      expect(serialized.dropoffPhoneNumber).toBe(customerPhone)
      expect('dropoffPhoneNumber' in serialized).toBe(true)
    })

    test('carries dropoffPhoneNumber when status is COURIER_ARRIVED_AT_DROPOFF_LOCATION', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION)
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.dropoffPhoneNumber).toBe(customerPhone)
      const serialized = JSON.parse(JSON.stringify(dto))
      expect(serialized.dropoffPhoneNumber).toBe(customerPhone)
      expect('dropoffPhoneNumber' in serialized).toBe(true)
    })
  })

  describe('Unheld and ended deliveries leave dropoffPhoneNumber undefined and out of JSON (Requirement 2)', () => {
    test('leaves dropoffPhoneNumber undefined for CREATED', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.CREATED)
      const dto = new DeliveryCourierDto(delivery)

      // Must be undefined, NOT null (undefined strips the property in JSON.stringify)
      expect(dto.dropoffPhoneNumber).toBeUndefined()
      expect(dto.dropoffPhoneNumber).not.toBeNull()

      const jsonStr = JSON.stringify(dto)
      expect(jsonStr).not.toContain('"dropoffPhoneNumber"')

      const serialized = JSON.parse(jsonStr)
      expect('dropoffPhoneNumber' in serialized).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(serialized, 'dropoffPhoneNumber')).toBe(false)
    })

    test('leaves dropoffPhoneNumber undefined for ASSIGNING_COURIER (offer before acceptance)', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.ASSIGNING_COURIER)
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.dropoffPhoneNumber).toBeUndefined()
      expect(dto.dropoffPhoneNumber).not.toBeNull()

      const jsonStr = JSON.stringify(dto)
      expect(jsonStr).not.toContain('"dropoffPhoneNumber"')

      const serialized = JSON.parse(jsonStr)
      expect('dropoffPhoneNumber' in serialized).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(serialized, 'dropoffPhoneNumber')).toBe(false)
    })

    test('leaves dropoffPhoneNumber undefined for DROPPED_OFF (completed delivery)', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.DROPPED_OFF)
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.dropoffPhoneNumber).toBeUndefined()
      expect(dto.dropoffPhoneNumber).not.toBeNull()

      const jsonStr = JSON.stringify(dto)
      expect(jsonStr).not.toContain('"dropoffPhoneNumber"')

      const serialized = JSON.parse(jsonStr)
      expect('dropoffPhoneNumber' in serialized).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(serialized, 'dropoffPhoneNumber')).toBe(false)
    })

    test('leaves dropoffPhoneNumber undefined for CANCELED', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.CANCELED)
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.dropoffPhoneNumber).toBeUndefined()
      expect(dto.dropoffPhoneNumber).not.toBeNull()

      const jsonStr = JSON.stringify(dto)
      expect(jsonStr).not.toContain('"dropoffPhoneNumber"')

      const serialized = JSON.parse(jsonStr)
      expect('dropoffPhoneNumber' in serialized).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(serialized, 'dropoffPhoneNumber')).toBe(false)
    })

    test('leaves dropoffPhoneNumber undefined for FAILED', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.FAILED)
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.dropoffPhoneNumber).toBeUndefined()
      expect(dto.dropoffPhoneNumber).not.toBeNull()

      const jsonStr = JSON.stringify(dto)
      expect(jsonStr).not.toContain('"dropoffPhoneNumber"')

      const serialized = JSON.parse(jsonStr)
      expect('dropoffPhoneNumber' in serialized).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(serialized, 'dropoffPhoneNumber')).toBe(false)
    })
  })

  describe('Restaurant pickupPhoneNumber is unchanged in every delivery status (Requirement 3)', () => {
    const allStatuses = Object.values(EnumDeliveryStatus)

    test.each(allStatuses)(
      'preserves pickupPhoneNumber for status %s',
      (status) => {
        const delivery = createMockDelivery(status)
        const dto = new DeliveryCourierDto(delivery)

        // The restaurant phone is always visible so the rider can call the restaurant
        expect(dto.pickupPhoneNumber).toBe(restaurantPhone)

        const serialized = JSON.parse(JSON.stringify(dto))
        expect(serialized.pickupPhoneNumber).toBe(restaurantPhone)
      }
    )
  })

  describe('DeliveryCourierPaginatedDto applies privacy to mixed delivery lists (Requirement 4)', () => {
    test('mixed delivery list shows customer phone only on held deliveries', () => {
      const deliveries = [
        createMockDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, { id: 'del-offer' }),
        createMockDelivery(EnumDeliveryStatus.ACCEPTED, { id: 'del-accepted' }),
        createMockDelivery(EnumDeliveryStatus.PICKED_UP, { id: 'del-picked-up' }),
        createMockDelivery(EnumDeliveryStatus.DROPPED_OFF, { id: 'del-dropped-off' }),
        createMockDelivery(EnumDeliveryStatus.CANCELED, { id: 'del-canceled' }),
      ]

      const paginatedDto = new DeliveryCourierPaginatedDto({ data: deliveries })

      expect(paginatedDto.data).toHaveLength(5)

      // In TypeScript DTO instance:
      expect(paginatedDto.data[0]?.dropoffPhoneNumber).toBeUndefined()
      expect(paginatedDto.data[1]?.dropoffPhoneNumber).toBe(customerPhone)
      expect(paginatedDto.data[2]?.dropoffPhoneNumber).toBe(customerPhone)
      expect(paginatedDto.data[3]?.dropoffPhoneNumber).toBeUndefined()
      expect(paginatedDto.data[4]?.dropoffPhoneNumber).toBeUndefined()

      // When serialized as JSON (as sent over the HTTP courier API):
      const jsonString = JSON.stringify(paginatedDto)
      const parsed = JSON.parse(jsonString)

      // Index 0: ASSIGNING_COURIER - no dropoffPhoneNumber in JSON
      expect('dropoffPhoneNumber' in parsed.data[0]).toBe(false)
      expect(parsed.data[0].pickupPhoneNumber).toBe(restaurantPhone)

      // Index 1: ACCEPTED - dropoffPhoneNumber is present in JSON
      expect('dropoffPhoneNumber' in parsed.data[1]).toBe(true)
      expect(parsed.data[1].dropoffPhoneNumber).toBe(customerPhone)
      expect(parsed.data[1].pickupPhoneNumber).toBe(restaurantPhone)

      // Index 2: PICKED_UP - dropoffPhoneNumber is present in JSON
      expect('dropoffPhoneNumber' in parsed.data[2]).toBe(true)
      expect(parsed.data[2].dropoffPhoneNumber).toBe(customerPhone)
      expect(parsed.data[2].pickupPhoneNumber).toBe(restaurantPhone)

      // Index 3: DROPPED_OFF - no dropoffPhoneNumber in JSON
      expect('dropoffPhoneNumber' in parsed.data[3]).toBe(false)
      expect(parsed.data[3].pickupPhoneNumber).toBe(restaurantPhone)

      // Index 4: CANCELED - no dropoffPhoneNumber in JSON
      expect('dropoffPhoneNumber' in parsed.data[4]).toBe(false)
      expect(parsed.data[4].pickupPhoneNumber).toBe(restaurantPhone)
    })
  })

  describe('Derived DTOs inherit customer phone privacy', () => {
    test('InProgressDeliveryCourierDto carries customer phone when delivery is in progress', () => {
      const rawDelivery = createMockDelivery(EnumDeliveryStatus.ACCEPTED) as any
      rawDelivery.pickupLocationNotes = []
      rawDelivery.dropoffLocationNotes = []

      const inProgressDto = new InProgressDeliveryCourierDto(
        rawDelivery as InProgressDeliveryCourier
      )

      expect(inProgressDto.dropoffPhoneNumber).toBe(customerPhone)
      const serialized = JSON.parse(JSON.stringify(inProgressDto))
      expect(serialized.dropoffPhoneNumber).toBe(customerPhone)
    })

    test('InProgressDeliveryCourierDto leaves customer phone undefined when status is DROPPED_OFF', () => {
      const rawDelivery = createMockDelivery(EnumDeliveryStatus.DROPPED_OFF) as any
      rawDelivery.pickupLocationNotes = []
      rawDelivery.dropoffLocationNotes = []

      const inProgressDto = new InProgressDeliveryCourierDto(
        rawDelivery as InProgressDeliveryCourier
      )

      expect(inProgressDto.dropoffPhoneNumber).toBeUndefined()
      const serialized = JSON.parse(JSON.stringify(inProgressDto))
      expect('dropoffPhoneNumber' in serialized).toBe(false)
    })

    test('NewDeliveryCourierDto leaves customer phone undefined for offer (ASSIGNING_COURIER)', () => {
      const rawDelivery = createMockDelivery(EnumDeliveryStatus.ASSIGNING_COURIER) as any

      const newDeliveryDto = new NewDeliveryCourierDto(
        rawDelivery as NewDeliveryCourier,
        { toPickupMetres: null, toDropoffMetres: null, minutes: null }
      )

      expect(newDeliveryDto.dropoffPhoneNumber).toBeUndefined()
      const serialized = JSON.parse(JSON.stringify(newDeliveryDto))
      expect('dropoffPhoneNumber' in serialized).toBe(false)
      expect(serialized.pickupPhoneNumber).toBe(restaurantPhone)
    })
  })

  describe('Floor, Doorbell and DropoffPointCorrectedAt Privacy (Spec 0016 AC-7)', () => {
    const heldStatuses = [
      EnumDeliveryStatus.ACCEPTED,
      EnumDeliveryStatus.DISPATCHED,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.ON_THE_WAY,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
    ]

    const unheldStatuses = [
      EnumDeliveryStatus.CREATED,
      EnumDeliveryStatus.ASSIGNING_COURIER,
      EnumDeliveryStatus.DROPPED_OFF,
      EnumDeliveryStatus.CANCELED,
    ]

    describe.each(heldStatuses)('Held status %s carries floor and doorbell', (status) => {
      test(`carries dropoffFloor and dropoffDoorbell in ${status}`, () => {
        const delivery = createMockDelivery(status)
        const dto = new DeliveryCourierDto(delivery)

        expect(dto.dropoffFloor).toBe('3')
        expect(dto.dropoffDoorbell).toBe('Papadopoulou')

        const serialized = JSON.parse(JSON.stringify(dto))
        expect(serialized.dropoffFloor).toBe('3')
        expect(serialized.dropoffDoorbell).toBe('Papadopoulou')
        expect('dropoffFloor' in serialized).toBe(true)
        expect('dropoffDoorbell' in serialized).toBe(true)
      })
    })

    describe.each(unheldStatuses)('Unheld status %s hides floor and doorbell', (status) => {
      test(`leaves dropoffFloor and dropoffDoorbell undefined and absent from JSON in ${status}`, () => {
        const delivery = createMockDelivery(status)
        const dto = new DeliveryCourierDto(delivery)

        expect(dto.dropoffFloor).toBeUndefined()
        expect(dto.dropoffDoorbell).toBeUndefined()

        const jsonStr = JSON.stringify(dto)
        expect(jsonStr).not.toContain('"dropoffFloor"')
        expect(jsonStr).not.toContain('"dropoffDoorbell"')

        const serialized = JSON.parse(jsonStr)
        expect('dropoffFloor' in serialized).toBe(false)
        expect('dropoffDoorbell' in serialized).toBe(false)
      })
    })

    describe('dropoffPointCorrectedAt present in every status', () => {
      test.each([...heldStatuses, ...unheldStatuses])(
        'includes dropoffPointCorrectedAt (null) in status %s',
        (status) => {
          const delivery = createMockDelivery(status, { dropoffPointCorrectedAt: null })
          const dto = new DeliveryCourierDto(delivery)

          expect(dto.dropoffPointCorrectedAt).toBeNull()
          const serialized = JSON.parse(JSON.stringify(dto))
          expect(serialized.dropoffPointCorrectedAt).toBeNull()
          expect('dropoffPointCorrectedAt' in serialized).toBe(true)
        }
      )

      test.each([...heldStatuses, ...unheldStatuses])(
        'includes dropoffPointCorrectedAt (Date) in status %s',
        (status) => {
          const correctedDate = new Date('2026-11-02T01:30:00.000Z')
          const delivery = createMockDelivery(status, { dropoffPointCorrectedAt: correctedDate })
          const dto = new DeliveryCourierDto(delivery)

          expect(dto.dropoffPointCorrectedAt).toEqual(correctedDate)
          const serialized = JSON.parse(JSON.stringify(dto))
          expect(serialized.dropoffPointCorrectedAt).toBe('2026-11-02T01:30:00.000Z')
          expect('dropoffPointCorrectedAt' in serialized).toBe(true)
        }
      )
    })
  })
})
