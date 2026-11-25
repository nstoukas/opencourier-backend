import { PrismaService } from 'src/services/prisma/prisma.service'
import { LocationRepository } from './location.repository'

describe('LocationRepository (Row 166: delete for unused Location rows)', () => {
  let repository: LocationRepository
  let mockPrisma: any

  beforeEach(() => {
    mockPrisma = {
      location: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
    repository = new LocationRepository(mockPrisma as unknown as PrismaService)
  })

  describe('deleteIfUnused (Row 166)', () => {
    const locationId = 'loc-to-delete'

    it('calls prisma.location.deleteMany with where id matching locationId', async () => {
      await repository.deleteIfUnused(locationId)

      expect(mockPrisma.location.deleteMany).toHaveBeenCalledTimes(1)
      const call = mockPrisma.location.deleteMany.mock.calls[0][0]
      expect(call.where.id).toBe(locationId)
    })

    const requiredRelations = [
      'locationNotes',
      'pickupDelivery',
      'dropoffDelivery',
      'pickupDeliveryQuotes',
      'dropoffDeliveryQuotes',
      'partnerPickups',
    ] as const

    for (const relation of requiredRelations) {
      it(`fails if ${relation} condition is missing from deleteMany where`, async () => {
        await repository.deleteIfUnused(locationId)

        const call = mockPrisma.location.deleteMany.mock.calls[0][0]
        expect(call.where[relation]).toEqual({ none: {} })
      })
    }

    it('requires all six none: {} relation conditions alongside id in deleteMany where', async () => {
      await repository.deleteIfUnused(locationId)

      expect(mockPrisma.location.deleteMany).toHaveBeenCalledWith({
        where: {
          id: locationId,
          locationNotes: { none: {} },
          pickupDelivery: { none: {} },
          dropoffDelivery: { none: {} },
          pickupDeliveryQuotes: { none: {} },
          dropoffDeliveryQuotes: { none: {} },
          partnerPickups: { none: {} },
        },
      })
    })

    it('answers true when deleteMany removes the row (count = 1)', async () => {
      mockPrisma.location.deleteMany.mockResolvedValueOnce({ count: 1 })
      const result = await repository.deleteIfUnused(locationId)
      expect(result).toBe(true)
    })

    it('answers false when deleteMany finds row in use or already gone (count = 0)', async () => {
      mockPrisma.location.deleteMany.mockResolvedValueOnce({ count: 0 })
      const result = await repository.deleteIfUnused(locationId)
      expect(result).toBe(false)
    })
  })
})
