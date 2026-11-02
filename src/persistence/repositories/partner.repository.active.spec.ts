import { PrismaService } from 'src/services/prisma/prisma.service'
import { PartnerRepository } from './partner.repository'

describe('PartnerRepository.findPickupPoints (Spec 0018 AC-4)', () => {
  let repository: PartnerRepository
  let mockPrisma: any

  beforeEach(() => {
    mockPrisma = {
      partner: {
        findMany: jest.fn(),
      },
    }

    repository = new PartnerRepository(mockPrisma as unknown as PrismaService)
  })

  test('asks Prisma for partners whose pickupLocationId is not null, ordered by name asc, selecting id, name and location lat/lng', async () => {
    mockPrisma.partner.findMany.mockResolvedValueOnce([
      {
        id: 'partner-1',
        name: 'Alpha Pizza',
        pickupLocation: { latitude: 39.362, longitude: 22.942 },
      },
      {
        id: 'partner-2',
        name: 'Beta Burgers',
        pickupLocation: { latitude: 39.365, longitude: 22.945 },
      },
    ])

    const result = await repository.findPickupPoints()

    expect(mockPrisma.partner.findMany).toHaveBeenCalledWith({
      where: { pickupLocationId: { not: null } },
      select: {
        id: true,
        name: true,
        pickupLocation: { select: { latitude: true, longitude: true } },
      },
      orderBy: { name: 'asc' },
    })

    expect(result).toEqual([
      { id: 'partner-1', name: 'Alpha Pizza', latitude: 39.362, longitude: 22.942 },
      { id: 'partner-2', name: 'Beta Burgers', latitude: 39.365, longitude: 22.945 },
    ])
  })

  test('filters out partners whose pickupLocation resolves to null or missing', async () => {
    mockPrisma.partner.findMany.mockResolvedValueOnce([
      {
        id: 'partner-1',
        name: 'Alpha Pizza',
        pickupLocation: { latitude: 39.362, longitude: 22.942 },
      },
      {
        id: 'partner-orphan',
        name: 'Ghost Kitchen',
        pickupLocation: null,
      },
      {
        id: 'partner-2',
        name: 'Beta Burgers',
        pickupLocation: { latitude: 39.365, longitude: 22.945 },
      },
    ])

    const result = await repository.findPickupPoints()

    expect(result).toEqual([
      { id: 'partner-1', name: 'Alpha Pizza', latitude: 39.362, longitude: 22.942 },
      { id: 'partner-2', name: 'Beta Burgers', latitude: 39.365, longitude: 22.945 },
    ])
    expect(result.some((p) => p.id === 'partner-orphan')).toBe(false)
  })
})
