import { EnumUserRole } from '@prisma/types'
import { AuthDomainService } from './auth.domain.service'
import { CREDENTIALS_CHANGED_MESSAGE } from './credentials-change'
import { UserEntity } from '../user/entities/user.entity'
import * as errors from '../../errors'

describe('AuthDomainService (Spec 0013 AC-5, AC-7, AC-8)', () => {
  let service: AuthDomainService
  let mockUserDomainService: any
  let mockCourierDomainService: any
  let mockPartnerDomainService: any
  let mockPasswordService: any
  let mockTokenService: any
  let mockAblyService: any

  const makeUser = (overrides: Partial<UserEntity> = {}): UserEntity =>
    new UserEntity({
      id: 'user-1',
      email: 'rider@example.com',
      password: 'hashed-password-123',
      role: [EnumUserRole.COURIER],
      username: null,
      apiKey: null,
      credentialsChangedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    })

  beforeEach(() => {
    mockUserDomainService = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findUserWithEmail: jest.fn(),
    }
    mockCourierDomainService = {
      getByUserId: jest.fn(),
    }
    mockPartnerDomainService = {
      getByUserId: jest.fn(),
    }
    mockPasswordService = {
      compare: jest.fn(),
      hash: jest.fn(),
    }
    mockTokenService = {
      decodeToken: jest.fn(),
      decodeRefreshToken: jest.fn(),
      createEmailAuthSession: jest.fn(),
    }
    mockAblyService = {
      createToken: jest.fn(),
    }

    service = new AuthDomainService(
      mockUserDomainService,
      mockCourierDomainService,
      mockPartnerDomainService,
      mockPasswordService,
      mockTokenService,
      mockAblyService
    )
  })

  describe('AC-5: userForAuthorizationHeader token cut off', () => {
    test('throws 401 UnauthorizedException with CREDENTIALS_CHANGED_MESSAGE when token iat is before credentialsChangedAt', async () => {
      const changeDate = new Date('2026-11-01T12:00:10.000Z')
      const changeSeconds = Math.floor(changeDate.getTime() / 1000)
      const user = makeUser({ credentialsChangedAt: changeDate })

      mockTokenService.decodeToken.mockReturnValue({
        sub: user.id,
        email: user.email,
        iat: changeSeconds - 1, // 1 second before credentials change
      })
      mockUserDomainService.findById.mockResolvedValue(user)

      const call = service.userForAuthorizationHeader('Bearer old-token')
      await expect(call).rejects.toThrow(errors.UnauthorizedException)
      await expect(call).rejects.toThrow(CREDENTIALS_CHANGED_MESSAGE)
    })

    test('returns user when token iat is in the same second as credentialsChangedAt', async () => {
      const changeDate = new Date('2026-11-01T12:00:10.000Z')
      const changeSeconds = Math.floor(changeDate.getTime() / 1000)
      const user = makeUser({ credentialsChangedAt: changeDate })

      mockTokenService.decodeToken.mockReturnValue({
        sub: user.id,
        email: user.email,
        iat: changeSeconds,
      })
      mockUserDomainService.findById.mockResolvedValue(user)

      const result = await service.userForAuthorizationHeader('Bearer same-second-token')
      expect(result).toBe(user)
    })

    test('returns user when token iat is after credentialsChangedAt', async () => {
      const changeDate = new Date('2026-11-01T12:00:10.000Z')
      const changeSeconds = Math.floor(changeDate.getTime() / 1000)
      const user = makeUser({ credentialsChangedAt: changeDate })

      mockTokenService.decodeToken.mockReturnValue({
        sub: user.id,
        email: user.email,
        iat: changeSeconds + 60,
      })
      mockUserDomainService.findById.mockResolvedValue(user)

      const result = await service.userForAuthorizationHeader('Bearer new-token')
      expect(result).toBe(user)
    })

    test('returns user when credentialsChangedAt is null (never changed)', async () => {
      const user = makeUser({ credentialsChangedAt: null })

      mockTokenService.decodeToken.mockReturnValue({
        sub: user.id,
        email: user.email,
        iat: 123456,
      })
      mockUserDomainService.findById.mockResolvedValue(user)

      const result = await service.userForAuthorizationHeader('Bearer valid-token')
      expect(result).toBe(user)
    })
  })

  describe('AC-5: userForRefreshToken token cut off', () => {
    test('throws 401 UnauthorizedException with CREDENTIALS_CHANGED_MESSAGE when refresh token iat is before credentialsChangedAt', async () => {
      const changeDate = new Date('2026-11-01T12:00:10.000Z')
      const changeSeconds = Math.floor(changeDate.getTime() / 1000)
      const user = makeUser({ credentialsChangedAt: changeDate })

      mockTokenService.decodeRefreshToken.mockReturnValue({
        sub: user.id,
        email: user.email,
        iat: changeSeconds - 5,
      })
      mockUserDomainService.findById.mockResolvedValue(user)

      const call = service.userForRefreshToken('Bearer old-refresh-token')
      await expect(call).rejects.toThrow(errors.UnauthorizedException)
      await expect(call).rejects.toThrow(CREDENTIALS_CHANGED_MESSAGE)
    })

    test('returns user when refresh token iat is equal to or after credentialsChangedAt', async () => {
      const changeDate = new Date('2026-11-01T12:00:10.000Z')
      const changeSeconds = Math.floor(changeDate.getTime() / 1000)
      const user = makeUser({ credentialsChangedAt: changeDate })

      mockTokenService.decodeRefreshToken.mockReturnValue({
        sub: user.id,
        email: user.email,
        iat: changeSeconds + 10,
      })
      mockUserDomainService.findById.mockResolvedValue(user)

      const result = await service.userForRefreshToken('Bearer new-refresh-token')
      expect(result).toBe(user)
    })

    test('returns user when user credentialsChangedAt is null', async () => {
      const user = makeUser({ credentialsChangedAt: null })

      mockTokenService.decodeRefreshToken.mockReturnValue({
        sub: user.id,
        email: user.email,
        iat: 100000,
      })
      mockUserDomainService.findById.mockResolvedValue(user)

      const result = await service.userForRefreshToken('Bearer valid-refresh-token')
      expect(result).toBe(user)
    })
  })

  describe('AC-8: loginWithEmail (case fallback and payload email)', () => {
    test('finds user by email exactly as typed and signs token with user.email', async () => {
      const user = makeUser({ email: 'Courier@Domain.com' })
      mockUserDomainService.findByEmail.mockResolvedValue(user)
      mockPasswordService.compare.mockResolvedValue(true)
      mockTokenService.createEmailAuthSession.mockResolvedValue({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
      })

      const result = await service.loginWithEmail({
        email: 'Courier@Domain.com',
        password: 'plainPassword123',
      })

      // Typed lookup first
      expect(mockUserDomainService.findByEmail).toHaveBeenCalledTimes(1)
      expect(mockUserDomainService.findByEmail).toHaveBeenCalledWith('Courier@Domain.com')
      // Session carries stored email
      expect(mockTokenService.createEmailAuthSession).toHaveBeenCalledWith({
        sub: user.id,
        email: 'Courier@Domain.com',
        role: user.role,
      })
      expect(result.user).toBe(user)
    })

    test('when typed lookup fails, tries trimmed lower cased email and signs token with stored user.email', async () => {
      const user = makeUser({ email: 'rider@example.com' })
      const notFoundError = new Error('No User found')
      notFoundError.name = 'NotFoundError'

      // First lookup with typed email fails with NotFoundError (isRecordNotFoundError)
      mockUserDomainService.findByEmail.mockImplementation((emailToFind: string) => {
        if (emailToFind === 'rider@example.com') {
          return Promise.resolve(user)
        }
        return Promise.reject(notFoundError)
      })
      mockPasswordService.compare.mockResolvedValue(true)
      mockTokenService.createEmailAuthSession.mockResolvedValue({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
      })

      const typedInput = '  RIDER@EXAMPLE.COM  '
      const result = await service.loginWithEmail({
        email: typedInput,
        password: 'plainPassword123',
      })

      // Two lookups: first as typed, then trimmed lower cased
      expect(mockUserDomainService.findByEmail).toHaveBeenCalledTimes(2)
      expect(mockUserDomainService.findByEmail).toHaveBeenNthCalledWith(1, typedInput)
      expect(mockUserDomainService.findByEmail).toHaveBeenNthCalledWith(2, 'rider@example.com')

      // Token carries user.email (stored), NOT typedInput
      expect(mockTokenService.createEmailAuthSession).toHaveBeenCalledWith({
        sub: user.id,
        email: 'rider@example.com',
        role: user.role,
      })
      expect(result.user).toBe(user)
    })

    test('throws ForbiddenException when neither typed nor normalized email matches', async () => {
      const notFoundError = new Error('No User found')
      notFoundError.name = 'NotFoundError'
      mockUserDomainService.findByEmail.mockRejectedValue(notFoundError)

      await expect(
        service.loginWithEmail({
          email: 'unknown@example.com',
          password: 'wrongPassword',
        })
      ).rejects.toThrow(errors.ForbiddenException)
    })
  })

  describe('AC-7: registerCourier removal', () => {
    test('AuthDomainService has no registerCourier method', () => {
      expect((service as any).registerCourier).toBeUndefined()
    })
  })
})
