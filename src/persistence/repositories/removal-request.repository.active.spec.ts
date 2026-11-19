import { EnumRemovalRequestStatus, Prisma } from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { RemovalRequestRepository } from './removal-request.repository'

describe('RemovalRequestRepository', () => {
  let repository: RemovalRequestRepository
  let mockPrisma: any
  let mockTx: any

  beforeEach(() => {
    mockTx = {
      removalReason: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        aggregate: jest.fn(),
      },
      settingChange: {
        create: jest.fn(),
      },
    }
    mockPrisma = {
      $transaction: jest.fn((callback) => callback(mockTx)),
      deliveryRemovalRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      removalReason: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
    }
    repository = new RemovalRequestRepository(mockPrisma as unknown as PrismaService)
  })

  describe('updateIfOpen (AC-8: exactly one winner)', () => {
    test('updates where id and status is OPEN, returning true on count 1', async () => {
      mockPrisma.deliveryRemovalRequest.updateMany.mockResolvedValue({ count: 1 })

      const result = await repository.updateIfOpen('req-1', {
        status: EnumRemovalRequestStatus.APPROVED,
        openFor: null,
      })

      expect(mockPrisma.deliveryRemovalRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', status: EnumRemovalRequestStatus.OPEN },
        data: { status: EnumRemovalRequestStatus.APPROVED, openFor: null },
      })
      expect(result).toBe(true)
    })

    test('returns false when count is 0 (lost race)', async () => {
      mockPrisma.deliveryRemovalRequest.updateMany.mockResolvedValue({ count: 0 })

      const result = await repository.updateIfOpen('req-1', {
        status: EnumRemovalRequestStatus.DECLINED,
      })

      expect(mockPrisma.deliveryRemovalRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', status: EnumRemovalRequestStatus.OPEN },
        data: { status: EnumRemovalRequestStatus.DECLINED },
      })
      expect(result).toBe(false)
    })
  })

  describe('updateIfApproved (conditional undo)', () => {
    test('updates where id and status is APPROVED, returning true on count 1', async () => {
      mockPrisma.deliveryRemovalRequest.updateMany.mockResolvedValue({ count: 1 })

      const result = await repository.updateIfApproved('req-1', {
        status: EnumRemovalRequestStatus.OPEN,
        openFor: 'del-1',
      })

      expect(mockPrisma.deliveryRemovalRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', status: EnumRemovalRequestStatus.APPROVED },
        data: { status: EnumRemovalRequestStatus.OPEN, openFor: 'del-1' },
      })
      expect(result).toBe(true)
    })

    test('returns false when count is 0', async () => {
      mockPrisma.deliveryRemovalRequest.updateMany.mockResolvedValue({ count: 0 })

      const result = await repository.updateIfApproved('req-1', {
        status: EnumRemovalRequestStatus.CLOSED,
      })

      expect(mockPrisma.deliveryRemovalRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', status: EnumRemovalRequestStatus.APPROVED },
        data: { status: EnumRemovalRequestStatus.CLOSED },
      })
      expect(result).toBe(false)
    })
  })

  describe('createOpen (AC-4: once only key)', () => {
    const input = {
      deliveryId: 'del-100',
      courierId: 'courier-1',
      reasonId: 'reason-1',
      label: 'Moped breakdown',
      paidToRider: true,
      chargedToRestaurant: false,
      note: 'Engine stopped',
    }

    test('sets openFor to the delivery id and status to OPEN', async () => {
      const createdRecord = { id: 'req-new', ...input, status: EnumRemovalRequestStatus.OPEN, openFor: 'del-100' }
      mockPrisma.deliveryRemovalRequest.create.mockResolvedValue(createdRecord)

      const result = await repository.createOpen(input)

      expect(mockPrisma.deliveryRemovalRequest.create).toHaveBeenCalledWith({
        data: {
          ...input,
          status: EnumRemovalRequestStatus.OPEN,
          openFor: 'del-100',
        },
      })
      expect(result).toEqual(createdRecord)
    })

    test('answers null on unique constraint error (P2002)', async () => {
      const uniqueError = Object.assign(new Error('Unique constraint failed'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
      })
      mockPrisma.deliveryRemovalRequest.create.mockRejectedValue(uniqueError)

      const result = await repository.createOpen(input)

      expect(result).toBeNull()
    })

    test('rethrows any other error', async () => {
      const dbError = new Error('Connection refused')
      mockPrisma.deliveryRemovalRequest.create.mockRejectedValue(dbError)

      await expect(repository.createOpen(input)).rejects.toThrow('Connection refused')
    })
  })

  describe('findApprovedUnsettled (AC-18: minute sweep query)', () => {
    test('filters by status APPROVED, settledAt null, and decidedAt bounds', async () => {
      const from = new Date('2026-11-09T10:00:00.000Z')
      const to = new Date('2026-11-09T10:30:00.000Z')
      mockPrisma.deliveryRemovalRequest.findMany.mockResolvedValue([])

      await repository.findApprovedUnsettled(from, to)

      expect(mockPrisma.deliveryRemovalRequest.findMany).toHaveBeenCalledWith({
        where: {
          status: EnumRemovalRequestStatus.APPROVED,
          settledAt: null,
          decidedAt: { gte: from, lte: to },
        },
        orderBy: { decidedAt: 'asc' },
        take: 200,
      })
    })
  })

  describe('updateActiveReason (spec 0038, AC-12)', () => {
    const reasonId = 'reason-1'
    const adminId = 'admin-user-1'
    const initialReason = {
      id: reasonId,
      label: 'Flat tire',
      paidToRider: true,
      chargedToRestaurant: false,
      position: 1,
      needsNote: false,
      removedAt: null,
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      updatedAt: new Date('2026-11-01T10:00:00.000Z'),
    }

    it('an edit of only the order writes no settingChange through the tx client', async () => {
      mockTx.removalReason.findFirst.mockResolvedValue(initialReason)
      mockTx.removalReason.updateMany.mockResolvedValue({ count: 1 })
      mockTx.removalReason.findUniqueOrThrow.mockResolvedValue({
        ...initialReason,
        position: 2,
      })

      const result = await repository.updateActiveReason(reasonId, { position: 2 }, adminId)

      expect(result).toEqual({ ...initialReason, position: 2 })
      expect(mockTx.removalReason.updateMany).toHaveBeenCalledTimes(1)
      expect(mockTx.settingChange.create).not.toHaveBeenCalled()
    })

    it('an edit of only the note rule writes no settingChange through the tx client', async () => {
      mockTx.removalReason.findFirst.mockResolvedValue(initialReason)
      mockTx.removalReason.updateMany.mockResolvedValue({ count: 1 })
      mockTx.removalReason.findUniqueOrThrow.mockResolvedValue({
        ...initialReason,
        needsNote: true,
      })

      const result = await repository.updateActiveReason(reasonId, { needsNote: true }, adminId)

      expect(result).toEqual({ ...initialReason, needsNote: true })
      expect(mockTx.removalReason.updateMany).toHaveBeenCalledTimes(1)
      expect(mockTx.settingChange.create).not.toHaveBeenCalled()
    })

    it('an edit of the label writes exactly one settingChange with key removalReason', async () => {
      mockTx.removalReason.findFirst.mockResolvedValue(initialReason)
      mockTx.removalReason.updateMany.mockResolvedValue({ count: 1 })
      const updatedReason = { ...initialReason, label: 'Punctured tire' }
      mockTx.removalReason.findUniqueOrThrow.mockResolvedValue(updatedReason)

      const result = await repository.updateActiveReason(reasonId, { label: 'Punctured tire' }, adminId)

      expect(result).toEqual(updatedReason)
      expect(mockTx.settingChange.create).toHaveBeenCalledTimes(1)
      expect(mockTx.settingChange.create).toHaveBeenCalledWith({
        data: {
          key: 'removalReason',
          subject: reasonId,
          oldValue: { label: 'Flat tire', paidToRider: true, chargedToRestaurant: false },
          newValue: { label: 'Punctured tire', paidToRider: true, chargedToRestaurant: false },
          changedByUserId: adminId,
        },
      })
    })

    it('an edit of paidToRider writes exactly one settingChange with key removalReason', async () => {
      mockTx.removalReason.findFirst.mockResolvedValue(initialReason)
      mockTx.removalReason.updateMany.mockResolvedValue({ count: 1 })
      const updatedReason = { ...initialReason, paidToRider: false }
      mockTx.removalReason.findUniqueOrThrow.mockResolvedValue(updatedReason)

      const result = await repository.updateActiveReason(reasonId, { paidToRider: false }, adminId)

      expect(result).toEqual(updatedReason)
      expect(mockTx.settingChange.create).toHaveBeenCalledTimes(1)
      expect(mockTx.settingChange.create).toHaveBeenCalledWith({
        data: {
          key: 'removalReason',
          subject: reasonId,
          oldValue: { label: 'Flat tire', paidToRider: true, chargedToRestaurant: false },
          newValue: { label: 'Flat tire', paidToRider: false, chargedToRestaurant: false },
          changedByUserId: adminId,
        },
      })
    })

    it('an edit of chargedToRestaurant writes exactly one settingChange with key removalReason', async () => {
      mockTx.removalReason.findFirst.mockResolvedValue(initialReason)
      mockTx.removalReason.updateMany.mockResolvedValue({ count: 1 })
      const updatedReason = { ...initialReason, chargedToRestaurant: true }
      mockTx.removalReason.findUniqueOrThrow.mockResolvedValue(updatedReason)

      const result = await repository.updateActiveReason(reasonId, { chargedToRestaurant: true }, adminId)

      expect(result).toEqual(updatedReason)
      expect(mockTx.settingChange.create).toHaveBeenCalledTimes(1)
      expect(mockTx.settingChange.create).toHaveBeenCalledWith({
        data: {
          key: 'removalReason',
          subject: reasonId,
          oldValue: { label: 'Flat tire', paidToRider: true, chargedToRestaurant: false },
          newValue: { label: 'Flat tire', paidToRider: true, chargedToRestaurant: true },
          changedByUserId: adminId,
        },
      })
    })
  })

  describe('createReason (spec 0038, AC-12)', () => {
    it('writes a SettingChange with key removalReason, oldValue null, and newValue on create', async () => {
      const createdReason = {
        id: 'new-reason-1',
        label: 'Severe weather',
        paidToRider: true,
        chargedToRestaurant: true,
        position: 3,
        needsNote: false,
        removedAt: null,
        createdAt: new Date('2026-11-19T10:00:00.000Z'),
        updatedAt: new Date('2026-11-19T10:00:00.000Z'),
      }
      mockTx.removalReason.aggregate.mockResolvedValue({ _max: { position: 2 } })
      mockTx.removalReason.create.mockResolvedValue(createdReason)

      const result = await repository.createReason(
        { label: 'Severe weather', paidToRider: true, chargedToRestaurant: true },
        'admin-user-1'
      )

      expect(result).toEqual(createdReason)
      expect(mockTx.settingChange.create).toHaveBeenCalledTimes(1)
      expect(mockTx.settingChange.create).toHaveBeenCalledWith({
        data: {
          key: 'removalReason',
          subject: 'new-reason-1',
          oldValue: Prisma.DbNull,
          newValue: { label: 'Severe weather', paidToRider: true, chargedToRestaurant: true },
          changedByUserId: 'admin-user-1',
        },
      })
    })
  })

  describe('removeActiveReason (spec 0038, AC-12)', () => {
    it('writes a SettingChange with key removalReason, oldValue, and newValue null on remove', async () => {
      const reasonId = 'reason-to-remove'
      const existingReason = {
        id: reasonId,
        label: 'Customer absent',
        paidToRider: false,
        chargedToRestaurant: true,
        position: 2,
        needsNote: false,
        removedAt: new Date('2026-11-19T10:00:00.000Z'),
        createdAt: new Date('2026-11-01T10:00:00.000Z'),
        updatedAt: new Date('2026-11-19T10:00:00.000Z'),
      }
      mockTx.removalReason.updateMany.mockResolvedValue({ count: 1 })
      mockTx.removalReason.findUniqueOrThrow.mockResolvedValue(existingReason)

      const result = await repository.removeActiveReason(reasonId, 'admin-user-1')

      expect(result).toEqual(existingReason)
      expect(mockTx.settingChange.create).toHaveBeenCalledTimes(1)
      expect(mockTx.settingChange.create).toHaveBeenCalledWith({
        data: {
          key: 'removalReason',
          subject: reasonId,
          oldValue: { label: 'Customer absent', paidToRider: false, chargedToRestaurant: true },
          newValue: Prisma.DbNull,
          changedByUserId: 'admin-user-1',
        },
      })
    })
  })
})
