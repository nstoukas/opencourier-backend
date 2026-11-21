import { OfferReasonRepository } from './offer-reason.repository'
import { PrismaService } from '../../services/prisma/prisma.service'

describe('OfferReasonRepository (Spec 0044: AC-6, AC-8)', () => {
  let repository: OfferReasonRepository
  let mockPrisma: {
    offerReason: {
      findMany: jest.Mock
      create: jest.Mock
    }
  }

  beforeEach(() => {
    mockPrisma = {
      offerReason: {
        findMany: jest.fn().mockResolvedValue([]),
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
})
