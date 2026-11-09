import { EnumDeliveryIssueReason } from '@prisma/types'
import { DeliveryIssueRepository } from './delivery-issue.repository'
import { PrismaService } from '../../services/prisma/prisma.service'

describe('DeliveryIssueRepository (clause 4)', () => {
  let repository: DeliveryIssueRepository
  let mockPrisma: {
    deliveryIssue: {
      create: jest.Mock
      findMany: jest.Mock
      findFirst: jest.Mock
      updateMany: jest.Mock
    }
  }

  const mockDeliveryIssue = {
    id: 'issue-1',
    deliveryId: 'del-1',
    courierId: 'courier-1',
    reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
    note: 'Wrong door number',
    createdAt: new Date('2026-10-27T08:00:00.000Z'),
    handledAt: null,
    handledByUserId: null,
    handledBy: null,
    courier: { firstName: 'Giorgos', lastName: 'Oikonomou' },
  }

  beforeEach(() => {
    mockPrisma = {
      deliveryIssue: {
        create: jest.fn().mockResolvedValue(mockDeliveryIssue),
        findMany: jest.fn().mockResolvedValue([mockDeliveryIssue]),
        findFirst: jest.fn().mockResolvedValue(mockDeliveryIssue),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }

    repository = new DeliveryIssueRepository(mockPrisma as unknown as PrismaService)
  })

  describe('create', () => {
    test('calls prisma.deliveryIssue.create with data and includes courier firstName and lastName', async () => {
      const input = {
        deliveryId: 'del-1',
        courierId: 'courier-1',
        reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
        note: 'Wrong door number',
      }

      const result = await repository.create(input)

      expect(mockPrisma.deliveryIssue.create).toHaveBeenCalledWith({
        data: input,
        include: {
          courier: {
            select: { firstName: true, lastName: true },
          },
        },
      })
      expect(result).toEqual(mockDeliveryIssue)
    })
  })

  describe('findForDelivery', () => {
    test('orders by createdAt then id ascending and includes courier and handledBy', async () => {
      const deliveryId = 'del-1'

      const result = await repository.findForDelivery(deliveryId)

      expect(mockPrisma.deliveryIssue.findMany).toHaveBeenCalledWith({
        where: { deliveryId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          courier: {
            select: { firstName: true, lastName: true },
          },
          handledBy: {
            select: { id: true, email: true, username: true },
          },
        },
      })
      expect(result).toEqual([mockDeliveryIssue])
    })
  })

  describe('findOpen (spec 0034, AC-7)', () => {
    test('queries unhandled reports ordered by createdAt then id ascending with courier and delivery fields', async () => {
      const mockOpenIssue = {
        id: 'issue-1',
        deliveryId: 'del-1',
        courierId: 'courier-1',
        reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
        note: null,
        createdAt: new Date('2026-11-09T10:00:00.000Z'),
        handledAt: null,
        handledByUserId: null,
        courier: { firstName: 'Giorgos', lastName: 'Oikonomou' },
        delivery: {
          status: 'ACCEPTED',
          courierId: 'courier-1',
          orderReference: 'ORD-1',
          pickupBusinessName: 'Souvlaki',
          dropoffName: 'Customer',
          dropoffBusinessName: null,
        },
      }
      mockPrisma.deliveryIssue.findMany.mockResolvedValue([mockOpenIssue])

      const result = await repository.findOpen()

      expect(mockPrisma.deliveryIssue.findMany).toHaveBeenCalledWith({
        where: { handledAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          courier: { select: { firstName: true, lastName: true } },
          delivery: {
            select: {
              status: true,
              courierId: true,
              orderReference: true,
              pickupBusinessName: true,
              dropoffName: true,
              dropoffBusinessName: true,
            },
          },
        },
      })
      expect(result).toEqual([mockOpenIssue])
    })
  })

  describe('markHandled (spec 0034, AC-7)', () => {
    test('updates only unhandled report conditionally and returns issue with ADMIN_INCLUDE', async () => {
      const now = new Date('2026-11-09T12:00:00.000Z')
      const handledIssue = {
        ...mockDeliveryIssue,
        handledAt: now,
        handledByUserId: 'admin-1',
        handledBy: { id: 'admin-1', email: 'admin@coop.gr', username: 'admin' },
      }
      mockPrisma.deliveryIssue.findFirst.mockResolvedValue(handledIssue)

      const result = await repository.markHandled('del-1', 'issue-1', 'admin-1', now)

      expect(mockPrisma.deliveryIssue.updateMany).toHaveBeenCalledWith({
        where: { id: 'issue-1', deliveryId: 'del-1', handledAt: null },
        data: { handledAt: now, handledByUserId: 'admin-1' },
      })
      expect(mockPrisma.deliveryIssue.findFirst).toHaveBeenCalledWith({
        where: { id: 'issue-1', deliveryId: 'del-1' },
        include: {
          courier: { select: { firstName: true, lastName: true } },
          handledBy: { select: { id: true, email: true, username: true } },
        },
      })
      expect(result).toEqual(handledIssue)
    })

    test('a second markHandled call keeps the first person and time (updateMany matches 0 rows)', async () => {
      const originalTime = new Date('2026-11-09T11:00:00.000Z')
      const laterTime = new Date('2026-11-09T12:00:00.000Z')
      const firstHandled = {
        ...mockDeliveryIssue,
        handledAt: originalTime,
        handledByUserId: 'first-admin',
        handledBy: { id: 'first-admin', email: 'first@coop.gr', username: 'first' },
      }
      // updateMany returns count: 0 because handledAt was already not null
      mockPrisma.deliveryIssue.updateMany.mockResolvedValue({ count: 0 })
      mockPrisma.deliveryIssue.findFirst.mockResolvedValue(firstHandled)

      const result = await repository.markHandled('del-1', 'issue-1', 'second-admin', laterTime)

      expect(mockPrisma.deliveryIssue.updateMany).toHaveBeenCalledWith({
        where: { id: 'issue-1', deliveryId: 'del-1', handledAt: null },
        data: { handledAt: laterTime, handledByUserId: 'second-admin' },
      })
      // Stored issue returned is still the first handler's record
      expect(result).toEqual(firstHandled)
      expect(result?.handledByUserId).toBe('first-admin')
      expect(result?.handledAt).toBe(originalTime)
    })

    test('returns null if issue does not exist on this delivery', async () => {
      mockPrisma.deliveryIssue.updateMany.mockResolvedValue({ count: 0 })
      mockPrisma.deliveryIssue.findFirst.mockResolvedValue(null)

      const result = await repository.markHandled('del-1', 'unknown-issue', 'admin-1', new Date())

      expect(result).toBeNull()
    })
  })
})
