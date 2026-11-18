import { EnumPartnerChargeReason } from '@prisma/types'
import {
  adminLabel,
  amountsByCurrency,
  athensMonthOf,
  athensMonthRange,
  chargeHappenedAt,
  countByAthensMonth,
  isBillingMonth,
  nextBillingMonth,
  pickupAddressText,
  totalsByCurrency,
  waitEndEventId,
} from './billing-month'

describe('billing-month (Spec 0036, AC-1, AC-2, AC-4, AC-9)', () => {
  describe('isBillingMonth & nextBillingMonth (AC-2)', () => {
    it('isBillingMonth accepts valid YYYY-MM strings from 1970 onwards', () => {
      expect(isBillingMonth('2026-11')).toBe(true)
      expect(isBillingMonth('2026-12')).toBe(true)
      expect(isBillingMonth('2027-01')).toBe(true)
      expect(isBillingMonth('1970-01')).toBe(true)
    })

    it('isBillingMonth refuses invalid month strings or non-strings', () => {
      expect(isBillingMonth('2026-13')).toBe(false)
      expect(isBillingMonth('26-11')).toBe(false)
      expect(isBillingMonth('abc')).toBe(false)
      expect(isBillingMonth('2026-1')).toBe(false)
      expect(isBillingMonth('')).toBe(false)
      expect(isBillingMonth('1969-12')).toBe(false)
      expect(isBillingMonth(null)).toBe(false)
      expect(isBillingMonth(undefined)).toBe(false)
      expect(isBillingMonth(202611)).toBe(false)
    })

    it('nextBillingMonth advances YYYY-MM and rolls over year at December', () => {
      expect(nextBillingMonth('2026-11')).toBe('2026-12')
      expect(nextBillingMonth('2026-12')).toBe('2027-01')
      expect(nextBillingMonth('2027-09')).toBe('2027-10')
    })
  })

  describe('athensMonthRange & athensMonthOf (AC-2 boundary)', () => {
    // AC-2 boundary: a charge written 2026-11-30T22:30:00Z is December's
    it('AC-2 boundary: athensMonthRange("2026-12").start is 2026-11-30T22:00:00.000Z and November range ends there', () => {
      const decRange = athensMonthRange('2026-12')
      const novRange = athensMonthRange('2026-11')

      expect(decRange.start.toISOString()).toBe('2026-11-30T22:00:00.000Z')
      expect(novRange.end.toISOString()).toBe('2026-11-30T22:00:00.000Z')
      expect(decRange.end.toISOString()).toBe('2026-12-31T22:00:00.000Z')
    })

    it('summer month: athensMonthRange("2026-07") start is 21:00Z the day before due to EEST (UTC+3)', () => {
      const julRange = athensMonthRange('2026-07')
      expect(julRange.start.toISOString()).toBe('2026-06-30T21:00:00.000Z')
      expect(julRange.end.toISOString()).toBe('2026-07-31T21:00:00.000Z')
    })

    it('AC-2: athensMonthOf maps instant at 22:30Z on Nov 30 to December and before 22:00Z to November', () => {
      // 22:30 UTC is 00:30 on 1 Dec in Athens (UTC+2 in winter)
      expect(athensMonthOf(new Date('2026-11-30T22:30:00Z'))).toBe('2026-12')
      // 21:59:59 UTC is 23:59:59 on 30 Nov in Athens
      expect(athensMonthOf(new Date('2026-11-30T21:59:59Z'))).toBe('2026-11')
      // Summer (UTC+3): 21:00 UTC on 30 June is 00:00 on 1 July in Athens
      expect(athensMonthOf(new Date('2026-06-30T21:00:00Z'))).toBe('2026-07')
      expect(athensMonthOf(new Date('2026-06-30T20:59:59Z'))).toBe('2026-06')
    })
  })

  describe('totalsByCurrency & amountsByCurrency (AC-4)', () => {
    it('AC-4: totals are integer cent sums per currency, never added across currencies, with 0 charges counted', () => {
      const charges = [
        { amount: 500, currencyCode: 'EUR', billId: null },
        { amount: 300, currencyCode: 'EUR', billId: 'bill-1' },
        { amount: 0, currencyCode: 'EUR', billId: null }, // 0 charge counts as unbilled
        { amount: 200, currencyCode: 'USD', billId: 'bill-2' },
        { amount: 150, currencyCode: 'USD', billId: null },
      ]

      const totals = totalsByCurrency(charges)

      expect(totals).toEqual([
        { currencyCode: 'EUR', charged: 800, billed: 300, unbilled: 500 },
        { currencyCode: 'USD', charged: 350, billed: 200, unbilled: 150 },
      ])
    })

    it('per currency: totalsByCurrency groups by currency code without combining across currencies', () => {
      const charges = [
        { amount: 100, currencyCode: 'EUR', billId: null },
        { amount: 200, currencyCode: 'USD', billId: null },
      ]

      const totals = totalsByCurrency(charges)

      expect(totals).toHaveLength(2)
      expect(totals.map((t) => t.currencyCode)).toEqual(['EUR', 'USD'])
      expect(totals.find((t) => t.currencyCode === 'EUR')?.charged).toBe(100)
      expect(totals.find((t) => t.currencyCode === 'USD')?.charged).toBe(200)
    })

    it('amountsByCurrency aggregates amounts by currency and sorts by currencyCode', () => {
      const charges = [
        { amount: 250, currencyCode: 'USD' },
        { amount: 100, currencyCode: 'EUR' },
        { amount: 200, currencyCode: 'EUR' },
      ]

      const totals = amountsByCurrency(charges)

      expect(totals).toEqual([
        { currencyCode: 'EUR', amount: 300 },
        { currencyCode: 'USD', amount: 250 },
      ])
    })
  })

  describe('countByAthensMonth (AC-1)', () => {
    it('groups instants by Athens month and sorts oldest month first', () => {
      const instants = [
        new Date('2026-11-15T10:00:00Z'),
        new Date('2026-10-20T12:00:00Z'),
        new Date('2026-10-31T23:00:00Z'), // 1 Nov 01:00 Athens time -> 2026-11
        new Date('2026-09-01T08:00:00Z'),
      ]

      const grouped = countByAthensMonth(instants)

      expect(grouped).toEqual([
        { month: '2026-09', count: 1 },
        { month: '2026-10', count: 1 },
        { month: '2026-11', count: 2 },
      ])
    })
  })

  describe('waitEndEventId (Value sourcing)', () => {
    it('extracts event id after colon from waitOf', () => {
      expect(waitEndEventId('delivery-123:evt-456')).toBe('evt-456')
      expect(waitEndEventId('del:evt:nested')).toBe('evt:nested')
    })

    it('returns null when waitOf is null, empty or missing separator', () => {
      expect(waitEndEventId(null)).toBeNull()
      expect(waitEndEventId('')).toBeNull()
      expect(waitEndEventId('delivery-only-no-colon')).toBeNull()
      expect(waitEndEventId('delivery-colon-empty:')).toBeNull()
    })
  })

  describe('chargeHappenedAt (AC-3, Value sourcing)', () => {
    const createdAt = new Date('2026-11-10T12:00:00Z')
    const cancelledAt = new Date('2026-11-10T11:45:00Z')
    const waitEndedAt = new Date('2026-11-10T11:50:00Z')
    const removalDecidedAt = new Date('2026-11-10T11:55:00Z')

    it('uses cancelledAt for CANCELLATION, falling back to createdAt', () => {
      expect(
        chargeHappenedAt(
          { reason: EnumPartnerChargeReason.CANCELLATION, createdAt },
          { cancelledAt, waitEndedAt, removalDecidedAt }
        )
      ).toEqual(cancelledAt)

      expect(
        chargeHappenedAt(
          { reason: EnumPartnerChargeReason.CANCELLATION, createdAt },
          { cancelledAt: null, waitEndedAt, removalDecidedAt }
        )
      ).toEqual(createdAt)
    })

    it('uses waitEndedAt for WAITING, falling back to createdAt', () => {
      expect(
        chargeHappenedAt(
          { reason: EnumPartnerChargeReason.WAITING, createdAt },
          { cancelledAt, waitEndedAt, removalDecidedAt }
        )
      ).toEqual(waitEndedAt)

      expect(
        chargeHappenedAt(
          { reason: EnumPartnerChargeReason.WAITING, createdAt },
          { cancelledAt, waitEndedAt: null, removalDecidedAt }
        )
      ).toEqual(createdAt)
    })

    it('uses removalDecidedAt for REMOVAL, falling back to createdAt', () => {
      expect(
        chargeHappenedAt(
          { reason: EnumPartnerChargeReason.REMOVAL, createdAt },
          { cancelledAt, waitEndedAt, removalDecidedAt }
        )
      ).toEqual(removalDecidedAt)

      expect(
        chargeHappenedAt(
          { reason: EnumPartnerChargeReason.REMOVAL, createdAt },
          { cancelledAt, waitEndedAt, removalDecidedAt: null }
        )
      ).toEqual(createdAt)
    })
  })

  describe('pickupAddressText (AC-9, Value sourcing)', () => {
    it('prefers trimmed formattedAddress if present', () => {
      expect(
        pickupAddressText({
          formattedAddress: '  Iasonos 45, Volos 38221  ',
          addressLine1: 'Iasonos 45',
          city: 'Volos',
          zipCode: '38221',
        })
      ).toBe('Iasonos 45, Volos 38221')
    })

    it('falls back to addressLine1, city, zipCode joined with comma skipping empties', () => {
      expect(
        pickupAddressText({
          formattedAddress: null,
          addressLine1: 'Dimitriadis 12',
          city: 'Volos',
          zipCode: '38333',
        })
      ).toBe('Dimitriadis 12, Volos, 38333')

      expect(
        pickupAddressText({
          formattedAddress: '   ',
          addressLine1: 'Ermou 10',
          city: '',
          zipCode: '38221',
        })
      ).toBe('Ermou 10, 38221')
    })

    it('returns null when location is null or all fields empty', () => {
      expect(pickupAddressText(null)).toBeNull()
      expect(
        pickupAddressText({
          formattedAddress: '',
          addressLine1: null,
          city: '',
          zipCode: null,
        })
      ).toBeNull()
    })
  })

  describe('adminLabel', () => {
    it('returns email ?? username ?? id', () => {
      expect(adminLabel({ id: 'u-1', email: 'admin@coop.gr', username: 'admin' })).toBe('admin@coop.gr')
      expect(adminLabel({ id: 'u-2', email: null, username: 'adminuser' })).toBe('adminuser')
      expect(adminLabel({ id: 'u-3', email: null, username: null })).toBe('u-3')
    })
  })
})
