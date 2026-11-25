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
        delete: jest.fn().mockResolvedValue({ id: 'loc-1' }),
      },
    }
    repository = new LocationRepository(mockPrisma as unknown as PrismaService)
  })

  describe('delete (Row 166)', () => {
    it('calls prisma.location.delete with where id matching locationId', async () => {
      const locationId = 'loc-to-delete'
      await repository.delete(locationId)

      expect(mockPrisma.location.delete).toHaveBeenCalledTimes(1)
      expect(mockPrisma.location.delete).toHaveBeenCalledWith({
        where: { id: locationId },
      })
    })
  })
})
