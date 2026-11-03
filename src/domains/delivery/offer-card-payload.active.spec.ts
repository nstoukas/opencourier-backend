import { EnumDistanceUnit } from '@prisma/types'
import {
  OFFER_CARD_PAYLOAD_KEYS,
  buildOfferCardPayload,
  dropoffAreaOf,
  OfferCardSource,
  OfferCardOptions,
} from './offer-card-payload'
import { UNKNOWN_OFFER_TRIP } from './offer-trip'

describe('OfferCardPayload - Spec 0003 AC-10 Allow List & Customer Privacy', () => {
  // A complete source fixture with all allowed fields populated
  const createValidSource = (): OfferCardSource => ({
    delivery: {
      id: 'del-card-123',
      offeredAt: new Date('2026-10-26T12:00:00.000Z'),
      offerExpiresAt: new Date('2026-10-26T12:01:00.000Z'),
      totalCompensation: 350.4,
      currencyCode: 'EUR',
      pickupBusinessName: 'Volos Bakery',
    },
    dropoffLocation: {
      street: 'Iasonos',
      houseNumber: '42',
      city: 'Volos',
    },
    quote: {
      distance: 2.34,
      distanceUnit: EnumDistanceUnit.KILOMETERS,
    },
    // Row 100: the card's trip figures; unknown by default so older checks see the routing down case.
    trip: { ...UNKNOWN_OFFER_TRIP },
  })

  const defaultOptions: OfferCardOptions = {
    serverNow: new Date('2026-10-26T12:00:05.000Z'),
    insistent: false,
  }

  test('payload keys match OFFER_CARD_PAYLOAD_KEYS allow list exactly', () => {
    const source = createValidSource()
    const payload = buildOfferCardPayload(source, defaultOptions)

    const payloadKeys = Object.keys(payload).sort()
    const expectedKeys = [...OFFER_CARD_PAYLOAD_KEYS].sort()

    expect(payloadKeys).toEqual(expectedKeys)
    expect(payloadKeys).toHaveLength(13)
  })

  test('row 100: the allow list is exactly these thirteen keys (no customer field can be added silently)', () => {
    expect([...OFFER_CARD_PAYLOAD_KEYS].sort()).toEqual(
      [
        'deliveryId',
        'offeredAt',
        'offerExpiresAt',
        'serverNow',
        'payTotal',
        'currencyCode',
        'restaurantName',
        'dropoffArea',
        'distanceKm',
        'toPickupMetres',
        'toDropoffMetres',
        'minutes',
        'insistent',
      ].sort()
    )
  })

  test('row 100 (decision 100.2): the split is sent in metres, never as km keys, and distanceKm stays for older apps', () => {
    const source = createValidSource()
    const payload = buildOfferCardPayload(source, defaultOptions)

    expect(OFFER_CARD_PAYLOAD_KEYS).not.toContain('toPickupKm')
    expect(OFFER_CARD_PAYLOAD_KEYS).not.toContain('toDropoffKm')
    expect((payload as any).toPickupKm).toBeUndefined()
    expect((payload as any).toDropoffKm).toBeUndefined()
    // The quote's single figure is still there for an app older than row 100.
    expect(payload.distanceKm).toBe('2.3')
  })

  describe('row 100: the card trip in the payload (spec 0019 AC-1, decision 100.2)', () => {
    test('known figures are sent as whole-number text: metres to the restaurant, metres on to the customer, minutes', () => {
      const source = createValidSource()
      source.trip = { toPickupMetres: 873, toDropoffMetres: 1014, minutes: 4 }

      const payload = buildOfferCardPayload(source, defaultOptions)

      expect(payload.toPickupMetres).toBe('873')
      expect(payload.toDropoffMetres).toBe('1014')
      expect(payload.minutes).toBe('4')
      // The trip does not replace the quote's figure; both travel.
      expect(payload.distanceKm).toBe('2.3')
    })

    test('the trip figures are not the quote distance (2.34 km quote, 873 m + 1014 m trip)', () => {
      const source = createValidSource()
      source.trip = { toPickupMetres: 873, toDropoffMetres: 1014, minutes: 4 }

      const payload = buildOfferCardPayload(source, defaultOptions)

      expect(payload.toPickupMetres).not.toBe(payload.distanceKm)
      expect(payload.toDropoffMetres).not.toBe(payload.distanceKm)
      expect(payload.toDropoffMetres).not.toBe('2340')
    })

    test('a fractional figure is rounded to a whole number, never sent with a decimal point', () => {
      const source = createValidSource()
      source.trip = { toPickupMetres: 872.6, toDropoffMetres: 1013.4, minutes: 4 }

      const payload = buildOfferCardPayload(source, defaultOptions)

      expect(payload.toPickupMetres).toBe('873')
      expect(payload.toDropoffMetres).toBe('1013')
      for (const key of ['toPickupMetres', 'toDropoffMetres', 'minutes'] as const) {
        expect(payload[key]).toMatch(/^\d+$/)
      }
    })

    test('every unknown figure is the empty string (routing down: what the card shows)', () => {
      const source = createValidSource()
      source.trip = { toPickupMetres: null, toDropoffMetres: null, minutes: null }

      const payload = buildOfferCardPayload(source, defaultOptions)

      expect(payload.toPickupMetres).toBe('')
      expect(payload.toDropoffMetres).toBe('')
      expect(payload.minutes).toBe('')
    })

    test('one unknown leg: that leg is empty, the known one still shows, and minutes follow the trip (empty)', () => {
      const source = createValidSource()
      source.trip = { toPickupMetres: null, toDropoffMetres: 1014, minutes: null }

      const payload = buildOfferCardPayload(source, defaultOptions)

      expect(payload.toPickupMetres).toBe('')
      expect(payload.toDropoffMetres).toBe('1014')
      expect(payload.minutes).toBe('')
    })

    test('a zero-metre leg is a known figure ("0"), not unknown', () => {
      const source = createValidSource()
      source.trip = { toPickupMetres: 0, toDropoffMetres: 1014, minutes: 3 }

      const payload = buildOfferCardPayload(source, defaultOptions)

      expect(payload.toPickupMetres).toBe('0')
      expect(payload.minutes).toBe('3')
    })
  })

  test('AC-10: buildOfferCardPayload with full delivery object containing every customer field never leaks markers', () => {
    // Delivery with EVERY customer and sensitive field populated with distinctive marker values
    // Production passes the full Prisma delivery object and full dropoffLocation.
    const fullDelivery = {
      id: 'del-sensitive-999',
      offeredAt: new Date('2026-10-26T14:30:00.000Z'),
      offerExpiresAt: new Date('2026-10-26T14:31:00.000Z'),
      totalCompensation: 420,
      currencyCode: 'EUR',
      pickupBusinessName: 'Volos Souvlaki',
      pickupName: 'Shop Manager',
      pickupPhoneNumber: '+302421012345',
      // Customer fields filled with distinctive marker values
      dropoffName: 'ZZNAME',
      dropoffPhoneNumber: '+30699ZZ',
      dropoffNotes: 'ZZNOTE',
      pickupNotes: 'ZZNOTE',
      dropoffSellerNotes: 'ZZNOTE',
      orderItems: [{ name: 'ZZITEM', note: 'ZZNOTE' }],
    }

    const fullDropoffLocation = {
      id: 'loc-dropoff-1',
      street: 'Dimitriadis',
      city: 'Volos',
      // Row 100: production's source carries coordinates too; none may reach a value.
      latitude: 39.361234,
      longitude: 22.951234,
      // Customer location fields with distinctive marker values
      houseNumber: '7ZZ',
      formattedAddress: 'ZZADDR',
      addressLine1: 'ZZADDR',
      addressLine2: 'ZZADDR',
    }

    // Cast to the builder's input type as production passes the full Prisma delivery
    // Production spreads findOfferCardSourceOrThrow's result (which carries pickupLocation since row 100)
    // and adds the trip, so the source here does too.
    const source = {
      delivery: fullDelivery as unknown as OfferCardSource['delivery'],
      pickupLocation: { id: 'loc-pickup-1', street: 'Ermou', latitude: 39.364321, longitude: 22.944321 },
      dropoffLocation: fullDropoffLocation as unknown as OfferCardSource['dropoffLocation'],
      quote: {
        distance: 1.8,
        distanceUnit: EnumDistanceUnit.KILOMETERS,
      },
      trip: { toPickupMetres: 873, toDropoffMetres: 1014, minutes: 4 },
    } as OfferCardSource

    const payload = buildOfferCardPayload(source, {
      serverNow: new Date('2026-10-26T14:30:02.000Z'),
      insistent: false,
    })

    // Output keys must equal OFFER_CARD_PAYLOAD_KEYS exactly
    expect(Object.keys(payload).sort()).toEqual([...OFFER_CARD_PAYLOAD_KEYS].sort())

    // Assert no output value contains any customer marker
    const sensitiveMarkers = [
      'ZZNAME',
      '+30699ZZ',
      '7ZZ',
      'ZZNOTE',
      'ZZITEM',
      'ZZADDR',
      // Value 5: no coordinate (pickup or drop off) in any value, whole or in part.
      '39.36',
      '22.95',
      '22.94',
      '361234',
      '951234',
      '364321',
      '944321',
    ]
    for (const marker of sensitiveMarkers) {
      for (const [key, value] of Object.entries(payload)) {
        expect(value).not.toContain(marker)
      }
    }

    // Explicitly verify dropoffArea does not contain the house number 7ZZ
    expect(payload.dropoffArea).not.toContain('7ZZ')
    expect(payload.dropoffArea).toBe('Dimitriadis')
  })

  describe('dropoffArea logic', () => {
    test('returns street when houseNumber is separate and street does not include houseNumber', () => {
      const source = createValidSource()
      source.dropoffLocation = {
        street: 'Iasonos',
        houseNumber: '7ZZ',
        city: 'Volos',
      }

      const payload = buildOfferCardPayload(source, defaultOptions)
      expect(payload.dropoffArea).toBe('Iasonos')
    })

    test('falls back to city when street contains houseNumber', () => {
      const source = createValidSource()
      source.dropoffLocation = {
        street: 'Iasonos 7ZZ',
        houseNumber: '7ZZ',
        city: 'Volos',
      }

      const payload = buildOfferCardPayload(source, defaultOptions)
      // Must fall back to city to avoid leaking house number on lock screen
      expect(payload.dropoffArea).toBe('Volos')
    })

    test('returns empty string when city also contains houseNumber', () => {
      const source = createValidSource()
      source.dropoffLocation = {
        street: 'Iasonos 7ZZ',
        houseNumber: '7ZZ',
        city: 'Volos 7ZZ',
      }

      const payload = buildOfferCardPayload(source, defaultOptions)
      expect(payload.dropoffArea).toBe('')
    })

    test('returns empty string when dropoffLocation is null', () => {
      const source = createValidSource()
      source.dropoffLocation = null

      const payload = buildOfferCardPayload(source, defaultOptions)
      expect(payload.dropoffArea).toBe('')
    })

    test('falls back to city when street is empty', () => {
      const source = createValidSource()
      source.dropoffLocation = {
        street: '',
        houseNumber: '7ZZ',
        city: 'Volos',
      }

      const payload = buildOfferCardPayload(source, defaultOptions)
      expect(payload.dropoffArea).toBe('Volos')
    })
  })

  describe('distanceKm formatting', () => {
    test('formats distance in kilometers with one decimal place', () => {
      const source = createValidSource()
      source.quote = {
        distance: 3.42,
        distanceUnit: EnumDistanceUnit.KILOMETERS,
      }

      const payload = buildOfferCardPayload(source, defaultOptions)
      expect(payload.distanceKm).toBe('3.4')
    })

    test('converts distance in miles to kilometers with one decimal place', () => {
      const source = createValidSource()
      // 2 miles ≈ 3.218688 km -> rounded to "3.2"
      source.quote = {
        distance: 2.0,
        distanceUnit: EnumDistanceUnit.MILES,
      }

      const payload = buildOfferCardPayload(source, defaultOptions)
      expect(payload.distanceKm).toBe('3.2')
    })

    test('returns empty string when quote is null or distance is invalid', () => {
      const source = createValidSource()
      source.quote = null
      expect(buildOfferCardPayload(source, defaultOptions).distanceKm).toBe('')

      source.quote = {
        distance: NaN,
        distanceUnit: EnumDistanceUnit.KILOMETERS,
      }
      expect(buildOfferCardPayload(source, defaultOptions).distanceKm).toBe('')
    })
  })

  describe('payTotal and insistent formatting', () => {
    test('formats payTotal in minor units (cents) as rounded integer string', () => {
      const source = createValidSource()
      source.delivery.totalCompensation = 525.6

      const payload = buildOfferCardPayload(source, defaultOptions)
      expect(payload.payTotal).toBe('526')
    })

    test('returns empty string for payTotal when totalCompensation is null', () => {
      const source = createValidSource()
      source.delivery.totalCompensation = null as any

      const payload = buildOfferCardPayload(source, defaultOptions)
      expect(payload.payTotal).toBe('')
    })

    test('sets insistent to "1" when options.insistent is true', () => {
      const source = createValidSource()
      const payload = buildOfferCardPayload(source, {
        serverNow: new Date('2026-10-26T12:00:00.000Z'),
        insistent: true,
      })
      expect(payload.insistent).toBe('1')
    })

    test('sets insistent to empty string when options.insistent is false or undefined', () => {
      const source = createValidSource()
      const payload = buildOfferCardPayload(source, {
        serverNow: new Date('2026-10-26T12:00:00.000Z'),
      })
      expect(payload.insistent).toBe('')
    })

    test('minutes is empty string when the trip minutes are unknown', () => {
      const source = createValidSource()
      const payload = buildOfferCardPayload(source, defaultOptions)
      expect(payload.minutes).toBe('')
    })

    test('handles null offeredAt and offerExpiresAt with empty string', () => {
      const source = createValidSource()
      source.delivery.offeredAt = null
      source.delivery.offerExpiresAt = null

      const payload = buildOfferCardPayload(source, defaultOptions)
      expect(payload.offeredAt).toBe('')
      expect(payload.offerExpiresAt).toBe('')
    })
  })
})
