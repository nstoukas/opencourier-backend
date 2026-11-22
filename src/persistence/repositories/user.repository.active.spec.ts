import { UserRepository } from './user.repository'
import { PrismaService } from '../../services/prisma/prisma.service'
import { UserEntity } from '../../domains/user/entities/user.entity'
import { EnumUserRole } from '@prisma/types'

describe('UserRepository', () => {
  let repository: UserRepository
  let mockPrisma: any

  const sampleUserRecord = {
    id: 'user-123',
    email: 'Nikos@Coop.gr',
    password: 'hashed-password',
    role: [EnumUserRole.COURIER],
    username: null,
    apiKeyHash: null,
    apiKeyCreatedAt: null,
    credentialsChangedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }

  beforeEach(() => {
    mockPrisma = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    }
    repository = new UserRepository(mockPrisma as unknown as PrismaService)
  })

  describe('Spec 0013 AC-3 findUserWithEmailIgnoringCase', () => {
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

  describe('Spec 0037: findByApiKeyHash (AC-6)', () => {
    test('looks up user by apiKeyHash via findUnique and returns domain entity', async () => {
      const partnerUserRecord = {
        ...sampleUserRecord,
        id: 'user-partner-1',
        role: [EnumUserRole.PARTNER],
        apiKeyHash: 'hash-abc-123',
        apiKeyCreatedAt: new Date('2026-11-18T10:00:00Z'),
      }
      mockPrisma.user.findUnique.mockResolvedValue(partnerUserRecord)

      const result = await repository.findByApiKeyHash('hash-abc-123')

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { apiKeyHash: 'hash-abc-123' },
      })
      expect(result).toBeInstanceOf(UserEntity)
      expect(result?.id).toBe('user-partner-1')
    })

    test('returns null when no user matches apiKeyHash', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)

      const result = await repository.findByApiKeyHash('unknown-hash')

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { apiKeyHash: 'unknown-hash' },
      })
      expect(result).toBeNull()
    })
  })

  describe('Spec 0037: replaceApiKeyHash (AC-3, AC-12)', () => {
    test('when user has an existing key: updates conditionally and returns replaced: true without calling update', async () => {
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 })
      const createdAt = new Date('2026-11-18T12:00:00Z')

      const result = await repository.replaceApiKeyHash('user-1', 'new-hash-456', createdAt)

      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', apiKeyHash: { not: null } },
        data: { apiKeyHash: 'new-hash-456', apiKeyCreatedAt: createdAt },
      })
      expect(mockPrisma.user.update).not.toHaveBeenCalled()
      expect(result).toEqual({ replaced: true })
    })

    test('when user has no existing key: updateMany matches 0 rows, calls update, and returns replaced: false', async () => {
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 })
      mockPrisma.user.update.mockResolvedValue({})
      const createdAt = new Date('2026-11-18T12:00:00Z')

      const result = await repository.replaceApiKeyHash('user-1', 'new-hash-456', createdAt)

      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', apiKeyHash: { not: null } },
        data: { apiKeyHash: 'new-hash-456', apiKeyCreatedAt: createdAt },
      })
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { apiKeyHash: 'new-hash-456', apiKeyCreatedAt: createdAt },
      })
      expect(result).toEqual({ replaced: false })
    })
  })

  describe('Spec 0037: removeApiKey (AC-4, AC-12)', () => {
    test('nulls apiKeyHash and apiKeyCreatedAt where apiKeyHash is not null; returns removed: true when key existed', async () => {
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 })

      const result = await repository.removeApiKey('user-1')

      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', apiKeyHash: { not: null } },
        data: { apiKeyHash: null, apiKeyCreatedAt: null },
      })
      expect(result).toEqual({ removed: true })
    })

    test('returns removed: false when user had no key to remove (count: 0)', async () => {
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 })

      const result = await repository.removeApiKey('user-1')

      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', apiKeyHash: { not: null } },
        data: { apiKeyHash: null, apiKeyCreatedAt: null },
      })
      expect(result).toEqual({ removed: false })
    })
  })

  describe('Spec 0037: setPasswordAndReplaceApiKey (AC-1)', () => {
    test('executes in a single transaction: updates password and conditionally replaces key where one existed', async () => {
      const now = new Date('2026-11-18T12:00:00Z')
      const updatePromise = Promise.resolve({ id: 'user-1' })
      const updateManyPromise = Promise.resolve({ count: 1 })
      mockPrisma.user.update.mockReturnValue(updatePromise)
      mockPrisma.user.updateMany.mockReturnValue(updateManyPromise)
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'user-1' },
        { count: 1 },
      ])

      const result = await repository.setPasswordAndReplaceApiKey(
        'user-1',
        'hashed-new-pw',
        now,
        'new-api-key-hash'
      )

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { password: 'hashed-new-pw', credentialsChangedAt: now },
      })
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', apiKeyHash: { not: null } },
        data: { apiKeyHash: 'new-api-key-hash', apiKeyCreatedAt: now },
      })
      expect(mockPrisma.$transaction).toHaveBeenCalledWith([
        updatePromise,
        updateManyPromise,
      ])
      expect(result).toEqual({ apiKeyReplaced: true })
    })

    test('returns apiKeyReplaced: false when user had no key (updateMany count: 0)', async () => {
      const now = new Date('2026-11-18T12:00:00Z')
      const updatePromise = Promise.resolve({ id: 'user-1' })
      const updateManyPromise = Promise.resolve({ count: 0 })
      mockPrisma.user.update.mockReturnValue(updatePromise)
      mockPrisma.user.updateMany.mockReturnValue(updateManyPromise)
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'user-1' },
        { count: 0 },
      ])

      const result = await repository.setPasswordAndReplaceApiKey(
        'user-1',
        'hashed-new-pw',
        now,
        'new-api-key-hash'
      )

      expect(result).toEqual({ apiKeyReplaced: false })
    })
  })

  describe('Spec 0054: setLanguage (AC-1, AC-2)', () => {
    test('updates user language column with the provided language', async () => {
      mockPrisma.user.update.mockResolvedValue({ id: 'user-1', language: 'en' })

      await repository.setLanguage('user-1', 'en')

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { language: 'en' },
        select: { id: true },
      })
    })
  })
})
