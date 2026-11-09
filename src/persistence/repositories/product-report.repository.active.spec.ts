import { EnumProductReportKind, EnumProductReportSource } from '@prisma/types'
import { ProductReportRepository } from './product-report.repository'
import { PrismaService } from '../../services/prisma/prisma.service'

describe('ProductReportRepository (Spec 0032, AC-6, AC-7)', () => {
  let repository: ProductReportRepository
  let mockPrisma: {
    productReport: {
      create: jest.Mock
      findUnique: jest.Mock
      findMany: jest.Mock
      updateMany: jest.Mock
      count: jest.Mock
    }
    user: {
      findMany: jest.Mock
    }
  }

  const mockReportRow = {
    id: 'rep-1',
    deliveryId: 'del-100',
    kind: EnumProductReportKind.WRONG_ITEM,
    source: EnumProductReportSource.COURIER,
    reporterUserId: 'user-courier-1',
    itemName: 'Burger',
    note: 'Wrong items',
    resolvedAt: null,
    resolvedByUserId: null,
    resolution: null,
    createdAt: new Date('2026-11-09T08:00:00.000Z'),
  }

  beforeEach(() => {
    mockPrisma = {
      productReport: {
        create: jest.fn().mockResolvedValue(mockReportRow),
        findUnique: jest.fn().mockResolvedValue(mockReportRow),
        findMany: jest.fn().mockResolvedValue([mockReportRow]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'user-courier-1', email: 'courier@example.com' }]),
      },
    }

    repository = new ProductReportRepository(mockPrisma as unknown as PrismaService)
  })

  describe('create', () => {
    test('calls prisma.productReport.create with the provided data', async () => {
      const data = {
        deliveryId: 'del-100',
        kind: EnumProductReportKind.WRONG_ITEM,
        source: EnumProductReportSource.COURIER,
        reporterUserId: 'user-courier-1',
        itemName: 'Burger',
        note: 'Wrong item',
      }

      const result = await repository.create(data)

      expect(mockPrisma.productReport.create).toHaveBeenCalledWith({ data })
      expect(result).toEqual(mockReportRow)
    })
  })

  describe('findById', () => {
    test('finds report by unique id', async () => {
      const result = await repository.findById('rep-1')

      expect(mockPrisma.productReport.findUnique).toHaveBeenCalledWith({ where: { id: 'rep-1' } })
      expect(result).toEqual(mockReportRow)
    })
  })

  describe('findForDelivery (AC-6)', () => {
    test('finds reports for delivery ordered by createdAt desc and includes reporterEmail', async () => {
      const result = await repository.findForDelivery('del-100')

      expect(mockPrisma.productReport.findMany).toHaveBeenCalledWith({
        where: { deliveryId: 'del-100' },
        orderBy: { createdAt: 'desc' },
      })
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['user-courier-1'] } },
        select: { id: true, email: true },
      })
      expect(result).toEqual([
        {
          ...mockReportRow,
          reporterEmail: 'courier@example.com',
        },
      ])
    })

    test('sets reporterEmail to null if user not found in User table', async () => {
      mockPrisma.user.findMany.mockResolvedValueOnce([])

      const result = await repository.findForDelivery('del-100')

      expect(result[0]?.reporterEmail).toBeNull()
    })
  })

  describe('findPage (AC-6)', () => {
    test('filters for open reports when state is open (resolvedAt is null)', async () => {
      const result = await repository.findPage('open', 1, 10)

      expect(mockPrisma.productReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { resolvedAt: null },
          orderBy: { createdAt: 'desc' },
        })
      )
      expect(result.data[0]?.reporterEmail).toBe('courier@example.com')
      expect(result.pagination).toBeDefined()
    })

    test('filters for resolved reports when state is resolved (resolvedAt is not null)', async () => {
      await repository.findPage('resolved', 1, 10)

      expect(mockPrisma.productReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { resolvedAt: { not: null } },
          orderBy: { createdAt: 'desc' },
        })
      )
    })

    test('applies no resolvedAt filter when state is all', async () => {
      await repository.findPage('all', 1, 10)

      expect(mockPrisma.productReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: { createdAt: 'desc' },
        })
      )
    })
  })

  describe('resolveIfOpen (AC-7)', () => {
    test('updates report with resolvedAt, resolvedByUserId and resolution only if resolvedAt is null', async () => {
      const success = await repository.resolveIfOpen('rep-1', 'admin-1', 'Refund processed')

      expect(mockPrisma.productReport.updateMany).toHaveBeenCalledWith({
        where: { id: 'rep-1', resolvedAt: null },
        data: {
          resolvedAt: expect.any(Date),
          resolvedByUserId: 'admin-1',
          resolution: 'Refund processed',
        },
      })
      expect(success).toBe(true)
    })

    test('returns false when report was already resolved (updateMany count === 0)', async () => {
      mockPrisma.productReport.updateMany.mockResolvedValueOnce({ count: 0 })

      const success = await repository.resolveIfOpen('rep-1', 'admin-1', 'Refund processed')

      expect(success).toBe(false)
    })
  })
})
