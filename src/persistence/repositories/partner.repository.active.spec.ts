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

// Spec 0023, AC-9: the usual prep time is written only when given (else the column default, 15, applies
// on create, and an update leaves it alone), and auth/me finds the restaurant by its user.
describe('PartnerRepository usualPrepMinutes (spec 0023, AC-9)', () => {
  let repository: PartnerRepository
  let mockPrisma: any
  const row = { id: 'partner-1', name: 'R73', usualPrepMinutes: 15, userId: 'user-1' }

  beforeEach(() => {
    mockPrisma = {
      user: { create: jest.fn().mockResolvedValue({ id: 'user-1', partner: row }) },
      partner: {
        update: jest.fn().mockResolvedValue(row),
        findUnique: jest.fn().mockResolvedValue(row),
      },
    }
    repository = new PartnerRepository(mockPrisma as unknown as PrismaService)
  })

  const login = { email: 'r73@volos.gr', hashedPassword: 'hash', apiKey: 'key' }
  const partnerCreateData = () => mockPrisma.user.create.mock.calls[0][0].data.partner.create

  test('createWithLogin writes the usual prep time it was given, 0 included', async () => {
    await repository.createWithLogin({ name: 'R73', usualPrepMinutes: 0, login })
    expect(partnerCreateData().usualPrepMinutes).toBe(0)
  })

  test('createWithLogin without it leaves the column out, so the database default applies', async () => {
    await repository.createWithLogin({ name: 'R73', login })
    expect(partnerCreateData()).not.toHaveProperty('usualPrepMinutes')
  })

  test('update writes it when given and leaves it out when not', async () => {
    await repository.update('partner-1', { usualPrepMinutes: 30 })
    expect(mockPrisma.partner.update.mock.calls[0][0].data).toEqual({ usualPrepMinutes: 30 })

    await repository.update('partner-1', { name: 'Renamed' })
    expect(mockPrisma.partner.update.mock.calls[1][0].data).toEqual({ name: 'Renamed' })
  })

  test('findByUserId looks the restaurant up by userId, or answers null', async () => {
    const found = await repository.findByUserId('user-1')
    expect(mockPrisma.partner.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(found?.usualPrepMinutes).toBe(15)

    mockPrisma.partner.findUnique.mockResolvedValueOnce(null)
    expect(await repository.findByUserId('user-none')).toBeNull()
  })
})
