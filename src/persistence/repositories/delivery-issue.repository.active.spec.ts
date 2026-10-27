import { EnumDeliveryIssueReason } from '@prisma/types'
import { DeliveryIssueRepository } from './delivery-issue.repository'
import { PrismaService } from '../../services/prisma/prisma.service'

describe('DeliveryIssueRepository (clause 4)', () => {
  let repository: DeliveryIssueRepository
  let mockPrisma: {
    deliveryIssue: {
      create: jest.Mock
      findMany: jest.Mock
    }
  }

  const mockDeliveryIssue = {
    id: 'issue-1',
    deliveryId: 'del-1',
    courierId: 'courier-1',
    reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
    note: 'Wrong door number',
    createdAt: new Date('2026-10-27T08:00:00.000Z'),
    courier: { firstName: 'Giorgos', lastName: 'Oikonomou' },
  }

  beforeEach(() => {
    mockPrisma = {
      deliveryIssue: {
        create: jest.fn().mockResolvedValue(mockDeliveryIssue),
        findMany: jest.fn().mockResolvedValue([mockDeliveryIssue]),
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
    test('orders by createdAt then id ascending and includes courier firstName and lastName', async () => {
      const deliveryId = 'del-1'

      const result = await repository.findForDelivery(deliveryId)

      expect(mockPrisma.deliveryIssue.findMany).toHaveBeenCalledWith({
        where: { deliveryId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          courier: {
            select: { firstName: true, lastName: true },
          },
        },
      })
      expect(result).toEqual([mockDeliveryIssue])
    })
  })
})
