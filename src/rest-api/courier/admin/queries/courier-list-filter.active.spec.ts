import { EnumCourierStatus } from '@prisma/types'
import {
  adminCourierListWhere,
  ADMIN_COURIER_STATUSES,
  MAX_COURIER_SEARCH_LENGTH,
} from './courier-list-filter'

// The couriers search (spec 0025, AC-2): the database keeps `searchFold`, the folded first name,
// last name and phone, plus the phone's digits, joined by newlines. Every typed word must match
// it (one AND item per word). A word that is a phone typed with separators also matches by its
// digits, as an OR beside the plain word.

// The rule for an ordinary word: searchFold contains the folded, escaped word, with no mode.
function textRule(literal: string) {
  return { searchFold: { contains: literal } }
}

// The rule for a phone word: the plain word OR its digits (the order inside the OR is free).
function expectPhoneRule(clause: any, literal: string, digits: string) {
  expect(Object.keys(clause)).toEqual(['OR'])
  expect(clause.OR).toHaveLength(2)
  expect(clause.OR).toEqual(
    expect.arrayContaining([textRule(literal), { searchFold: { contains: digits } }])
  )
}

// What PostgreSQL's LIKE does with a Prisma `contains` (pattern %text%): backslash escapes the
// next character, % is any run of characters, _ is any one character.
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

// A tiny stand in for the database: does a rider's stored searchFold match the search part of a
// where? Only the shapes the search may use are understood; anything else (a `mode`, the old
// firstName/lastName/phoneNumber columns) throws.
function rowMatches(where: any, searchFold: string): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return (value as any[]).some((clause) => rowMatches(clause, searchFold))
    if (key === 'AND') return (value as any[]).every((clause) => rowMatches(clause, searchFold))
    if (key !== 'searchFold') throw new Error(`unexpected field ${key}`)
    if (Object.keys(value).join() !== 'contains') throw new Error(`unexpected filter ${JSON.stringify(value)}`)
    return likeMatches(searchFold, `%${value.contains}%`)
  })
}
function finds(search: string, searchFold: string): boolean {
  return rowMatches(adminCourierListWhere({ search }), searchFold)
}

// Riders as the database trigger stores them: oc_search_fold(firstName) \n oc_search_fold(lastName)
// \n oc_search_fold(phoneNumber) \n oc_search_digits(phoneNumber). Written by hand from the spec's
// rule. The phone is stored in E.164 form.
const GIORGOS = 'γιωργοσ\nπαπαδοπουλοσ\n+302421010009\n302421010009'
const NIKOS = 'νικοσ\nσωτηριου\n+306900000001\n306900000001'
const CHRISTINA = 'christina\nalexiou\n+302421010003\n302421010003'

describe('courier-list-filter (scope row 97, decision 97.1)', () => {
  describe('ADMIN_COURIER_STATUSES and MAX_COURIER_SEARCH_LENGTH', () => {
    test('ADMIN_COURIER_STATUSES contains exactly all, working, and offline', () => {
      expect(ADMIN_COURIER_STATUSES).toEqual(['all', 'working', 'offline'])
    })

    test('MAX_COURIER_SEARCH_LENGTH is 100 characters', () => {
      expect(MAX_COURIER_SEARCH_LENGTH).toBe(100)
    })
  })

  describe('adminCourierListWhere', () => {
    test('no filter gives empty where object {}', () => {
      expect(adminCourierListWhere({})).toEqual({})
      expect(
        adminCourierListWhere({
          status: undefined,
          search: undefined,
        })
      ).toEqual({})
    })

    describe('Clause 1: status filter ("each tab lists only its riders")', () => {
      test('status working = ONLINE or LAST_CALL (decision 97.1)', () => {
        const where = adminCourierListWhere({ status: 'working' })
        expect(where).toEqual({
          status: {
            in: [EnumCourierStatus.ONLINE, EnumCourierStatus.LAST_CALL],
          },
        })

        // Explicitly assert that BOTH ONLINE and LAST_CALL are present
        const inStatuses = (where.status as any).in as EnumCourierStatus[]
        expect(inStatuses).toBeDefined()
        expect(inStatuses).toHaveLength(2)
        expect(inStatuses).toContain(EnumCourierStatus.ONLINE)
        expect(inStatuses).toContain(EnumCourierStatus.LAST_CALL)
      })

      test('status offline = OFFLINE', () => {
        const where = adminCourierListWhere({ status: 'offline' })
        expect(where).toEqual({
          status: EnumCourierStatus.OFFLINE,
        })
      })

      test('status all = no status rule in where', () => {
        const where = adminCourierListWhere({ status: 'all' })
        expect(where.status).toBeUndefined()
        expect(where).toEqual({})
      })

      test('unrecognized or undefined status adds no status rule', () => {
        const whereEmpty = adminCourierListWhere({})
        expect(whereEmpty.status).toBeUndefined()

        const whereUnknown = adminCourierListWhere({ status: 'unknown' as any })
        expect(whereUnknown.status).toBeUndefined()
        expect(whereUnknown).toEqual({})
      })
    })

    describe('Clause 2: search filter ("finds a rider by name or phone", spec 0025 AC-2)', () => {
      test('a single name word is one AND item: searchFold contains the folded word, no mode', () => {
        const where = adminCourierListWhere({ search: 'Giorgos' })
        expect(where).toEqual({ AND: [textRule('giorgos')] })
        expect(JSON.stringify(where)).not.toContain('"mode"')
      })

      test('the old per column, insensitive rules are gone', () => {
        const text = JSON.stringify(adminCourierListWhere({ search: 'Giorgos 6900' }))
        expect(text).not.toContain('firstName')
        expect(text).not.toContain('lastName')
        expect(text).not.toContain('phoneNumber')
        expect(text).not.toContain('insensitive')
      })

      test('multi-word search requires EVERY word to match: one AND item per word', () => {
        const where = adminCourierListWhere({ search: 'Giorgos Pap' })
        expect(where).toEqual({ AND: [textRule('giorgos'), textRule('pap')] })
        // AND at the top level, so first Giorgos + last Papadopoulos matches
        expect(where).not.toHaveProperty('OR')
      })

      test.each([['γιωργος'], ['ΓΙΩΡΓΟΣ'], ['Γιώργος'], ['γιώργοσ']])(
        'Greek "%s" is searched as "γιωργοσ" (case, accents, final sigma)',
        (search) => {
          expect(adminCourierListWhere({ search })).toEqual({ AND: [textRule('γιωργοσ')] })
        }
      )

      test.each([['γιωργος'], ['ΓΙΩΡΓΟΣ'], ['Γιώργος'], ['γιώργοσ']])(
        '"%s" finds rider Γιώργος and no other',
        (search) => {
          expect(finds(search, GIORGOS)).toBe(true)
          expect(finds(search, NIKOS)).toBe(false)
          expect(finds(search, CHRISTINA)).toBe(false)
        }
      )

      test('a first name and part of the last name, folded, find the rider (decision 97.1)', () => {
        expect(finds('Γιώργος Παπ', GIORGOS)).toBe(true)
        expect(finds('ΓΙΩΡΓΟΣ ΠΑΠΑΔΟΠΟΥΛΟΣ', GIORGOS)).toBe(true)
        expect(finds('Γιώργος Σωτηρίου', GIORGOS)).toBe(false)
        expect(finds('Νίκος Σωτηρίου', NIKOS)).toBe(true)
      })

      test('Latin accents and case fold (AC-3)', () => {
        expect(adminCourierListWhere({ search: 'Christína' })).toEqual({ AND: [textRule('christina')] })
        expect(finds('CHRISTÍNA', CHRISTINA)).toBe(true)
      })

      describe('phone words (AC-2)', () => {
        test('"24210-10009" is the word OR its digits', () => {
          const where = adminCourierListWhere({ search: '24210-10009' })
          expect(Object.keys(where)).toEqual(['AND'])
          const andClauses = where.AND as any[]
          expect(andClauses).toHaveLength(1)
          expectPhoneRule(andClauses[0], '24210-10009', '2421010009')
        })

        test('"24210-10009" and "2421010009" find a rider stored as +302421010009', () => {
          expect(finds('24210-10009', GIORGOS)).toBe(true)
          expect(finds('2421010009', GIORGOS)).toBe(true)
          expect(finds('24210-10009', CHRISTINA)).toBe(false)
          expect(finds('24210-10009', NIKOS)).toBe(false)
        })

        test('dots, slashes, parentheses and the plus are separators too', () => {
          expect(finds('24210.10009', GIORGOS)).toBe(true)
          expect(finds('24210/10009', GIORGOS)).toBe(true)
          expect(finds('(24210)10009', GIORGOS)).toBe(true)
          expect(finds('+30-24210-10009', GIORGOS)).toBe(true)
          expect(finds('24210.10009', CHRISTINA)).toBe(false)
        })

        test('"24210 10009" and "(24210) 10009" are two phone words, both found in the phone', () => {
          expect(finds('24210 10009', GIORGOS)).toBe(true)
          expect(finds('(24210) 10009', GIORGOS)).toBe(true)
          const where = adminCourierListWhere({ search: '(24210) 10009' })
          const andClauses = where.AND as any[]
          expect(andClauses).toHaveLength(2)
          expectPhoneRule(andClauses[0], '(24210)', '24210')
        })

        test('a run of digits still finds the rider by phone', () => {
          expect(finds('010003', CHRISTINA)).toBe(true)
          expect(finds('010003', GIORGOS)).toBe(false)
        })

        test('a phone word with separators combined with a name word', () => {
          const where = adminCourierListWhere({ search: 'Γιώργος 24210-10009' })
          const andClauses = where.AND as any[]
          expect(andClauses).toHaveLength(2)
          expect(andClauses[0]).toEqual(textRule('γιωργοσ'))
          expectPhoneRule(andClauses[1], '24210-10009', '2421010009')
          expect(finds('Γιώργος 24210-10009', GIORGOS)).toBe(true)
          expect(finds('Νίκος 24210-10009', GIORGOS)).toBe(false)
        })

        test('a word mixing letters and digits gets no digits rule', () => {
          expect(adminCourierListWhere({ search: 'pap1' })).toEqual({ AND: [textRule('pap1')] })
          expect(adminCourierListWhere({ search: 'A-1' })).toEqual({ AND: [textRule('a-1')] })
        })

        test('separators with no digit get no digits rule', () => {
          expect(adminCourierListWhere({ search: '--' })).toEqual({ AND: [textRule('--')] })
        })
      })

      test('trims leading, trailing, and multiple consecutive whitespace characters', () => {
        const where = adminCourierListWhere({ search: '   Nikos    Papastamou   ' })
        expect(where).toEqual({ AND: [textRule('nikos'), textRule('papastamou')] })
      })

      test('splits correctly on tabs and newlines', () => {
        const where = adminCourierListWhere({ search: '\tGiorgos\n  Pap\r\n' })
        expect(where).toEqual({ AND: [textRule('giorgos'), textRule('pap')] })
      })

      test('a tab or newline between a name and a phone splits them into two words', () => {
        const where = adminCourierListWhere({ search: 'Giorgos\t6900' })
        const andClauses = where.AND as any[]
        expect(andClauses).toHaveLength(2)
        expect(andClauses[0]).toEqual(textRule('giorgos'))
        expectPhoneRule(andClauses[1], '6900', '6900')
      })

      test('ignores empty search string', () => {
        const where = adminCourierListWhere({ search: '' })
        expect(where.AND).toBeUndefined()
        expect(where).toEqual({})
      })

      test('ignores spaces-only search string', () => {
        const where = adminCourierListWhere({ search: '     ' })
        expect(where.AND).toBeUndefined()
        expect(where).toEqual({})
      })

      test('ignores a whitespace-only search of tabs and newlines', () => {
        expect(adminCourierListWhere({ search: ' \t\n\r\n ' })).toEqual({})
      })

      test('ignores undefined search', () => {
        const where = adminCourierListWhere({ search: undefined })
        expect(where.AND).toBeUndefined()
        expect(where).toEqual({})
      })

      describe('LIKE wildcard escaping in search (decision 97.1, spec 0025 AC-4)', () => {
        test('escapes % wildcard', () => {
          expect(adminCourierListWhere({ search: '%' })).toEqual({ AND: [textRule('\\%')] })
        })

        test('escapes _ wildcard', () => {
          expect(adminCourierListWhere({ search: '_' })).toEqual({ AND: [textRule('\\_')] })
        })

        test('escapes backslash', () => {
          expect(adminCourierListWhere({ search: '\\' })).toEqual({ AND: [textRule('\\\\')] })
        })

        test('escapes repeated wildcards', () => {
          expect(adminCourierListWhere({ search: '____' })).toEqual({ AND: [textRule('\\_\\_\\_\\_')] })
        })

        test('escapes mixed wildcards and text across multiple words, after folding', () => {
          const where = adminCourierListWhere({ search: 'Giorgos% Pap_1\\extra' })
          expect(where).toEqual({ AND: [textRule('giorgos\\%'), textRule('pap\\_1\\\\extra')] })
        })

        test('leaves plain text unescaped (only folded)', () => {
          expect(adminCourierListWhere({ search: 'Giorgos' })).toEqual({ AND: [textRule('giorgos')] })
        })

        test('"%" stays literal: it finds no rider without a % (not every rider)', () => {
          expect(finds('%', GIORGOS)).toBe(false)
          expect(finds('%', 'per%cent\nx\n\n')).toBe(true)
        })

        test('"_" stays literal: it does not match any one character', () => {
          expect(finds('γιωργο_', GIORGOS)).toBe(false)
        })
      })
    })

    describe('combining status and search', () => {
      test('combines status working and search', () => {
        const where = adminCourierListWhere({
          status: 'working',
          search: 'Giorgos Pap',
        })

        expect(where).toEqual({
          status: {
            in: [EnumCourierStatus.ONLINE, EnumCourierStatus.LAST_CALL],
          },
          AND: [textRule('giorgos'), textRule('pap')],
        })
      })

      test('combines status offline and a phone search', () => {
        const where = adminCourierListWhere({
          status: 'offline',
          search: '24210-10003',
        })

        expect(where.status).toBe(EnumCourierStatus.OFFLINE)
        const andClauses = where.AND as any[]
        expect(andClauses).toHaveLength(1)
        expectPhoneRule(andClauses[0], '24210-10003', '2421010003')
      })

      test('status all with search has search rules and no status rule', () => {
        const where = adminCourierListWhere({
          status: 'all',
          search: 'Νίκος',
        })

        expect(where.status).toBeUndefined()
        expect(where).toEqual({ AND: [textRule('νικοσ')] })
      })
    })
  })
})
