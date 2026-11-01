import { EnumCourierStatus, Prisma } from '@prisma/types'
import {
  adminCourierListWhere,
  ADMIN_COURIER_STATUSES,
  MAX_COURIER_SEARCH_LENGTH,
} from './courier-list-filter'

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

    describe('Clause 2: search filter ("finds a rider by name or phone")', () => {
      test('single word search matches firstName, lastName, or phoneNumber (case-insensitive contains)', () => {
        const where = adminCourierListWhere({ search: 'Giorgos' })
        expect(where).toEqual({
          AND: [
            {
              OR: [
                { firstName: { contains: 'Giorgos', mode: Prisma.QueryMode.insensitive } },
                { lastName: { contains: 'Giorgos', mode: Prisma.QueryMode.insensitive } },
                { phoneNumber: { contains: 'Giorgos', mode: Prisma.QueryMode.insensitive } },
              ],
            },
          ],
        })

        // Assert mode: 'insensitive' explicitly
        const andClauses = where.AND as any[]
        expect(andClauses).toHaveLength(1)
        const orList = andClauses[0].OR
        expect(orList).toHaveLength(3)
        expect(orList[0].firstName.mode).toBe('insensitive')
        expect(orList[1].lastName.mode).toBe('insensitive')
        expect(orList[2].phoneNumber.mode).toBe('insensitive')
      })

      test('multi-word search splits on whitespace and requires EVERY word to match via AND of ORs', () => {
        const where = adminCourierListWhere({ search: 'Giorgos Pap' })

        // Must produce AND array with an entry for each word
        expect(where.AND).toBeDefined()
        const andClauses = where.AND as any[]
        expect(andClauses).toHaveLength(2)

        // Word 1: 'Giorgos'
        expect(andClauses[0]).toEqual({
          OR: [
            { firstName: { contains: 'Giorgos', mode: Prisma.QueryMode.insensitive } },
            { lastName: { contains: 'Giorgos', mode: Prisma.QueryMode.insensitive } },
            { phoneNumber: { contains: 'Giorgos', mode: Prisma.QueryMode.insensitive } },
          ],
        })

        // Word 2: 'Pap'
        expect(andClauses[1]).toEqual({
          OR: [
            { firstName: { contains: 'Pap', mode: Prisma.QueryMode.insensitive } },
            { lastName: { contains: 'Pap', mode: Prisma.QueryMode.insensitive } },
            { phoneNumber: { contains: 'Pap', mode: Prisma.QueryMode.insensitive } },
          ],
        })

        // Confirms it uses AND at top level so first Giorgos + last Papadopoulos matches
        expect(where).not.toHaveProperty('OR')
        expect(where).toHaveProperty('AND')
      })

      test('phone number search matches firstName, lastName, or phoneNumber', () => {
        const where = adminCourierListWhere({ search: '010003' })
        expect(where).toEqual({
          AND: [
            {
              OR: [
                { firstName: { contains: '010003', mode: Prisma.QueryMode.insensitive } },
                { lastName: { contains: '010003', mode: Prisma.QueryMode.insensitive } },
                { phoneNumber: { contains: '010003', mode: Prisma.QueryMode.insensitive } },
              ],
            },
          ],
        })
      })

      test('trims leading, trailing, and multiple consecutive whitespace characters', () => {
        const where = adminCourierListWhere({ search: '   Nikos    Papastamou   ' })
        const andClauses = where.AND as any[]
        expect(andClauses).toHaveLength(2)
        expect(andClauses[0].OR[0].firstName.contains).toBe('Nikos')
        expect(andClauses[1].OR[0].firstName.contains).toBe('Papastamou')
      })

      test('splits correctly on tabs and newlines', () => {
        const where = adminCourierListWhere({ search: '\tGiorgos\n  6900\r\n' })
        const andClauses = where.AND as any[]
        expect(andClauses).toHaveLength(2)
        expect(andClauses[0].OR[0].firstName.contains).toBe('Giorgos')
        expect(andClauses[1].OR[2].phoneNumber.contains).toBe('6900')
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

      test('ignores undefined search', () => {
        const where = adminCourierListWhere({ search: undefined })
        expect(where.AND).toBeUndefined()
        expect(where).toEqual({})
      })

      describe('LIKE wildcard escaping in search (decision 97.1)', () => {
        test('escapes % wildcard in all contains clauses', () => {
          const where = adminCourierListWhere({ search: '%' })
          expect(where).toEqual({
            AND: [
              {
                OR: [
                  { firstName: { contains: '\\%', mode: Prisma.QueryMode.insensitive } },
                  { lastName: { contains: '\\%', mode: Prisma.QueryMode.insensitive } },
                  { phoneNumber: { contains: '\\%', mode: Prisma.QueryMode.insensitive } },
                ],
              },
            ],
          })
        })

        test('escapes _ wildcard in all contains clauses', () => {
          const where = adminCourierListWhere({ search: '_' })
          expect(where).toEqual({
            AND: [
              {
                OR: [
                  { firstName: { contains: '\\_', mode: Prisma.QueryMode.insensitive } },
                  { lastName: { contains: '\\_', mode: Prisma.QueryMode.insensitive } },
                  { phoneNumber: { contains: '\\_', mode: Prisma.QueryMode.insensitive } },
                ],
              },
            ],
          })
        })

        test('escapes backslash in all contains clauses', () => {
          const where = adminCourierListWhere({ search: '\\' })
          expect(where).toEqual({
            AND: [
              {
                OR: [
                  { firstName: { contains: '\\\\', mode: Prisma.QueryMode.insensitive } },
                  { lastName: { contains: '\\\\', mode: Prisma.QueryMode.insensitive } },
                  { phoneNumber: { contains: '\\\\', mode: Prisma.QueryMode.insensitive } },
                ],
              },
            ],
          })
        })

        test('escapes repeated wildcards and backslashes', () => {
          const where = adminCourierListWhere({ search: '____' })
          const expected = '\\_\\_\\_\\_'
          expect(where).toEqual({
            AND: [
              {
                OR: [
                  { firstName: { contains: expected, mode: Prisma.QueryMode.insensitive } },
                  { lastName: { contains: expected, mode: Prisma.QueryMode.insensitive } },
                  { phoneNumber: { contains: expected, mode: Prisma.QueryMode.insensitive } },
                ],
              },
            ],
          })
        })

        test('escapes mixed wildcards and text across multiple words', () => {
          const where = adminCourierListWhere({ search: 'Giorgos% Pap_1\\extra' })
          const andClauses = where.AND as any[]
          expect(andClauses).toHaveLength(2)

          const word1Expected = 'Giorgos\\%'
          expect(andClauses[0].OR[0].firstName.contains).toBe(word1Expected)
          expect(andClauses[0].OR[1].lastName.contains).toBe(word1Expected)
          expect(andClauses[0].OR[2].phoneNumber.contains).toBe(word1Expected)

          const word2Expected = 'Pap\\_1\\\\extra'
          expect(andClauses[1].OR[0].firstName.contains).toBe(word2Expected)
          expect(andClauses[1].OR[1].lastName.contains).toBe(word2Expected)
          expect(andClauses[1].OR[2].phoneNumber.contains).toBe(word2Expected)
        })

        test('leaves plain text unchanged without escaping', () => {
          const where = adminCourierListWhere({ search: 'Giorgos' })
          const andClauses = where.AND as any[]
          expect(andClauses[0].OR[0].firstName.contains).toBe('Giorgos')
          expect(andClauses[0].OR[1].lastName.contains).toBe('Giorgos')
          expect(andClauses[0].OR[2].phoneNumber.contains).toBe('Giorgos')
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
          AND: [
            {
              OR: [
                { firstName: { contains: 'Giorgos', mode: Prisma.QueryMode.insensitive } },
                { lastName: { contains: 'Giorgos', mode: Prisma.QueryMode.insensitive } },
                { phoneNumber: { contains: 'Giorgos', mode: Prisma.QueryMode.insensitive } },
              ],
            },
            {
              OR: [
                { firstName: { contains: 'Pap', mode: Prisma.QueryMode.insensitive } },
                { lastName: { contains: 'Pap', mode: Prisma.QueryMode.insensitive } },
                { phoneNumber: { contains: 'Pap', mode: Prisma.QueryMode.insensitive } },
              ],
            },
          ],
        })
      })

      test('combines status offline and search', () => {
        const where = adminCourierListWhere({
          status: 'offline',
          search: '010003',
        })

        expect(where).toEqual({
          status: EnumCourierStatus.OFFLINE,
          AND: [
            {
              OR: [
                { firstName: { contains: '010003', mode: Prisma.QueryMode.insensitive } },
                { lastName: { contains: '010003', mode: Prisma.QueryMode.insensitive } },
                { phoneNumber: { contains: '010003', mode: Prisma.QueryMode.insensitive } },
              ],
            },
          ],
        })
      })

      test('status all with search has search rules and no status rule', () => {
        const where = adminCourierListWhere({
          status: 'all',
          search: 'Nikos',
        })

        expect(where.status).toBeUndefined()
        expect(where.AND).toBeDefined()
        expect(where).toEqual({
          AND: [
            {
              OR: [
                { firstName: { contains: 'Nikos', mode: Prisma.QueryMode.insensitive } },
                { lastName: { contains: 'Nikos', mode: Prisma.QueryMode.insensitive } },
                { phoneNumber: { contains: 'Nikos', mode: Prisma.QueryMode.insensitive } },
              ],
            },
          ],
        })
      })
    })
  })
})
