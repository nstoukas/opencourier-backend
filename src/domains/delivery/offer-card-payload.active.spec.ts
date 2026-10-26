import { EnumDistanceUnit } from '@prisma/types'
import {
  OFFER_CARD_PAYLOAD_KEYS,
  buildOfferCardPayload,
  OfferCardSource,
  OfferCardOptions,
} from './offer-card-payload'

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
    expect(payloadKeys).toHaveLength(11)
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
      // Customer location fields with distinctive marker values
      houseNumber: '7ZZ',
      formattedAddress: 'ZZADDR',
      addressLine1: 'ZZADDR',
      addressLine2: 'ZZADDR',
    }

    // Cast to the builder's input type as production passes the full Prisma delivery
    const source: OfferCardSource = {
      delivery: fullDelivery as unknown as OfferCardSource['delivery'],
      dropoffLocation: fullDropoffLocation as unknown as OfferCardSource['dropoffLocation'],
      quote: {
        distance: 1.8,
        distanceUnit: EnumDistanceUnit.KILOMETERS,
      },
    }

    const payload = buildOfferCardPayload(source, {
      serverNow: new Date('2026-10-26T14:30:02.000Z'),
      insistent: false,
    })

    // Output keys must equal OFFER_CARD_PAYLOAD_KEYS exactly
    expect(Object.keys(payload).sort()).toEqual([...OFFER_CARD_PAYLOAD_KEYS].sort())

    // Assert no output value contains any customer marker
    const sensitiveMarkers = ['ZZNAME', '+30699ZZ', '7ZZ', 'ZZNOTE', 'ZZITEM', 'ZZADDR']
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

    test('minutes is empty string until row 70', () => {
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
