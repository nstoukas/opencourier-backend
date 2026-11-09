import { EnumRemovalRequestStatus } from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { RemovalRequestRepository } from './removal-request.repository'

describe('RemovalRequestRepository', () => {
  let repository: RemovalRequestRepository
  let mockPrisma: {
    deliveryRemovalRequest: {
      updateMany: jest.Mock
      create: jest.Mock
      findMany: jest.Mock
      findFirst: jest.Mock
      findUnique: jest.Mock
    }
  }

  beforeEach(() => {
    mockPrisma = {
      deliveryRemovalRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
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
})
