import { OfferReasonRepository } from './offer-reason.repository'
import { PrismaService } from '../../services/prisma/prisma.service'

describe('OfferReasonRepository (Spec 0044: AC-6, AC-8)', () => {
  let repository: OfferReasonRepository
  let mockPrisma: {
    offerReason: {
      findMany: jest.Mock
      findFirst: jest.Mock
      create: jest.Mock
    }
  }

  beforeEach(() => {
    mockPrisma = {
      offerReason: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    }
    repository = new OfferReasonRepository(mockPrisma as unknown as PrismaService)
  })

  describe('findByDeliveryId', () => {
    test('orders by createdAt then id for deterministic tie-breaking', async () => {
      const deliveryId = 'del-123'
      await repository.findByDeliveryId(deliveryId)

      expect(mockPrisma.offerReason.findMany).toHaveBeenCalledWith({
        where: { deliveryId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    })
  })

  // Spec 0045 (AC-1, AC-5, cross check 4): a rider's own latest reason for a delivery, up to a time.
  describe('findOwnLatest (Spec 0045: AC-1, AC-5)', () => {
    const upTo = new Date('2026-11-20T10:01:00.000Z')

    test('selects only strategy, kind, values and weights, never candidates', async () => {
      await repository.findOwnLatest('courier-1', 'del-123', upTo)

      expect(mockPrisma.offerReason.findFirst).toHaveBeenCalledTimes(1)
      const args = mockPrisma.offerReason.findFirst.mock.calls[0][0]
      // An explicit select must exist: without one Prisma loads every column, candidates included.
      expect(args.select).toEqual({ strategy: true, kind: true, values: true, weights: true })
      expect(Object.keys(args.select)).not.toContain('candidates')
      expect(Object.keys(args.select)).not.toContain('score')
      expect(Object.keys(args.select)).not.toContain('candidateCount')
      expect(Object.keys(args.select)).not.toContain('ridersInRange')
      expect(args.include).toBeUndefined()
    })

    test('filters by this courier, this delivery and createdAt up to the given time', async () => {
      await repository.findOwnLatest('courier-1', 'del-123', upTo)

      const args = mockPrisma.offerReason.findFirst.mock.calls[0][0]
      expect(args.where).toEqual({ courierId: 'courier-1', deliveryId: 'del-123', createdAt: { lte: upTo } })
    })

    test('orders newest first, with id as the tie break', async () => {
      await repository.findOwnLatest('courier-1', 'del-123', upTo)

      const args = mockPrisma.offerReason.findFirst.mock.calls[0][0]
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
    })

    test('answers what the database found, and null when there is none', async () => {
      const row = { strategy: 'FAIRNESS', kind: 'SINGLE', values: { roadSeconds: 480 }, weights: { roadTime: 50 } }
      mockPrisma.offerReason.findFirst.mockResolvedValueOnce(row)
      await expect(repository.findOwnLatest('courier-1', 'del-123', upTo)).resolves.toEqual(row)
      await expect(repository.findOwnLatest('courier-1', 'del-123', upTo)).resolves.toBeNull()
    })
  })
})
