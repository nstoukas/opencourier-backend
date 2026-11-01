import { UserRepository } from './user.repository'
import { PrismaService } from '../../services/prisma/prisma.service'
import { UserEntity } from '../../domains/user/entities/user.entity'
import { EnumUserRole } from '@prisma/types'

describe('UserRepository (Spec 0013 AC-3 findUserWithEmailIgnoringCase)', () => {
  let repository: UserRepository
  let mockPrisma: {
    user: {
      findFirst: jest.Mock
    }
  }

  const sampleUserRecord = {
    id: 'user-123',
    email: 'Nikos@Coop.gr',
    password: 'hashed-password',
    role: [EnumUserRole.COURIER],
    username: null,
    apiKey: null,
    credentialsChangedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }

  beforeEach(() => {
    mockPrisma = {
      user: {
        findFirst: jest.fn(),
      },
    }
    repository = new UserRepository(mockPrisma as unknown as PrismaService)
  })

  test('finds user with email ignoring case using insensitive mode', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(sampleUserRecord)

    const result = await repository.findUserWithEmailIgnoringCase('nikos@coop.gr')

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'nikos@coop.gr', mode: 'insensitive' },
      },
    })
    expect(result).toBeInstanceOf(UserEntity)
    expect(result?.email).toBe('Nikos@Coop.gr')
  })

  test('returns undefined when no user matches email', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null)

    const result = await repository.findUserWithEmailIgnoringCase('unknown@coop.gr')

    expect(result).toBeUndefined()
  })
})
