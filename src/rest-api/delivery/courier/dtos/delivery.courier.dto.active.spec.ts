import { EnumDeliveryStatus } from '@prisma/types'
import { OFFER_EXPIRY_GRACE_SECONDS } from 'src/constants'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryCourierDto } from './delivery.courier.dto'
import { DeliveryCourierPaginatedDto } from './delivery.courier.paginated.dto'
import { InProgressDeliveryCourierDto } from './in-progress-delivery.courier.dto'
import { NewDeliveryCourierDto } from './new-delivery.courier.dto'
import { NewDeliveriesCourierPaginatedDto } from './new-deliveries.courier.paginated.dto'
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
        rawDelivery as InProgressDeliveryCourier,
        { leaveMinutes: 10, freeMinutes: 10, payOn: true }
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
        rawDelivery as InProgressDeliveryCourier,
        { leaveMinutes: 10, freeMinutes: 10, payOn: true }
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

  describe('Free Hand Back Window & Privacy (Spec 0020 AC-3, AC-4, Decision 71.10)', () => {
    const fixedNow = new Date('2026-11-02T12:00:00.000Z').getTime()
    const futureDate = new Date('2026-11-02T12:01:00.000Z') // +60s in future
    const pastDate = new Date('2026-11-02T11:59:50.000Z') // -10s in past

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow)
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    test('handBackUntil is set only while in the future AND status is ACCEPTED or DISPATCHED', () => {
      // In ACCEPTED with future date: set
      const acceptedDelivery = createMockDelivery(EnumDeliveryStatus.ACCEPTED, {
        handBackUntil: futureDate,
      })
      const acceptedDto = new DeliveryCourierDto(acceptedDelivery)
      expect(acceptedDto.handBackUntil).toEqual(futureDate)

      // In DISPATCHED with future date: set
      const dispatchedDelivery = createMockDelivery(EnumDeliveryStatus.DISPATCHED, {
        handBackUntil: futureDate,
      })
      const dispatchedDto = new DeliveryCourierDto(dispatchedDelivery)
      expect(dispatchedDto.handBackUntil).toEqual(futureDate)

      // In ACCEPTED with past date: null
      const pastAcceptedDelivery = createMockDelivery(EnumDeliveryStatus.ACCEPTED, {
        handBackUntil: pastDate,
      })
      const pastAcceptedDto = new DeliveryCourierDto(pastAcceptedDelivery)
      expect(pastAcceptedDto.handBackUntil).toBeNull()

      // In DISPATCHED with past date: null
      const pastDispatchedDelivery = createMockDelivery(EnumDeliveryStatus.DISPATCHED, {
        handBackUntil: pastDate,
      })
      const pastDispatchedDto = new DeliveryCourierDto(pastDispatchedDelivery)
      expect(pastDispatchedDto.handBackUntil).toBeNull()

      // At COURIER_ARRIVED_AT_PICKUP_LOCATION (at restaurant): null even with future date
      const atRestaurantDelivery = createMockDelivery(
        EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        { handBackUntil: futureDate }
      )
      const atRestaurantDto = new DeliveryCourierDto(atRestaurantDelivery)
      expect(atRestaurantDto.handBackUntil).toBeNull()

      // Other statuses (PICKED_UP, ON_THE_WAY, CANCELED, etc.): null even with future date
      for (const status of [
        EnumDeliveryStatus.PICKED_UP,
        EnumDeliveryStatus.ON_THE_WAY,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
        EnumDeliveryStatus.DROPPED_OFF,
        EnumDeliveryStatus.CANCELED,
        EnumDeliveryStatus.FAILED,
        EnumDeliveryStatus.ASSIGNING_COURIER,
        EnumDeliveryStatus.CREATED,
      ]) {
        const d = createMockDelivery(status, { handBackUntil: futureDate })
        const dto = new DeliveryCourierDto(d)
        expect(dto.handBackUntil).toBeNull()
      }

      // When delivery.handBackUntil column is null: null
      const nullColDelivery = createMockDelivery(EnumDeliveryStatus.ACCEPTED, {
        handBackUntil: null,
      })
      const nullColDto = new DeliveryCourierDto(nullColDelivery)
      expect(nullColDto.handBackUntil).toBeNull()
    })

    test('while in hand back window: dropoffPhoneNumber, dropoffFloor, dropoffDoorbell and (decision 101.3) dropoffNotes are undefined and omitted from JSON; the name (decision 101.2) is sent', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.ACCEPTED, {
        handBackUntil: futureDate,
        dropoffPhoneNumber: customerPhone,
        dropoffFloor: '3',
        dropoffDoorbell: 'Papadopoulou',
        dropoffName: 'Giannis Papadopoulos',
      })
      const dto = new DeliveryCourierDto(delivery)

      // Withheld: undefined
      expect(dto.dropoffPhoneNumber).toBeUndefined()
      expect(dto.dropoffFloor).toBeUndefined()
      expect(dto.dropoffDoorbell).toBeUndefined()

      // Omitted from serialized JSON
      const jsonStr = JSON.stringify(dto)
      const serialized = JSON.parse(jsonStr)
      expect('dropoffPhoneNumber' in serialized).toBe(false)
      expect('dropoffFloor' in serialized).toBe(false)
      expect('dropoffDoorbell' in serialized).toBe(false)

      // Decision 71.10, kept by row 101 (decision 101.2): the customer's name and the address are NOT
      // withheld during the free hand back. Decision 101.3: dropoffNotes is, as it holds the composed
      // "Floor: · Doorbell:" line, so it would name the doorbell that dropoffDoorbell withholds.
      expect(dto.dropoffName).toBe('Giannis Papadopoulos')
      expect(serialized.dropoffName).toBe('Giannis Papadopoulos')
      expect(dto.dropoffNotes).toBeUndefined()
      expect('dropoffNotes' in serialized).toBe(false)
      expect(jsonStr).not.toContain('3rd floor, ring bell')
      expect(dto.dropoffLocationFormattedAddress).toContain('Dimitriadis 120')
    })

    test('the customer phone, floor and doorbell stay hidden for OFFER_EXPIRY_GRACE_SECONDS after handBackUntil (status ACCEPTED or DISPATCHED), while handBackUntil is already null', () => {
      // handBackUntil passed 1 second ago (inside the 3s OFFER_EXPIRY_GRACE_SECONDS window)
      const inGraceHandBackUntil = new Date(fixedNow - 1000)

      for (const status of [EnumDeliveryStatus.ACCEPTED, EnumDeliveryStatus.DISPATCHED]) {
        const delivery = createMockDelivery(status, {
          handBackUntil: inGraceHandBackUntil,
          dropoffPhoneNumber: customerPhone,
          dropoffFloor: '3',
          dropoffDoorbell: 'Papadopoulou',
        })
        const dto = new DeliveryCourierDto(delivery)

        // handBackUntil is already null once handBackUntil has passed
        expect(dto.handBackUntil).toBeNull()

        // Details stay hidden during grace
        expect(dto.dropoffPhoneNumber).toBeUndefined()
        expect(dto.dropoffFloor).toBeUndefined()
        expect(dto.dropoffDoorbell).toBeUndefined()

        // Omitted from serialized JSON
        const serialized = JSON.parse(JSON.stringify(dto))
        expect('dropoffPhoneNumber' in serialized).toBe(false)
        expect('dropoffFloor' in serialized).toBe(false)
        expect('dropoffDoorbell' in serialized).toBe(false)
      }
    })

    test('after OFFER_EXPIRY_GRACE_SECONDS past handBackUntil: handBackUntil is null and customer phone, floor and doorbell show (ACCEPTED and DISPATCHED)', () => {
      // handBackUntil passed 4 seconds ago (strictly after the 3s OFFER_EXPIRY_GRACE_SECONDS window)
      const afterGraceHandBackUntil = new Date(fixedNow - (OFFER_EXPIRY_GRACE_SECONDS + 1) * 1000)

      for (const status of [EnumDeliveryStatus.ACCEPTED, EnumDeliveryStatus.DISPATCHED]) {
        const delivery = createMockDelivery(status, {
          handBackUntil: afterGraceHandBackUntil,
          dropoffPhoneNumber: customerPhone,
          dropoffFloor: '3',
          dropoffDoorbell: 'Papadopoulou',
        })
        const dto = new DeliveryCourierDto(delivery)

        // handBackUntil is null
        expect(dto.handBackUntil).toBeNull()

        // Details show after grace has passed
        expect(dto.dropoffPhoneNumber).toBe(customerPhone)
        expect(dto.dropoffFloor).toBe('3')
        expect(dto.dropoffDoorbell).toBe('Papadopoulou')

        // Present in serialized JSON
        const serialized = JSON.parse(JSON.stringify(dto))
        expect(serialized.dropoffPhoneNumber).toBe(customerPhone)
        expect(serialized.dropoffFloor).toBe('3')
        expect(serialized.dropoffDoorbell).toBe('Papadopoulou')
      }
    })

    test('once handBackUntil is past: dropoffPhoneNumber, dropoffFloor, dropoffDoorbell show again', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.ACCEPTED, {
        handBackUntil: pastDate,
        dropoffPhoneNumber: customerPhone,
        dropoffFloor: '3',
        dropoffDoorbell: 'Papadopoulou',
      })
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.handBackUntil).toBeNull()
      expect(dto.dropoffPhoneNumber).toBe(customerPhone)
      expect(dto.dropoffFloor).toBe('3')
      expect(dto.dropoffDoorbell).toBe('Papadopoulou')

      const serialized = JSON.parse(JSON.stringify(dto))
      expect(serialized.dropoffPhoneNumber).toBe(customerPhone)
      expect(serialized.dropoffFloor).toBe('3')
      expect(serialized.dropoffDoorbell).toBe('Papadopoulou')
    })

    test('at COURIER_ARRIVED_AT_PICKUP_LOCATION: dropoffPhoneNumber, dropoffFloor, dropoffDoorbell show even if date is ahead', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, {
        handBackUntil: futureDate,
        dropoffPhoneNumber: customerPhone,
        dropoffFloor: '2',
        dropoffDoorbell: 'Smith',
      })
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.handBackUntil).toBeNull()
      expect(dto.dropoffPhoneNumber).toBe(customerPhone)
      expect(dto.dropoffFloor).toBe('2')
      expect(dto.dropoffDoorbell).toBe('Smith')
    })
  })

  /**
   * Row 101, decision 101.1: the customer's name, order items and notes follow the same
   * `holdsDelivery` rule as the phone. Done when: "an offered rider's offer carries no customer
   * name, items or customer notes; the same rider sees them once they accept; and a test fails if
   * any of them reaches an offer not yet accepted."
   *
   * The rule, written out here on its own rather than imported, so a change to the DTO's list
   * cannot quietly change what these tests expect:
   * - present only while the status is ACCEPTED to COURIER_ARRIVED_AT_DROPOFF_LOCATION,
   * - including during the free hand back window and its OFFER_EXPIRY_GRACE_SECONDS grace
   *   (decision 101.2: the app does not refetch when the window closes, and decision 71.12 keeps
   *   the item list there), while the phone, floor and doorbell stay withheld then (71.10),
   * - except dropoffNotes, which holds the composed "Floor: · Doorbell:" line and so follows the
   *   floor and doorbell: withheld in the window and its grace too (decision 101.3),
   * - otherwise undefined, so the key is absent from the JSON.
   */
  describe("Row 101: the customer's name, items and notes only while the rider holds the delivery", () => {
    const HELD_STATUSES: EnumDeliveryStatus[] = [
      EnumDeliveryStatus.ACCEPTED,
      EnumDeliveryStatus.DISPATCHED,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.ON_THE_WAY,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
    ]

    // Each value is distinctive and non-empty, so its absence from the JSON text means something.
    const CUSTOMER_DETAILS = {
      dropoffName: 'Kalliopi Offeridou',
      orderItems: [{ name: 'Bougatsa Thessalonikis', quantity: 2, price: 450 }],
      customerNotes: ['Allergic to sesame, no tahini'],
      dropoffNotes: 'Floor: 4 · Doorbell: Offeridou-K',
      dropoffSellerNotes: 'Paid by card, give receipt to Kalliopi',
    }
    type CustomerField = keyof typeof CUSTOMER_DETAILS
    const FIELDS = Object.keys(CUSTOMER_DETAILS) as CustomerField[]
    // Text that can only be in the JSON if that field leaked.
    const LEAK_TEXT: Record<CustomerField, string> = {
      dropoffName: 'Kalliopi Offeridou',
      orderItems: 'Bougatsa Thessalonikis',
      customerNotes: 'Allergic to sesame',
      dropoffNotes: 'Offeridou-K',
      dropoffSellerNotes: 'give receipt to Kalliopi',
    }

    const fixedNow = new Date('2026-11-03T12:00:00.000Z').getTime()

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow)
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    // dropoffNotes is the line composed from these two (decision 101.3), so the fixture matches it.
    const DOORBELL = 'Offeridou-K'
    const FLOOR = '4'

    function withDetails(status: EnumDeliveryStatus, overrides: Partial<DeliveryEntity> = {}): DeliveryEntity {
      return createMockDelivery(status, {
        ...(CUSTOMER_DETAILS as unknown as Partial<DeliveryEntity>),
        dropoffFloor: FLOOR,
        dropoffDoorbell: DOORBELL,
        handBackUntil: null,
        ...overrides,
      })
    }

    function expectFieldAbsent(dto: object, field: CustomerField) {
      expect((dto as Record<string, unknown>)[field]).toBeUndefined()
      const json = JSON.stringify(dto)
      expect(json).not.toContain(`"${field}"`)
      expect(json).not.toContain(LEAK_TEXT[field])
      expect(field in JSON.parse(json)).toBe(false)
    }

    function expectFieldPresent(dto: object, field: CustomerField) {
      expect((dto as Record<string, unknown>)[field]).toEqual(CUSTOMER_DETAILS[field])
      const parsed = JSON.parse(JSON.stringify(dto))
      expect(field in parsed).toBe(true)
      expect(parsed[field]).toEqual(CUSTOMER_DETAILS[field])
    }

    // Every status crossed with every field: present exactly when the status is a held one.
    const statusFieldPairs = Object.values(EnumDeliveryStatus).flatMap((status) =>
      FIELDS.map((field) => [status, field] as const)
    )

    test.each(statusFieldPairs)('status %s: %s is present exactly when the rider holds the delivery', (status, field) => {
      const dto = new DeliveryCourierDto(withDetails(status))
      if (HELD_STATUSES.includes(status)) {
        expectFieldPresent(dto, field)
      } else {
        expectFieldAbsent(dto, field)
      }
    })

    describe.each([
      EnumDeliveryStatus.CREATED,
      EnumDeliveryStatus.ASSIGNING_COURIER,
      EnumDeliveryStatus.DROPPED_OFF,
      EnumDeliveryStatus.CANCELED,
      EnumDeliveryStatus.FAILED,
    ])('%s (an offer not yet accepted, or a delivery that has ended)', (status) => {
      test.each(FIELDS)('%s is undefined and absent from the JSON', (field) => {
        expectFieldAbsent(new DeliveryCourierDto(withDetails(status)), field)
      })

      test('none of them is in the JSON even with an offer to this rider still open and a hand back time set', () => {
        const dto = new DeliveryCourierDto(
          withDetails(status, {
            matchedCourierId: 'courier-1',
            offeredAt: new Date(fixedNow - 5_000),
            offerExpiresAt: new Date(fixedNow + 55_000),
            handBackUntil: new Date(fixedNow - 600_000),
          } as Partial<DeliveryEntity>)
        )
        for (const field of FIELDS) expectFieldAbsent(dto, field)
      })
    })

    describe.each([EnumDeliveryStatus.ACCEPTED, EnumDeliveryStatus.DISPATCHED])('%s during the free hand back', (status) => {
      // Decision 101.2: the five arrive with the accept, through the hand back window and its grace,
      // while the phone, floor and doorbell (holdsDelivery, decision 71.10) stay withheld.
      const PHONE_FLOOR_DOORBELL = ['dropoffPhoneNumber', 'dropoffFloor', 'dropoffDoorbell']

      function expectPhoneFloorDoorbellWithheld(dto: DeliveryCourierDto) {
        const json = JSON.stringify(dto)
        const parsed = JSON.parse(json)
        for (const key of PHONE_FLOOR_DOORBELL) {
          expect((dto as unknown as Record<string, unknown>)[key]).toBeUndefined()
          expect(key in parsed).toBe(false)
        }
        // Decision 101.3: the doorbell name reaches the JSON through no field at all.
        expect(json).not.toContain(DOORBELL)
      }

      // In the window and its grace: dropoffNotes withheld with the floor and doorbell (101.3), the
      // other four sent (101.2).
      function expectWindowRule(dto: DeliveryCourierDto, field: CustomerField) {
        if (field === 'dropoffNotes') {
          expectFieldAbsent(dto, field)
        } else {
          expectFieldPresent(dto, field)
        }
      }

      test.each(FIELDS)('%s while handBackUntil is ahead: sent, except dropoffNotes (phone, floor, doorbell withheld)', (field) => {
        const dto = new DeliveryCourierDto(withDetails(status, { handBackUntil: new Date(fixedNow + 60_000) }))
        expect(dto.handBackUntil).toEqual(new Date(fixedNow + 60_000))
        expectWindowRule(dto, field)
        expectPhoneFloorDoorbellWithheld(dto)
      })

      test.each(FIELDS)('%s 1 s after handBackUntil, inside the grace: sent, except dropoffNotes (phone, floor, doorbell withheld)', (field) => {
        const dto = new DeliveryCourierDto(withDetails(status, { handBackUntil: new Date(fixedNow - 1_000) }))
        expect(dto.handBackUntil).toBeNull()
        expectWindowRule(dto, field)
        expectPhoneFloorDoorbellWithheld(dto)
      })

      test.each(FIELDS)('%s at the last millisecond of the grace: sent, except dropoffNotes (phone, floor, doorbell withheld)', (field) => {
        const dto = new DeliveryCourierDto(
          withDetails(status, { handBackUntil: new Date(fixedNow - OFFER_EXPIRY_GRACE_SECONDS * 1000 + 1) })
        )
        expectWindowRule(dto, field)
        expectPhoneFloorDoorbellWithheld(dto)
      })

      test.each(FIELDS)('%s shows once the window and its grace have passed', (field) => {
        const dto = new DeliveryCourierDto(
          withDetails(status, { handBackUntil: new Date(fixedNow - (OFFER_EXPIRY_GRACE_SECONDS + 1) * 1000) })
        )
        expectFieldPresent(dto, field)
      })

      test.each(FIELDS)('%s shows when there is no hand back window at all (handBackUntil null)', (field) => {
        expectFieldPresent(new DeliveryCourierDto(withDetails(status, { handBackUntil: null })), field)
      })

      test('the split in the window: dropoffName, orderItems, customerNotes and dropoffSellerNotes present; dropoffNotes, dropoffPhoneNumber, dropoffFloor and dropoffDoorbell absent', () => {
        const dto = new DeliveryCourierDto(withDetails(status, { handBackUntil: new Date(fixedNow + 60_000) }))
        const json = JSON.stringify(dto)
        const parsed = JSON.parse(json)

        expect(parsed.dropoffName).toBe(CUSTOMER_DETAILS.dropoffName)
        expect(parsed.orderItems).toEqual(CUSTOMER_DETAILS.orderItems)
        expect(parsed.customerNotes).toEqual(CUSTOMER_DETAILS.customerNotes)
        expect(parsed.dropoffSellerNotes).toBe(CUSTOMER_DETAILS.dropoffSellerNotes)

        // Decision 101.3: the composed floor and doorbell line goes with the floor and the doorbell.
        expect(dto.dropoffNotes).toBeUndefined()
        expect('dropoffNotes' in parsed).toBe(false)
        expect(json).not.toContain(CUSTOMER_DETAILS.dropoffNotes)

        expect(dto.dropoffPhoneNumber).toBeUndefined()
        expect(dto.dropoffFloor).toBeUndefined()
        expect(dto.dropoffDoorbell).toBeUndefined()
        expect('dropoffPhoneNumber' in parsed).toBe(false)
        expect('dropoffFloor' in parsed).toBe(false)
        expect('dropoffDoorbell' in parsed).toBe(false)
        // The fixture's phone and doorbell values are not in the text either, through any field.
        expect(json).not.toContain(customerPhone)
        expect(json).not.toContain(DOORBELL)
      })
    })

    test.each(FIELDS)('%s shows at PICKED_UP, even with a stale hand back time ahead', (field) => {
      // The hand back only applies at ACCEPTED and DISPATCHED; once picked up the rider holds the job.
      const dto = new DeliveryCourierDto(
        withDetails(EnumDeliveryStatus.PICKED_UP, { handBackUntil: new Date(fixedNow + 60_000) })
      )
      expectFieldPresent(dto, field)
    })

    test('the offer and its hand back keep what the rider needs to decide: restaurant, address and pay', () => {
      const dto = new DeliveryCourierDto(withDetails(EnumDeliveryStatus.ASSIGNING_COURIER))
      expect(dto.pickupName).toBe('Taverna Nosh')
      expect(dto.pickupPhoneNumber).toBe(restaurantPhone)
      expect(dto.dropoffLocationFormattedAddress).toContain('Dimitriadis 120')
      expect(dto.totalCompensation).toBe(350)
    })

    test('the offer list a rider fetches (NewDeliveriesCourierPaginatedDto) carries none of them', () => {
      const offers = [
        withDetails(EnumDeliveryStatus.ASSIGNING_COURIER, { id: 'del-offer-1' }),
        withDetails(EnumDeliveryStatus.ASSIGNING_COURIER, { id: 'del-offer-2' }),
      ] as unknown as NewDeliveryCourier[]
      const list = new NewDeliveriesCourierPaginatedDto({ data: offers }, [])

      expect(list.data).toHaveLength(2)
      for (const offer of list.data) {
        for (const field of FIELDS) expectFieldAbsent(offer, field)
      }
      const json = JSON.stringify(list)
      for (const field of FIELDS) {
        expect(json).not.toContain(`"${field}"`)
        expect(json).not.toContain(LEAK_TEXT[field])
      }
    })

    test('a single offer card (NewDeliveryCourierDto) carries none of them', () => {
      const dto = new NewDeliveryCourierDto(
        withDetails(EnumDeliveryStatus.ASSIGNING_COURIER) as unknown as NewDeliveryCourier,
        { toPickupMetres: 900, toDropoffMetres: 1800, minutes: 6 }
      )
      for (const field of FIELDS) expectFieldAbsent(dto, field)
    })

    test('a mixed list (DeliveryCourierPaginatedDto) shows them only on the held deliveries', () => {
      const list = new DeliveryCourierPaginatedDto({
        data: [
          withDetails(EnumDeliveryStatus.ASSIGNING_COURIER, { id: 'del-offer' }),
          withDetails(EnumDeliveryStatus.ACCEPTED, { id: 'del-accepted' }),
          withDetails(EnumDeliveryStatus.ON_THE_WAY, { id: 'del-on-the-way' }),
          withDetails(EnumDeliveryStatus.DROPPED_OFF, { id: 'del-dropped' }),
        ],
      })
      for (const field of FIELDS) {
        expectFieldAbsent(list.data[0]!, field)
        expectFieldPresent(list.data[1]!, field)
        expectFieldPresent(list.data[2]!, field)
        expectFieldAbsent(list.data[3]!, field)
      }
    })

    test('the in progress card (InProgressDeliveryCourierDto) carries them all once accepted', () => {
      const raw = withDetails(EnumDeliveryStatus.ACCEPTED) as any
      raw.pickupLocationNotes = []
      raw.dropoffLocationNotes = []
      const dto = new InProgressDeliveryCourierDto(raw as InProgressDeliveryCourier, {
        leaveMinutes: 10,
        freeMinutes: 10,
        payOn: true,
      })
      for (const field of FIELDS) expectFieldPresent(dto, field)
    })

    test('the same delivery for the same rider: none while offered, all once accepted, none once dropped off', () => {
      const offered = new DeliveryCourierDto(
        withDetails(EnumDeliveryStatus.ASSIGNING_COURIER, { courierId: null, matchedCourierId: 'courier-1' } as Partial<DeliveryEntity>)
      )
      const accepted = new DeliveryCourierDto(
        withDetails(EnumDeliveryStatus.ACCEPTED, { courierId: 'courier-1', matchedCourierId: null } as Partial<DeliveryEntity>)
      )
      const droppedOff = new DeliveryCourierDto(
        withDetails(EnumDeliveryStatus.DROPPED_OFF, { courierId: 'courier-1' })
      )
      for (const field of FIELDS) {
        expectFieldAbsent(offered, field)
        expectFieldPresent(accepted, field)
        expectFieldAbsent(droppedOff, field)
      }
    })
  })

  /**
   * Spec 0023: Restaurant ready signals.
   * DeliveryCourierDto carries readyAt and foodReadyAt from the delivery, null when absent.
   */
  describe('DeliveryCourierDto ready signals (Spec 0023, AC-7 & API surface)', () => {
    const readyAtDate = new Date('2026-11-03T12:15:00.000Z')
    const foodReadyAtDate = new Date('2026-11-03T12:20:00.000Z')

    test('carries readyAt and foodReadyAt when present on the delivery', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.ACCEPTED, {
        readyAt: readyAtDate,
        foodReadyAt: foodReadyAtDate,
      })
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.readyAt).toEqual(readyAtDate)
      expect(dto.foodReadyAt).toEqual(foodReadyAtDate)

      // Verifies JSON serialization retains the fields and their ISO strings
      const serialized = JSON.parse(JSON.stringify(dto))
      expect(serialized.readyAt).toBe('2026-11-03T12:15:00.000Z')
      expect(serialized.foodReadyAt).toBe('2026-11-03T12:20:00.000Z')
      expect('readyAt' in serialized).toBe(true)
      expect('foodReadyAt' in serialized).toBe(true)
    })

    test('sets readyAt and foodReadyAt to null when absent (undefined) on the delivery', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.ASSIGNING_COURIER)
      // Omit readyAt and foodReadyAt as on an order created before this change
      delete (delivery as any).readyAt
      delete (delivery as any).foodReadyAt

      const dto = new DeliveryCourierDto(delivery)

      expect(dto.readyAt).toBeNull()
      expect(dto.foodReadyAt).toBeNull()

      const serialized = JSON.parse(JSON.stringify(dto))
      expect(serialized.readyAt).toBeNull()
      expect(serialized.foodReadyAt).toBeNull()
      expect('readyAt' in serialized).toBe(true)
      expect('foodReadyAt' in serialized).toBe(true)
    })

    test('sets readyAt and foodReadyAt to null when explicitly null on the delivery', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.CREATED, {
        readyAt: null,
        foodReadyAt: null,
      })
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.readyAt).toBeNull()
      expect(dto.foodReadyAt).toBeNull()

      const serialized = JSON.parse(JSON.stringify(dto))
      expect(serialized.readyAt).toBeNull()
      expect(serialized.foodReadyAt).toBeNull()
    })

    test('sets foodReadyAt to null while readyAt is set and food is still preparing', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.DISPATCHED, {
        readyAt: readyAtDate,
        foodReadyAt: null,
      })
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.readyAt).toEqual(readyAtDate)
      expect(dto.foodReadyAt).toBeNull()

      const serialized = JSON.parse(JSON.stringify(dto))
      expect(serialized.readyAt).toBe('2026-11-03T12:15:00.000Z')
      expect(serialized.foodReadyAt).toBeNull()
    })

    test('ready signals are visible across both offered and held deliveries (restaurant promise, not customer data)', () => {
      const offerDelivery = createMockDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, {
        readyAt: readyAtDate,
        foodReadyAt: null,
      })
      const heldDelivery = createMockDelivery(EnumDeliveryStatus.ACCEPTED, {
        readyAt: readyAtDate,
        foodReadyAt: foodReadyAtDate,
      })

      const offerDto = new DeliveryCourierDto(offerDelivery)
      const heldDto = new DeliveryCourierDto(heldDelivery)

      expect(offerDto.readyAt).toEqual(readyAtDate)
      expect(offerDto.foodReadyAt).toBeNull()
      expect(heldDto.readyAt).toEqual(readyAtDate)
      expect(heldDto.foodReadyAt).toEqual(foodReadyAtDate)
    })
  })

  describe('arrivedAt only while at the pickup (Spec 0033 AC-5)', () => {
    const arrivedAtDate = new Date('2026-11-09T10:00:00.000Z')

    test('carries arrivedAt when status is COURIER_ARRIVED_AT_PICKUP_LOCATION', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, {
        arrivedAtPickupAt: arrivedAtDate,
      })
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.arrivedAt).toEqual(arrivedAtDate)
      const serialized = JSON.parse(JSON.stringify(dto))
      expect(serialized.arrivedAt).toBe('2026-11-09T10:00:00.000Z')
    })

    test('sets arrivedAt to null when arrivedAtPickupAt is null even at pickup location', () => {
      const delivery = createMockDelivery(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, {
        arrivedAtPickupAt: null,
      })
      const dto = new DeliveryCourierDto(delivery)

      expect(dto.arrivedAt).toBeNull()
    })

    const otherStatuses = [
      EnumDeliveryStatus.CREATED,
      EnumDeliveryStatus.ASSIGNING_COURIER,
      EnumDeliveryStatus.ACCEPTED,
      EnumDeliveryStatus.DISPATCHED,
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.ON_THE_WAY,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      EnumDeliveryStatus.DROPPED_OFF,
      EnumDeliveryStatus.CANCELED,
      EnumDeliveryStatus.FAILED,
    ]

    test.each(otherStatuses)(
      'sets arrivedAt to null in status %s even when arrivedAtPickupAt is present on delivery',
      (status) => {
        const delivery = createMockDelivery(status, {
          arrivedAtPickupAt: arrivedAtDate,
        })
        const dto = new DeliveryCourierDto(delivery)

        expect(dto.arrivedAt).toBeNull()
        const serialized = JSON.parse(JSON.stringify(dto))
        expect(serialized.arrivedAt).toBeNull()
      }
    )
  })

  describe('leaveFrom and paidFrom on InProgressDeliveryCourierDto (Spec 0033 AC-5)', () => {
    const waitRules = { leaveMinutes: 10, freeMinutes: 10, payOn: true }
    const promisedReadyAt = new Date('2026-11-09T10:00:00.000Z')
    const arrivedAtPickupAt = new Date('2026-11-09T09:58:00.000Z')

    test('leaveFrom and paidFrom set only at the pickup (COURIER_ARRIVED_AT_PICKUP_LOCATION)', () => {
      const waiting = createMockDelivery(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, {
        promisedReadyAt,
        arrivedAtPickupAt,
        foodReadyAt: null,
      }) as any
      waiting.pickupLocationNotes = []
      waiting.dropoffLocationNotes = []

      const dto = new InProgressDeliveryCourierDto(waiting, waitRules)
      expect(dto.leaveFrom).toEqual(new Date('2026-11-09T10:10:00.000Z'))
      expect(dto.paidFrom).toEqual(new Date('2026-11-09T10:10:00.000Z'))

      // Outside of pickup status, both are null
      const nonWaitingStatuses = [
        EnumDeliveryStatus.ACCEPTED,
        EnumDeliveryStatus.DISPATCHED,
        EnumDeliveryStatus.PICKED_UP,
        EnumDeliveryStatus.ON_THE_WAY,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      ]

      for (const status of nonWaitingStatuses) {
        const d = createMockDelivery(status, {
          promisedReadyAt,
          arrivedAtPickupAt,
        }) as any
        d.pickupLocationNotes = []
        d.dropoffLocationNotes = []
        const otherDto = new InProgressDeliveryCourierDto(d, waitRules)
        expect(otherDto.leaveFrom).toBeNull()
        expect(otherDto.paidFrom).toBeNull()
      }
    })

    test('paidFrom is null when payOn is false', () => {
      const waiting = createMockDelivery(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, {
        promisedReadyAt,
        arrivedAtPickupAt,
      }) as any
      waiting.pickupLocationNotes = []
      waiting.dropoffLocationNotes = []

      const dto = new InProgressDeliveryCourierDto(waiting, { ...waitRules, payOn: false })
      expect(dto.leaveFrom).toEqual(new Date('2026-11-09T10:10:00.000Z'))
      expect(dto.paidFrom).toBeNull()
    })

    test('paidFrom is null for a late rider with food ready', () => {
      // Promise 10:00, free 10 => free until 10:10.
      // Rider arrived late at 10:15, food was already ready at 10:05.
      const waiting = createMockDelivery(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, {
        promisedReadyAt,
        arrivedAtPickupAt: new Date('2026-11-09T10:15:00.000Z'),
        foodReadyAt: new Date('2026-11-09T10:05:00.000Z'),
      }) as any
      waiting.pickupLocationNotes = []
      waiting.dropoffLocationNotes = []

      const dto = new InProgressDeliveryCourierDto(waiting, waitRules)
      expect(dto.leaveFrom).toEqual(new Date('2026-11-09T10:10:00.000Z'))
      expect(dto.paidFrom).toBeNull()
    })
  })
})
