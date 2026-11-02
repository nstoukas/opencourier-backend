import { EnumDeliveryStatus } from '@prisma/types'
import { UNKNOWN_OFFER_TRIP, OfferTrip } from 'src/domains/delivery/offer-trip'
import { dropoffAreaOf } from 'src/domains/delivery/offer-card-payload'
import { NewDeliveryCourierDto } from './new-delivery.courier.dto'
import { NewDeliveriesCourierPaginatedDto } from './new-deliveries.courier.paginated.dto'
import { NewDeliveryCourier } from '../types/new-delivery.courier.type'
import { PaginationDto } from '../../../../core/dtos/PaginationDto'

/**
 * Spec 0019 (AC-1, AC-3) & Scope Row 70: NewDeliveryCourierDto and NewDeliveriesCourierPaginatedDto.
 *
 * Verifies that:
 * - NewDeliveryCourierDto carries offerTrip exactly (three fields: toPickupMetres, toDropoffMetres, minutes)
 * - dropoffArea is computed via dropoffAreaOf (street when street doesn't contain houseNumber, city otherwise)
 * - NewDeliveriesCourierPaginatedDto maps offers with trips by index and falls back to UNKNOWN_OFFER_TRIP when missing.
 */
describe('NewDeliveryCourierDto & NewDeliveriesCourierPaginatedDto (Spec 0019 AC-1, Row 70)', () => {
  const createMockNewDelivery = (
    id: string,
    dropoffLocationOverrides: Partial<NewDeliveryCourier['dropoffLocation']> = {}
  ): NewDeliveryCourier =>
    ({
      id,
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      createdAt: new Date('2026-11-02T10:00:00.000Z'),
      totalCompensation: 450,
      currencyCode: 'EUR',
      pickupBusinessName: 'Volos Bakery',
      dropoffPhoneNumber: '+306912345678',
      pickupLocation: {
        id: `loc-pickup-${id}`,
        street: 'Iasonos',
        houseNumber: '10',
        city: 'Volos',
        state: 'Magnesia',
      },
      dropoffLocation: {
        id: `loc-dropoff-${id}`,
        street: 'Dimitriadis',
        houseNumber: '42',
        city: 'Volos',
        state: 'Magnesia',
        ...dropoffLocationOverrides,
      },
    } as unknown as NewDeliveryCourier)

  describe('NewDeliveryCourierDto', () => {
    it('carries offerTrip exactly with the three fields', () => {
      const rawDelivery = createMockNewDelivery('del-1')
      const trip: OfferTrip = {
        toPickupMetres: 873,
        toDropoffMetres: 1015,
        minutes: 4,
      }

      const dto = new NewDeliveryCourierDto(rawDelivery, trip)

      expect(dto.offerTrip).toEqual({
        toPickupMetres: 873,
        toDropoffMetres: 1015,
        minutes: 4,
      })
      // Exactly the three keys
      expect(Object.keys(dto.offerTrip).sort()).toEqual(['minutes', 'toDropoffMetres', 'toPickupMetres'])
    })

    it('sets dropoffArea to street when the street does not include the house number', () => {
      const rawDelivery = createMockNewDelivery('del-2', {
        street: 'Dimitriadis',
        houseNumber: '42',
        city: 'Volos',
      })
      const dto = new NewDeliveryCourierDto(rawDelivery, UNKNOWN_OFFER_TRIP)

      expect(dto.dropoffArea).toBe('Dimitriadis')
    })

    it('sets dropoffArea to city when the street includes the house number', () => {
      const rawDelivery = createMockNewDelivery('del-3', {
        street: 'Dimitriadis 42',
        houseNumber: '42',
        city: 'Volos',
      })
      const dto = new NewDeliveryCourierDto(rawDelivery, UNKNOWN_OFFER_TRIP)

      // Falls back to city to avoid revealing customer house number on offer card
      expect(dto.dropoffArea).toBe('Volos')
    })

    it('sets dropoffArea to empty string when city also contains the house number', () => {
      const rawDelivery = createMockNewDelivery('del-4', {
        street: 'Dimitriadis 42',
        houseNumber: '42',
        city: 'Volos 42',
      })
      const dto = new NewDeliveryCourierDto(rawDelivery, UNKNOWN_OFFER_TRIP)

      expect(dto.dropoffArea).toBe('')
    })

    it('sets dropoffArea to empty string when street and city are empty or missing', () => {
      const rawDelivery = createMockNewDelivery('del-5', {
        street: '',
        houseNumber: '42',
        city: '',
      })
      const dto = new NewDeliveryCourierDto(rawDelivery, UNKNOWN_OFFER_TRIP)

      expect(dto.dropoffArea).toBe('')
      expect(dropoffAreaOf(null)).toBe('')
    })

    it('preserves customer phone privacy in ASSIGNING_COURIER status (Row 33)', () => {
      const rawDelivery = createMockNewDelivery('del-6')
      const dto = new NewDeliveryCourierDto(rawDelivery, UNKNOWN_OFFER_TRIP)

      expect(dto.dropoffPhoneNumber).toBeUndefined()
    })
  })

  describe('NewDeliveriesCourierPaginatedDto', () => {
    it('lines up offer trips by position with delivery data', () => {
      const delivery1 = createMockNewDelivery('del-p-1')
      const delivery2 = createMockNewDelivery('del-p-2')

      const trip1: OfferTrip = { toPickupMetres: 500, toDropoffMetres: 1200, minutes: 5 }
      const trip2: OfferTrip = { toPickupMetres: 300, toDropoffMetres: 800, minutes: 3 }

      const pagination: PaginationDto = {
        totalItems: 2,
        totalPages: 1,
        currentItems: 2,
        currentPage: 1,
        perPage: 10,
        prevPage: null,
        nextPage: null,
      }

      const paginatedDto = new NewDeliveriesCourierPaginatedDto(
        { data: [delivery1, delivery2], pagination },
        [trip1, trip2]
      )

      expect(paginatedDto.data).toHaveLength(2)
      expect(paginatedDto.data[0]?.offerTrip).toEqual(trip1)
      expect(paginatedDto.data[1]?.offerTrip).toEqual(trip2)
      expect(paginatedDto.pagination).toEqual(pagination)
      expect(paginatedDto.serverNow).toBeInstanceOf(Date)
    })

    it('falls back to all nulls (UNKNOWN_OFFER_TRIP) when a trip is missing for an index', () => {
      const delivery1 = createMockNewDelivery('del-missing-1')
      const delivery2 = createMockNewDelivery('del-missing-2')

      const trip1: OfferTrip = { toPickupMetres: 400, toDropoffMetres: 900, minutes: 4 }

      // Only 1 trip provided for 2 deliveries; index 1 is undefined
      const paginatedDto = new NewDeliveriesCourierPaginatedDto(
        { data: [delivery1, delivery2] },
        [trip1]
      )

      expect(paginatedDto.data).toHaveLength(2)
      expect(paginatedDto.data[0]?.offerTrip).toEqual(trip1)
      expect(paginatedDto.data[1]?.offerTrip).toEqual({
        toPickupMetres: null,
        toDropoffMetres: null,
        minutes: null,
      })
    })

    it('falls back to UNKNOWN_OFFER_TRIP for all deliveries when offerTrips array is empty', () => {
      const delivery1 = createMockNewDelivery('del-empty-1')
      const paginatedDto = new NewDeliveriesCourierPaginatedDto({ data: [delivery1] }, [])

      expect(paginatedDto.data).toHaveLength(1)
      expect(paginatedDto.data[0]?.offerTrip).toEqual({
        toPickupMetres: null,
        toDropoffMetres: null,
        minutes: null,
      })
    })
  })
})
