import { PrismaService } from 'src/services/prisma/prisma.service'
import { Prisma } from '@prisma/types'
import { PartnerRepository } from './partner.repository'

describe('PartnerRepository.findPickupPoints (Spec 0018 AC-4)', () => {
  let repository: PartnerRepository
  let mockPrisma: any

  beforeEach(() => {
    mockPrisma = {
      partner: {
        findMany: jest.fn(),
      },
    }

    repository = new PartnerRepository(mockPrisma as unknown as PrismaService)
  })

  test('asks Prisma for partners whose pickupLocationId is not null, ordered by name asc, selecting id, name and location lat/lng', async () => {
    mockPrisma.partner.findMany.mockResolvedValueOnce([
      {
        id: 'partner-1',
        name: 'Alpha Pizza',
        pickupLocation: { latitude: 39.362, longitude: 22.942 },
      },
      {
        id: 'partner-2',
        name: 'Beta Burgers',
        pickupLocation: { latitude: 39.365, longitude: 22.945 },
      },
    ])

    const result = await repository.findPickupPoints()

    expect(mockPrisma.partner.findMany).toHaveBeenCalledWith({
      where: { pickupLocationId: { not: null } },
      select: {
        id: true,
        name: true,
        pickupLocation: { select: { latitude: true, longitude: true } },
      },
      orderBy: { name: 'asc' },
    })

    expect(result).toEqual([
      { id: 'partner-1', name: 'Alpha Pizza', latitude: 39.362, longitude: 22.942 },
      { id: 'partner-2', name: 'Beta Burgers', latitude: 39.365, longitude: 22.945 },
    ])
  })

  test('filters out partners whose pickupLocation resolves to null or missing', async () => {
    mockPrisma.partner.findMany.mockResolvedValueOnce([
      {
        id: 'partner-1',
        name: 'Alpha Pizza',
        pickupLocation: { latitude: 39.362, longitude: 22.942 },
      },
      {
        id: 'partner-orphan',
        name: 'Ghost Kitchen',
        pickupLocation: null,
      },
      {
        id: 'partner-2',
        name: 'Beta Burgers',
        pickupLocation: { latitude: 39.365, longitude: 22.945 },
      },
    ])

    const result = await repository.findPickupPoints()

    expect(result).toEqual([
      { id: 'partner-1', name: 'Alpha Pizza', latitude: 39.362, longitude: 22.942 },
      { id: 'partner-2', name: 'Beta Burgers', latitude: 39.365, longitude: 22.945 },
    ])
    expect(result.some((p) => p.id === 'partner-orphan')).toBe(false)
  })
})

// Row 106 (decision 106.1): the admin restaurants list search. One raw query finds the ids of the
// restaurants whose folded name, pickup address or sign in email holds every typed word, and the
// usual Prisma page is filtered by those ids. The SQL is tested as text: no test here runs SQL.
describe('PartnerRepository.findManyPaginated search (scope row 106)', () => {
  let repository: PartnerRepository
  let mockPrisma: { partner: { findMany: jest.Mock; count: jest.Mock }; $queryRaw: jest.Mock }

  // The exact list of fields the search folds, in order, as decision 106.1 names them.
  const SEARCHED_FIELDS = [
    'p."name"',
    'l."formattedAddress"',
    'l."addressLine1"',
    'l."street"',
    'l."houseNumber"',
    'l."city"',
    'u."email"',
  ]

  // The repository calls $queryRaw as a tagged template, so the mock receives the template strings
  // and then each interpolated value. Prisma.sql rebuilds the same query: `.text` is the PostgreSQL text sent to
  // the database (values as $1, $2…), `.values` the parameters sent beside it.
  const sentQuery = (): Prisma.Sql => {
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
    const [strings, ...values] = mockPrisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    return Prisma.sql(strings, ...values)
  }
  const oneLine = (sql: string) => sql.replace(/\s+/g, ' ')
  const findManyArgs = () => mockPrisma.partner.findMany.mock.calls[0]?.[0]

  beforeEach(() => {
    mockPrisma = {
      partner: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    }
    repository = new PartnerRepository(mockPrisma as unknown as PrismaService)
  })

  describe('no search', () => {
    test.each([[undefined], [''], ['   '], ['\t\n ']])('%p runs no raw query and puts no id rule in where', async (search) => {
      await repository.findManyPaginated(1, 10, search)

      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
      expect(findManyArgs()?.where?.id).toBeUndefined()
      expect(mockPrisma.partner.count.mock.calls[0]?.[0]?.where?.id).toBeUndefined()
    })
  })

  describe('a search', () => {
    test('runs one $queryRaw and filters the page (rows and count) by the ids it returned', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'partner-nosh' }, { id: 'partner-iasonos' }])
      mockPrisma.partner.findMany.mockResolvedValueOnce([{ id: 'partner-nosh', name: 'Nosh' }])
      mockPrisma.partner.count.mockResolvedValueOnce(2)

      const result = await repository.findManyPaginated(1, 10, 'nosh')

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
      expect(findManyArgs()).toEqual(
        expect.objectContaining({
          where: { id: { in: ['partner-nosh', 'partner-iasonos'] } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          skip: 0,
        }),
      )
      expect(mockPrisma.partner.count.mock.calls[0]?.[0]?.where).toEqual({ id: { in: ['partner-nosh', 'partner-iasonos'] } })
      expect(result.data.map((partner) => partner.id)).toEqual(['partner-nosh'])
      expect(result.pagination?.totalItems).toBe(2)
    })

    test('no matching restaurant filters by an empty id list and returns an empty page', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([])

      const result = await repository.findManyPaginated(1, 10, 'nothing-matches')

      expect(findManyArgs()?.where).toEqual({ id: { in: [] } })
      expect(result.data).toEqual([])
      expect(result.pagination?.totalItems).toBe(0)
    })

    test('folds through oc_search_fold over the name, the five pickup address fields and the email, joined by chr(10)', async () => {
      await repository.findManyPaginated(1, 10, 'nosh')

      const sql = oneLine(sentQuery().text)
      expect(sql).toContain(`oc_search_fold(concat_ws(chr(10), ${SEARCHED_FIELDS.join(', ')})) LIKE $1`)
      expect(sql).toContain('FROM "Partner" p')
      expect(sql).toContain('LEFT JOIN "Location" l ON l."id" = p."pickupLocationId"')
      expect(sql).toContain('LEFT JOIN "User" u ON u."id" = p."userId"')
    })

    test.each(SEARCHED_FIELDS)('the folded text includes %s', async (field) => {
      await repository.findManyPaginated(1, 10, 'nosh')

      const concat = oneLine(sentQuery().text).match(/concat_ws\(chr\(10\), ([^)]*)\)/)
      expect(concat).not.toBeNull()
      expect(concat?.[1]?.split(', ')).toContain(field)
    })

    test('one word gives one LIKE condition', async () => {
      await repository.findManyPaginated(1, 10, 'nosh')

      const query = sentQuery()
      expect(query.text.match(/ LIKE /g)).toHaveLength(1)
      expect(query.values).toEqual(['%nosh%'])
    })

    test('two words give two LIKE conditions joined by AND, never OR', async () => {
      await repository.findManyPaginated(1, 10, 'Νόσης  Ιάσονος')

      const query = sentQuery()
      const sql = oneLine(query.text)
      expect(sql.match(/ LIKE \$\d/g)).toEqual([' LIKE $1', ' LIKE $2'])
      expect(sql).toMatch(/LIKE \$1 AND oc_search_fold\(/)
      expect(sql).not.toMatch(/\bOR\b/i)
      expect(query.values).toEqual(['%νοσησ%', '%ιασονοσ%'])
    })

    test.each([
      ['ΝΟΣΗ', '%νοση%'],
      ['Νόσης', '%νοσησ%'],
      ['ΙΆΣΟΝΟΣ', '%ιασονοσ%'],
      ['Café', '%cafe%'],
      ['NOSH@Volos.GR', '%nosh@volos.gr%'],
    ])('folds the typed word %p to the parameter %p', async (search, parameter) => {
      await repository.findManyPaginated(1, 10, search)

      expect(sentQuery().values).toEqual([parameter])
    })

    test.each([
      ['50%', '%50\\%%'],
      ['a_b', '%a\\_b%'],
      ['back\\slash', '%back\\\\slash%'],
    ])('LIKE escapes %p to the parameter %p', async (search, parameter) => {
      await repository.findManyPaginated(1, 10, search)

      expect(sentQuery().values).toEqual([parameter])
    })

    test('the typed text reaches the database only as a parameter, never inside the SQL text', async () => {
      const typed = `zqxmarker'); DELETE FROM "Partner"; --`
      await repository.findManyPaginated(1, 10, typed)

      const query = sentQuery()
      const rawStrings = (mockPrisma.$queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join('')
      for (const text of [query.text, query.sql, rawStrings]) {
        expect(text).not.toContain('zqxmarker')
        expect(text).not.toContain('DELETE')
      }
      expect(query.values.join(' ')).toContain('zqxmarker')
    })
  })
})
