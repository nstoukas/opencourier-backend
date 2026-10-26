import { PrismaService } from 'src/services/prisma/prisma.service'
import {
  escapeLikePattern,
  SavedCustomerFields,
  SavedCustomerRepository,
} from './saved-customer.repository'

describe('SavedCustomerRepository (AC-3, AC-5, AC-7, Invariant lastUsedAt)', () => {
  let repository: SavedCustomerRepository
  let mockPrisma: any

  const partnerId = 'partner-volos-1'
  const customerId = 'cust-1'

  const sampleFields: SavedCustomerFields = {
    name: 'Nikos Dimas',
    phone: '+306912345678',
    notes: '2nd floor',
    addressLine1: 'Iasonos 10',
    addressLine2: null,
    city: 'Volos',
    zipCode: '38221',
    latitude: 39.362,
    longitude: 22.945,
    formattedAddress: 'Iasonos 10, Volos',
  }

  beforeEach(() => {
    mockPrisma = {
      savedCustomer: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(async (arg) => {
        if (typeof arg === 'function') {
          return arg(mockPrisma)
        }
        return Promise.all(arg)
      }),
      $executeRaw: jest.fn(),
    }

    repository = new SavedCustomerRepository(mockPrisma as unknown as PrismaService)
  })

  describe('escapeLikePattern (AC-3)', () => {
    it('escapes %, _ and \\ with backslashes so Prisma contains does not treat them as wildcards', () => {
      expect(escapeLikePattern('%')).toBe('\\%')
      expect(escapeLikePattern('_')).toBe('\\_')
      expect(escapeLikePattern('\\')).toBe('\\\\')
      expect(escapeLikePattern('100%_clean\\path')).toBe('100\\%\\_clean\\\\path')
      expect(escapeLikePattern('plain text')).toBe('plain text')
    })
  })

  describe('list (AC-3, AC-5)', () => {
    it('scopes list to partnerId, orders by lastUsedAt desc then id desc, and applies pagination', async () => {
      const mockItems = [{ id: customerId, partnerId, ...sampleFields }]
      mockPrisma.savedCustomer.findMany.mockResolvedValue(mockItems)
      mockPrisma.savedCustomer.count.mockResolvedValue(1)

      const result = await repository.list(partnerId, null, 2, 10)

      expect(mockPrisma.savedCustomer.findMany).toHaveBeenCalledWith({
        where: { partnerId },
        orderBy: [{ lastUsedAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 10,
      })
      expect(mockPrisma.savedCustomer.count).toHaveBeenCalledWith({
        where: { partnerId },
      })
      expect(result).toEqual({ items: mockItems, total: 1 })
    })

    it('escapes wildcards in name search and omits phone clause when search has fewer than 2 digits', async () => {
      mockPrisma.savedCustomer.findMany.mockResolvedValue([])
      mockPrisma.savedCustomer.count.mockResolvedValue(0)

      await repository.list(partnerId, 'robe_%1', 1, 20)

      expect(mockPrisma.savedCustomer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            partnerId,
            OR: [
              { name: { contains: 'robe\\_\\%1', mode: 'insensitive' } },
            ],
          },
        })
      )
    })

    it('includes digits-only phone search in OR clause when search holds 2 or more digits', async () => {
      mockPrisma.savedCustomer.findMany.mockResolvedValue([])
      mockPrisma.savedCustomer.count.mockResolvedValue(0)

      await repository.list(partnerId, 'Tel: 69 12!', 1, 20)

      expect(mockPrisma.savedCustomer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            partnerId,
            OR: [
              { name: { contains: 'Tel: 69 12!', mode: 'insensitive' } },
              { phone: { contains: '6912' } },
            ],
          },
        })
      )
    })
  })

  describe('findOwned (AC-5)', () => {
    it('scopes lookup by both id and partnerId', async () => {
      mockPrisma.savedCustomer.findFirst.mockResolvedValue({ id: customerId, partnerId })

      const res = await repository.findOwned(partnerId, customerId)
      expect(mockPrisma.savedCustomer.findFirst).toHaveBeenCalledWith({
        where: { id: customerId, partnerId },
      })
      expect(res?.id).toBe(customerId)
    })
  })

  describe('findIdByPhone (AC-4, AC-5)', () => {
    it('uses compound unique partnerId_phone to find existing customer id', async () => {
      mockPrisma.savedCustomer.findUnique.mockResolvedValue({ id: customerId })

      const id = await repository.findIdByPhone(partnerId, '+306912345678')
      expect(mockPrisma.savedCustomer.findUnique).toHaveBeenCalledWith({
        where: { partnerId_phone: { partnerId, phone: '+306912345678' } },
        select: { id: true },
      })
      expect(id).toBe(customerId)
    })

    it('returns null if no customer found with that phone', async () => {
      mockPrisma.savedCustomer.findUnique.mockResolvedValue(null)
      const id = await repository.findIdByPhone(partnerId, '+306912345678')
      expect(id).toBeNull()
    })
  })

  describe('create (AC-4, AC-5)', () => {
    it('creates customer record with partnerId in data', async () => {
      mockPrisma.savedCustomer.create.mockResolvedValue({ id: customerId, partnerId, ...sampleFields })

      const result = await repository.create(partnerId, sampleFields)
      expect(mockPrisma.savedCustomer.create).toHaveBeenCalledWith({
        data: { ...sampleFields, partnerId },
      })
      expect(result.id).toBe(customerId)
    })
  })

  describe('upsertByPhone (AC-1, AC-4, Invariant lastUsedAt)', () => {
    it('upserts on partnerId_phone compound unique without markUsed', async () => {
      mockPrisma.savedCustomer.findUnique.mockResolvedValue(null) // new customer
      mockPrisma.savedCustomer.upsert.mockResolvedValue({ id: customerId, partnerId, ...sampleFields })

      const result = await repository.upsertByPhone(partnerId, sampleFields, false)

      expect(mockPrisma.savedCustomer.upsert).toHaveBeenCalledWith({
        where: { partnerId_phone: { partnerId, phone: sampleFields.phone } },
        create: { ...sampleFields, partnerId },
        update: sampleFields,
      })
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
      expect(result.created).toBe(true)
    })

    it('applies markUsed via GREATEST SQL when markUsed is true', async () => {
      mockPrisma.savedCustomer.findUnique.mockResolvedValue({ id: customerId }) // existing
      mockPrisma.savedCustomer.upsert.mockResolvedValue({ id: customerId, partnerId, ...sampleFields })
      mockPrisma.savedCustomer.findFirst.mockResolvedValue({ id: customerId, partnerId, ...sampleFields })
      mockPrisma.$executeRaw.mockResolvedValue(1)

      const result = await repository.upsertByPhone(partnerId, sampleFields, true)

      expect(mockPrisma.$executeRaw).toHaveBeenCalled()
      const rawStrings = mockPrisma.$executeRaw.mock.calls[0][0]
      const sqlText = Array.isArray(rawStrings) ? rawStrings.join('?') : String(rawStrings)
      expect(sqlText).toContain('GREATEST("lastUsedAt", now() AT TIME ZONE \'UTC\')')
      expect(sqlText).toContain('"partnerId" =')
      expect(result.created).toBe(false)
    })
  })

  describe('update (AC-4, AC-5, Invariant lastUsedAt)', () => {
    it('uses updateMany scoped to { id, partnerId } and returns null if count is 0', async () => {
      mockPrisma.savedCustomer.updateMany.mockResolvedValue({ count: 0 })

      const result = await repository.update(partnerId, customerId, { name: 'New Name' }, false)

      expect(mockPrisma.savedCustomer.updateMany).toHaveBeenCalledWith({
        where: { id: customerId, partnerId },
        data: { name: 'New Name' },
      })
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('does not touch lastUsedAt when markUsed is false', async () => {
      mockPrisma.savedCustomer.updateMany.mockResolvedValue({ count: 1 })
      mockPrisma.savedCustomer.findFirst.mockResolvedValue({ id: customerId, partnerId, name: 'New Name' })

      const result = await repository.update(partnerId, customerId, { name: 'New Name' }, false)

      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
      expect(mockPrisma.savedCustomer.findFirst).toHaveBeenCalledWith({
        where: { id: customerId, partnerId },
      })
      expect(result?.name).toBe('New Name')
    })

    it('updates lastUsedAt with GREATEST when markUsed is true', async () => {
      mockPrisma.savedCustomer.updateMany.mockResolvedValue({ count: 1 })
      mockPrisma.savedCustomer.findFirst.mockResolvedValue({ id: customerId, partnerId, name: 'New Name' })
      mockPrisma.$executeRaw.mockResolvedValue(1)

      await repository.update(partnerId, customerId, { name: 'New Name' }, true)

      expect(mockPrisma.$executeRaw).toHaveBeenCalled()
      const rawStrings = mockPrisma.$executeRaw.mock.calls[0][0]
      const sqlText = Array.isArray(rawStrings) ? rawStrings.join('?') : String(rawStrings)
      expect(sqlText).toContain('GREATEST("lastUsedAt", now() AT TIME ZONE \'UTC\')')
      expect(sqlText).toContain('WHERE "id" =')
      expect(sqlText).toContain('"partnerId" =')
    })
  })

  describe('markUsed (AC-5, Invariant lastUsedAt)', () => {
    it('executes raw SQL with GREATEST and partnerId scoping', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1)

      const result = await repository.markUsed(partnerId, customerId)

      expect(mockPrisma.$executeRaw).toHaveBeenCalled()
      const rawStrings = mockPrisma.$executeRaw.mock.calls[0][0]
      const sqlText = Array.isArray(rawStrings) ? rawStrings.join('?') : String(rawStrings)
      expect(sqlText).toContain('UPDATE "SavedCustomer"')
      expect(sqlText).toContain('SET "lastUsedAt" = GREATEST("lastUsedAt", now() AT TIME ZONE \'UTC\')')
      expect(sqlText).toContain('"partnerId" =')
      expect(result).toBe(true)
    })

    it('returns false when no row was updated (foreign or missing id)', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(0)
      const result = await repository.markUsed(partnerId, 'missing-id')
      expect(result).toBe(false)
    })
  })

  describe('delete (AC-5)', () => {
    it('uses deleteMany scoped to { id, partnerId } and returns true if deleted', async () => {
      mockPrisma.savedCustomer.deleteMany.mockResolvedValue({ count: 1 })

      const result = await repository.delete(partnerId, customerId)

      expect(mockPrisma.savedCustomer.deleteMany).toHaveBeenCalledWith({
        where: { id: customerId, partnerId },
      })
      expect(result).toBe(true)
    })

    it('returns false when deleteMany count is 0 (foreign or missing id)', async () => {
      mockPrisma.savedCustomer.deleteMany.mockResolvedValue({ count: 0 })
      const result = await repository.delete(partnerId, 'foreign-id')
      expect(result).toBe(false)
    })
  })

  describe('deleteUnusedForMonths (AC-7)', () => {
    it('executes a single DELETE statement with make_interval inside WHERE clause', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(5)

      const count = await repository.deleteUnusedForMonths(12)

      expect(mockPrisma.$executeRaw).toHaveBeenCalled()
      const rawStrings = mockPrisma.$executeRaw.mock.calls[0][0]
      const sqlText = Array.isArray(rawStrings) ? rawStrings.join('?') : String(rawStrings)
      expect(sqlText).toContain('DELETE FROM "SavedCustomer"')
      expect(sqlText).toContain('WHERE "lastUsedAt" < (now() AT TIME ZONE \'UTC\') - make_interval(months =>')
      expect(count).toBe(5)
    })
  })
})
