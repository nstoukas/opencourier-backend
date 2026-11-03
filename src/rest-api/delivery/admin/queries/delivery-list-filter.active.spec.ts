import { EnumDeliveryStatus, Prisma } from '@prisma/types'
import {
  adminDeliveryListWhere,
  ADMIN_DELIVERY_STATES,
  MAX_DELIVERY_SEARCH_LENGTH,
} from './delivery-list-filter'

// The deliveries search (spec 0025, AC-1): the database keeps `searchFold`, the folded order
// reference, customer name and restaurant name joined by newlines. The search must be one OR of
// `searchFold contains <folded, escaped text>` and `id endsWith <folded, escaped text>`, with no
// insensitive mode (the folded text is already lower case).
function expectSearchRule(where: Prisma.DeliveryWhereInput, literal: string) {
  expect(where.OR).toHaveLength(2)
  expect(where.OR).toEqual(
    expect.arrayContaining([{ searchFold: { contains: literal } }, { id: { endsWith: literal } }])
  )
  expect(JSON.stringify(where.OR)).not.toContain('"mode"')
}

// What PostgreSQL's LIKE does with a Prisma `contains` (pattern %text%) or `endsWith` (%text):
// backslash escapes the next character, % is any run of characters, _ is any one character.
function likeMatches(value: string, pattern: string): boolean {
  let regex = ''
  for (let i = 0; i < pattern.length; i++) {
    const character = pattern[i]!
    if (character === '\\') {
      i++
      if (i >= pattern.length) throw new Error('LIKE pattern ends with an escape character')
      regex += pattern[i]!.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    } else if (character === '%') regex += '[\\s\\S]*'
    else if (character === '_') regex += '[\\s\\S]'
    else regex += character.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  }
  return new RegExp(`^${regex}$`).test(value)
}

// A tiny stand in for the database: does a delivery row match the search part of a where? Only
// the shapes the search may use are understood; anything else (a `mode`, another field) throws.
type SearchRow = { id: string; searchFold: string }
function rowMatches(where: any, row: SearchRow): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return (value as any[]).some((clause) => rowMatches(clause, row))
    if (key === 'AND') return (value as any[]).every((clause) => rowMatches(clause, row))
    if (key !== 'searchFold' && key !== 'id') throw new Error(`unexpected field ${key}`)
    const keys = Object.keys(value)
    if (keys.length !== 1) throw new Error(`unexpected filter ${JSON.stringify(value)}`)
    if (keys[0] === 'contains') return likeMatches(row[key], `%${value.contains}%`)
    if (keys[0] === 'endsWith') return likeMatches(row[key], `%${value.endsWith}`)
    throw new Error(`unexpected filter ${JSON.stringify(value)}`)
  })
}
function finds(search: string, row: SearchRow): boolean {
  return rowMatches(adminDeliveryListWhere({ search }), row)
}

// Rows as the database trigger stores them: oc_search_fold(orderReference) \n
// oc_search_fold(dropoffName) \n oc_search_fold(pickupBusinessName). Written by hand from the
// spec's rule (lower case, accents removed, every sigma as σ).
const NIKOS: SearchRow = {
  id: 'clx7k2m9p0001qz8rabc123def',
  searchFold: 'ord-1042\nνικοσ παπαδοπουλοσ\nψητοπωλειο ο θανασησ',
}
const CAFE: SearchRow = {
  id: 'clx7k2m9p0002qz8r999888777',
  searchFold: 'ord%7\nmaria\ncafe du port',
}
const PLAIN: SearchRow = {
  id: 'clx7k2m9p0003qz8r111222333',
  searchFold: 'ord-7\nelena\nsouvlaki bar',
}

describe('delivery-list-filter', () => {
  describe('ADMIN_DELIVERY_STATES and MAX_DELIVERY_SEARCH_LENGTH', () => {
    test('ADMIN_DELIVERY_STATES contains exactly the four allowed states', () => {
      expect(ADMIN_DELIVERY_STATES).toEqual(['all', 'active', 'dropped_off', 'canceled'])
    })

    test('MAX_DELIVERY_SEARCH_LENGTH is 100 characters', () => {
      expect(MAX_DELIVERY_SEARCH_LENGTH).toBe(100)
    })
  })

  describe('adminDeliveryListWhere', () => {
    test('no filter gives empty where object {}', () => {
      expect(adminDeliveryListWhere({})).toEqual({})
      expect(
        adminDeliveryListWhere({
          courierId: undefined,
          state: undefined,
          search: undefined,
        })
      ).toEqual({})
    })

    test('courierId is kept in where', () => {
      const where = adminDeliveryListWhere({ courierId: 'courier-volos-1' })
      expect(where).toEqual({ courierId: 'courier-volos-1' })
    })

    test('empty string courierId is kept as a filter (row 96 review fix)', () => {
      // Empty courierId filters to deliveries matching empty string (none), as before row 96
      const where = adminDeliveryListWhere({ courierId: '' })
      expect(where).toEqual({ courierId: '' })
      expect(where.courierId).toBe('')
    })

    test('undefined courierId does not add courierId to where', () => {
      const where = adminDeliveryListWhere({ courierId: undefined })
      expect(where).toEqual({})
      expect('courierId' in where).toBe(false)
    })

    describe('partnerId filter (spec 0017, AC-7)', () => {
      test('partnerId is kept in where', () => {
        const where = adminDeliveryListWhere({ partnerId: 'partner-volos-1' })
        expect(where).toEqual({ partnerId: 'partner-volos-1' })
      })

      test('partnerId with surrounding whitespace is trimmed', () => {
        const where = adminDeliveryListWhere({ partnerId: '  partner-volos-1  ' })
        expect(where).toEqual({ partnerId: 'partner-volos-1' })
      })

      test('empty string partnerId means no filter', () => {
        const where = adminDeliveryListWhere({ partnerId: '' })
        expect(where).toEqual({})
        expect('partnerId' in where).toBe(false)
      })

      test('whitespace-only partnerId means no filter', () => {
        const where = adminDeliveryListWhere({ partnerId: '   ' })
        expect(where).toEqual({})
        expect('partnerId' in where).toBe(false)
      })

      test('undefined partnerId means no filter', () => {
        const where = adminDeliveryListWhere({ partnerId: undefined })
        expect(where).toEqual({})
        expect('partnerId' in where).toBe(false)
      })
    })

    describe('state filter (decision 96.1)', () => {
      test('state active = status notIn [DROPPED_OFF, CANCELED, FAILED]', () => {
        const where = adminDeliveryListWhere({ state: 'active' })
        expect(where).toEqual({
          status: {
            notIn: [
              EnumDeliveryStatus.DROPPED_OFF,
              EnumDeliveryStatus.CANCELED,
              EnumDeliveryStatus.FAILED,
            ],
          },
        })
        // Explicitly check that DROPPED_OFF is excluded so active deliveries include only in-flight/waiting
        expect((where.status as any).notIn).toContain(EnumDeliveryStatus.DROPPED_OFF)
        expect((where.status as any).notIn).toContain(EnumDeliveryStatus.CANCELED)
        expect((where.status as any).notIn).toContain(EnumDeliveryStatus.FAILED)
      })

      test('state dropped_off = status DROPPED_OFF', () => {
        const where = adminDeliveryListWhere({ state: 'dropped_off' })
        expect(where).toEqual({
          status: EnumDeliveryStatus.DROPPED_OFF,
        })
      })

      test('state canceled = status in [CANCELED, FAILED]', () => {
        const where = adminDeliveryListWhere({ state: 'canceled' })
        expect(where).toEqual({
          status: {
            in: [EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.FAILED],
          },
        })
      })

      test('state all = no status rule in where', () => {
        const where = adminDeliveryListWhere({ state: 'all' })
        expect(where.status).toBeUndefined()
        expect(where).toEqual({})
      })
    })

    describe('search filter (decision 96.1, spec 0025 AC-1)', () => {
      test('a search is one OR: searchFold contains the folded text, or the id ends with it; no mode', () => {
        const where = adminDeliveryListWhere({ search: 'Nikou' })
        expect(where).toEqual({ OR: expect.any(Array) })
        expectSearchRule(where, 'nikou')
      })

      test('the old per column, insensitive rules are gone', () => {
        const where = adminDeliveryListWhere({ search: 'Nikou' })
        const text = JSON.stringify(where)
        expect(text).not.toContain('orderReference')
        expect(text).not.toContain('dropoffName')
        expect(text).not.toContain('pickupBusinessName')
        expect(text).not.toContain('insensitive')
      })

      test.each([['νικος'], ['ΝΙΚΟΣ'], ['Νίκος'], ['νίκοσ']])(
        'Greek "%s" is searched as "νικοσ" (case, accents, final sigma)',
        (search) => {
          expectSearchRule(adminDeliveryListWhere({ search }), 'νικοσ')
        }
      )

      test.each([['νικος'], ['ΝΙΚΟΣ'], ['Νίκος'], ['νίκοσ']])(
        '"%s" finds the delivery for Νίκος Παπαδόπουλος and no other',
        (search) => {
          expect(finds(search, NIKOS)).toBe(true)
          expect(finds(search, CAFE)).toBe(false)
          expect(finds(search, PLAIN)).toBe(false)
        }
      )

      test('a whole name in capitals and without accents finds the customer', () => {
        expect(finds('ΝΙΚΟΣ ΠΑΠΑΔΟΠΟΥΛΟΣ', NIKOS)).toBe(true)
        expect(finds('νικος παπαδοπουλος', NIKOS)).toBe(true)
      })

      test('the restaurant name and the order reference are found folded too', () => {
        expect(finds('Θανάσης', NIKOS)).toBe(true)
        expect(finds('ΨΗΤΟΠΩΛΕΙΟ', NIKOS)).toBe(true)
        expect(finds('ORD-1042', NIKOS)).toBe(true)
        expect(finds('ord-1042', NIKOS)).toBe(true)
      })

      test('Latin accents and case fold: "Café" and "CAFE" find "cafe" (AC-3)', () => {
        expectSearchRule(adminDeliveryListWhere({ search: 'Café' }), 'cafe')
        expect(finds('Café', CAFE)).toBe(true)
        expect(finds('CAFE', CAFE)).toBe(true)
        expect(finds('Café', PLAIN)).toBe(false)
      })

      test('a decomposed accent (ι + U+0301) is searched like the composed ί', () => {
        expectSearchRule(adminDeliveryListWhere({ search: 'Νίκος' }), 'νικοσ')
      })

      test('the short id match uses the folded text: an id typed in capitals is found', () => {
        expectSearchRule(adminDeliveryListWhere({ search: 'ABC123DEF' }), 'abc123def')
        expect(finds('ABC123DEF', NIKOS)).toBe(true)
        expect(finds('abc123def', NIKOS)).toBe(true)
        expect(finds('ABC123DEF', PLAIN)).toBe(false)
      })

      test('the short id match is an endsWith, not a contains', () => {
        expect(finds('clx7k2m9p0001', NIKOS)).toBe(false)
      })

      test('search trims leading and trailing whitespace', () => {
        expectSearchRule(adminDeliveryListWhere({ search: '   ORD-9988   ' }), 'ord-9988')
      })

      test('a newline or tab inside the search becomes one space', () => {
        expectSearchRule(adminDeliveryListWhere({ search: 'Νίκος\nΠαπαδόπουλος' }), 'νικοσ παπαδοπουλοσ')
        expectSearchRule(adminDeliveryListWhere({ search: 'Νίκος\t\tΠαπαδόπουλος' }), 'νικοσ παπαδοπουλοσ')
      })

      test('a search cannot match across two stored fields, even if it holds a newline', () => {
        // The stored fields are joined by "\n"; a search keeping its newline would bridge them.
        expect(finds('Παπαδόπουλος\nΨητοπωλείο', NIKOS)).toBe(false)
        expect(finds('1042\nνικος', NIKOS)).toBe(false)
      })

      test('ignores empty search string', () => {
        const where = adminDeliveryListWhere({ search: '' })
        expect(where.OR).toBeUndefined()
        expect(where).toEqual({})
      })

      test('ignores spaces-only search string', () => {
        const where = adminDeliveryListWhere({ search: '     ' })
        expect(where.OR).toBeUndefined()
        expect(where).toEqual({})
      })

      test('ignores a whitespace-only search of tabs and newlines', () => {
        const where = adminDeliveryListWhere({ search: ' \t\n\r\n ' })
        expect(where).toEqual({})
      })

      test('ignores undefined search', () => {
        const where = adminDeliveryListWhere({ search: undefined })
        expect(where.OR).toBeUndefined()
        expect(where).toEqual({})
      })

      describe('LIKE wildcard escaping in search (row 96 review fix, spec 0025 AC-4)', () => {
        test('escapes % in both the searchFold contains and the id endsWith', () => {
          expectSearchRule(adminDeliveryListWhere({ search: '%' }), '\\%')
        })

        test('escapes _ in both rules', () => {
          expectSearchRule(adminDeliveryListWhere({ search: '_' }), '\\_')
        })

        test('escapes backslash in both rules', () => {
          expectSearchRule(adminDeliveryListWhere({ search: '\\' }), '\\\\')
        })

        test('escapes repeated wildcards (such as eight underscores)', () => {
          expectSearchRule(adminDeliveryListWhere({ search: '________' }), '\\_\\_\\_\\_\\_\\_\\_\\_')
        })

        test('escapes mixed wildcards and backslashes embedded in text, after folding', () => {
          expectSearchRule(adminDeliveryListWhere({ search: 'ORD_1042%\\extra' }), 'ord\\_1042\\%\\\\extra')
        })

        test('leaves plain text unescaped (only folded)', () => {
          expectSearchRule(adminDeliveryListWhere({ search: 'ORD-1042' }), 'ord-1042')
        })

        test('"%" stays literal: it finds a delivery holding a %, not every delivery', () => {
          expect(finds('%', CAFE)).toBe(true)
          expect(finds('%', NIKOS)).toBe(false)
          expect(finds('%', PLAIN)).toBe(false)
        })

        test('"_" stays literal: it does not match any one character', () => {
          expect(finds('ord_7', PLAIN)).toBe(false)
          expect(finds('_', NIKOS)).toBe(false)
        })
      })
    })

    describe('combining courier, state, and search', () => {
      test('combines courierId, state active, and search', () => {
        const where = adminDeliveryListWhere({
          courierId: 'courier-42',
          state: 'active',
          search: 'souvlaki',
        })

        expect(where).toEqual({
          courierId: 'courier-42',
          status: {
            notIn: [
              EnumDeliveryStatus.DROPPED_OFF,
              EnumDeliveryStatus.CANCELED,
              EnumDeliveryStatus.FAILED,
            ],
          },
          OR: expect.any(Array),
        })
        expectSearchRule(where, 'souvlaki')
      })

      test('combines courierId and state dropped_off without search', () => {
        const where = adminDeliveryListWhere({
          courierId: 'courier-42',
          state: 'dropped_off',
        })
        expect(where).toEqual({
          courierId: 'courier-42',
          status: EnumDeliveryStatus.DROPPED_OFF,
        })
      })

      test('combines state canceled and search without courierId', () => {
        const where = adminDeliveryListWhere({
          state: 'canceled',
          search: 'cancellation-ref',
        })
        expect(where.courierId).toBeUndefined()
        expect(where.status).toEqual({
          in: [EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.FAILED],
        })
        expectSearchRule(where, 'cancellation-ref')
      })

      test('combines courierId and search with state all (no status in where)', () => {
        const where = adminDeliveryListWhere({
          courierId: 'courier-42',
          state: 'all',
          search: 'customer-name',
        })
        expect(where.courierId).toBe('courier-42')
        expect(where.status).toBeUndefined()
        expectSearchRule(where, 'customer-name')
      })

      test('combines empty string courierId with state active and search', () => {
        const where = adminDeliveryListWhere({
          courierId: '',
          state: 'active',
          search: 'souvlaki',
        })
        expect(where.courierId).toBe('')
        expect(where.status).toEqual({
          notIn: [
            EnumDeliveryStatus.DROPPED_OFF,
            EnumDeliveryStatus.CANCELED,
            EnumDeliveryStatus.FAILED,
          ],
        })
        expectSearchRule(where, 'souvlaki')
      })

      test('combines partnerId with courierId, state active, and search', () => {
        const where = adminDeliveryListWhere({
          partnerId: 'partner-1',
          courierId: 'courier-42',
          state: 'active',
          search: 'Σουβλάκι',
        })

        expect(where).toEqual({
          partnerId: 'partner-1',
          courierId: 'courier-42',
          status: {
            notIn: [
              EnumDeliveryStatus.DROPPED_OFF,
              EnumDeliveryStatus.CANCELED,
              EnumDeliveryStatus.FAILED,
            ],
          },
          OR: expect.any(Array),
        })
        expectSearchRule(where, 'σουβλακι')
      })

      test('combines partnerId with state dropped_off without courier or search', () => {
        const where = adminDeliveryListWhere({
          partnerId: 'partner-1',
          state: 'dropped_off',
        })
        expect(where).toEqual({
          partnerId: 'partner-1',
          status: EnumDeliveryStatus.DROPPED_OFF,
        })
      })

      test('empty/whitespace partnerId does not interfere when combined with other filters', () => {
        const where = adminDeliveryListWhere({
          partnerId: '   ',
          courierId: 'courier-42',
          state: 'active',
        })
        expect(where).toEqual({
          courierId: 'courier-42',
          status: {
            notIn: [
              EnumDeliveryStatus.DROPPED_OFF,
              EnumDeliveryStatus.CANCELED,
              EnumDeliveryStatus.FAILED,
            ],
          },
        })
        expect('partnerId' in where).toBe(false)
      })
    })
  })
})
