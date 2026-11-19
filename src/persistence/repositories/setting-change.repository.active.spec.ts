import { Prisma } from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { SettingChangeRepository, writeSettingChange } from './setting-change.repository'

describe('SettingChangeRepository (spec 0038, AC-12, AC-13)', () => {
  let repository: SettingChangeRepository
  let mockPrisma: any
  let mockTx: any

  beforeEach(() => {
    mockTx = {
      settingChange: {
        create: jest.fn(),
      },
    }

    mockPrisma = {
      settingChange: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    }

    repository = new SettingChangeRepository(mockPrisma as unknown as PrismaService)
  })

  describe('writeSettingChange (AC-12)', () => {
    it('writes key, subject, oldValue, newValue and changedByUserId through the transaction client', async () => {
      await writeSettingChange(mockTx, {
        key: 'waitPayFreeMinutes',
        subject: null,
        oldValue: 5,
        newValue: 10,
        changedByUserId: 'admin-1',
      })

      expect(mockTx.settingChange.create).toHaveBeenCalledWith({
        data: {
          key: 'waitPayFreeMinutes',
          subject: null,
          oldValue: 5,
          newValue: 10,
          changedByUserId: 'admin-1',
        },
      })
    })

    it('maps null and undefined oldValue/newValue to Prisma.DbNull (SQL NULL) instead of JsonNull', async () => {
      await writeSettingChange(mockTx, {
        key: 'removalReason',
        subject: 'reason-123',
        oldValue: null,
        newValue: { label: 'New reason', paidToRider: true },
        changedByUserId: 'admin-2',
      })

      expect(mockTx.settingChange.create).toHaveBeenCalledWith({
        data: {
          key: 'removalReason',
          subject: 'reason-123',
          oldValue: Prisma.DbNull,
          newValue: { label: 'New reason', paidToRider: true },
          changedByUserId: 'admin-2',
        },
      })

      mockTx.settingChange.create.mockClear()

      await writeSettingChange(mockTx, {
        key: 'shiftSlot',
        subject: 'slot-456',
        oldValue: { weekday: 1, riderCap: 5 },
        newValue: undefined,
        changedByUserId: 'admin-2',
      })

      expect(mockTx.settingChange.create).toHaveBeenCalledWith({
        data: {
          key: 'shiftSlot',
          subject: 'slot-456',
          oldValue: { weekday: 1, riderCap: 5 },
          newValue: Prisma.DbNull,
          changedByUserId: 'admin-2',
        },
      })
    })
  })

  describe('findPage (AC-13)', () => {
    it('filters by keys when keys array is passed (rider-facing list)', async () => {
      const riderKeys = ['waitPayFreeMinutes', 'offerExpirySeconds']
      await repository.findPage({ keys: riderKeys, page: 1, perPage: 20 })

      expect(mockPrisma.settingChange.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: { in: riderKeys } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 20,
          skip: 0,
        })
      )
    })

    it('queries with empty where when keys array is omitted (admin change history)', async () => {
      await repository.findPage({ page: 2, perPage: 10 })

      expect(mockPrisma.settingChange.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 10,
          skip: 10,
        })
      )
    })
  })

  describe('findOldest (AC-13)', () => {
    it('queries the earliest setting change row ordered by createdAt asc', async () => {
      const earliest = { id: 'change-1', createdAt: new Date('2026-11-19T00:00:00Z') }
      mockPrisma.settingChange.findFirst.mockResolvedValue(earliest)

      const result = await repository.findOldest()

      expect(mockPrisma.settingChange.findFirst).toHaveBeenCalledWith({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      expect(result).toBe(earliest)
    })
  })
})
