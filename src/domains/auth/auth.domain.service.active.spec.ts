import { EnumUserRole } from '@prisma/types'
import { AuthDomainService } from './auth.domain.service'
import { CREDENTIALS_CHANGED_MESSAGE, accountDeactivatedMessage } from './credentials-change'
import { API_KEY_DOES_NOT_WORK_MESSAGE, hashApiKey } from './api-key'
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
      apiKeyHash: null,
      apiKeyCreatedAt: null,
      credentialsChangedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    })

  beforeEach(() => {
    mockUserDomainService = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByApiKeyHash: jest.fn(),
      findUserWithEmail: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      updateMe: jest.fn(),
      replaceApiKeyHash: jest.fn(),
    }
    mockCourierDomainService = {
      getByUserId: jest.fn(),
      // Spec 0051: every door asks whether the rider's account is deactivated. Active unless a test says so.
      isUserDeactivated: jest.fn().mockResolvedValue(false),
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
    test('throws 401 CredentialsChangedException (code CREDENTIALS_CHANGED) with CREDENTIALS_CHANGED_MESSAGE when token iat is before credentialsChangedAt', async () => {
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
      // Spec 0051 (cross check 3): its own code, so the app can say why the session ended. Still a 401.
      await expect(call).rejects.toThrow(errors.CredentialsChangedException)
      await expect(call).rejects.toThrow(CREDENTIALS_CHANGED_MESSAGE)
      await expect(call).rejects.toMatchObject({ code: errors.ErrorCode.CREDENTIALS_CHANGED, statusCode: 401 })
      expect(CREDENTIALS_CHANGED_MESSAGE).toBe('Your password or login email was changed. Log in again.')
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
    test('throws 401 CredentialsChangedException (code CREDENTIALS_CHANGED) with CREDENTIALS_CHANGED_MESSAGE when refresh token iat is before credentialsChangedAt', async () => {
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
      // Spec 0051 (cross check 3): the app's renewal reads this code where the refresh is refused.
      await expect(call).rejects.toThrow(errors.CredentialsChangedException)
      await expect(call).rejects.toThrow(CREDENTIALS_CHANGED_MESSAGE)
      await expect(call).rejects.toMatchObject({ code: errors.ErrorCode.CREDENTIALS_CHANGED, statusCode: 401 })
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

  describe('Scope row 113 review fix (commit 7b20088): strips "bearer ", "BEARER " and "Bearer\\t" and decodes the bare token', () => {
    describe('userForAuthorizationHeader', () => {
      const spellings = [
        { header: 'bearer token-lower-123', bareToken: 'token-lower-123', desc: 'lowercase "bearer "' },
        { header: 'BEARER token-upper-456', bareToken: 'token-upper-456', desc: 'uppercase "BEARER "' },
        { header: 'Bearer\ttoken-tab-789', bareToken: 'token-tab-789', desc: 'tab separated "Bearer\\t"' },
      ]

      spellings.forEach(({ header, bareToken, desc }) => {
        test(`strips ${desc} and passes the bare token to decodeToken`, async () => {
          const user = makeUser()
          mockTokenService.decodeToken.mockReturnValue({
            sub: user.id,
            email: user.email,
            iat: 123456,
          })
          mockUserDomainService.findById.mockResolvedValue(user)

          const result = await service.userForAuthorizationHeader(header)

          expect(mockTokenService.decodeToken).toHaveBeenCalledTimes(1)
          expect(mockTokenService.decodeToken).toHaveBeenCalledWith(bareToken)
          expect(result).toBe(user)
        })
      })
    })

    describe('userForRefreshToken', () => {
      const spellings = [
        { header: 'bearer refresh-lower-123', bareToken: 'refresh-lower-123', desc: 'lowercase "bearer "' },
        { header: 'BEARER refresh-upper-456', bareToken: 'refresh-upper-456', desc: 'uppercase "BEARER "' },
        { header: 'Bearer\trefresh-tab-789', bareToken: 'refresh-tab-789', desc: 'tab separated "Bearer\\t"' },
      ]

      spellings.forEach(({ header, bareToken, desc }) => {
        test(`strips ${desc} and passes the bare token to decodeRefreshToken`, async () => {
          const user = makeUser()
          mockTokenService.decodeRefreshToken.mockReturnValue({
            sub: user.id,
            email: user.email,
            iat: 123456,
          })
          mockUserDomainService.findById.mockResolvedValue(user)

          const result = await service.userForRefreshToken(header)

          expect(mockTokenService.decodeRefreshToken).toHaveBeenCalledTimes(1)
          expect(mockTokenService.decodeRefreshToken).toHaveBeenCalledWith(bareToken)
          expect(result).toBe(user)
        })
      })
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

      // Two lookups: first as typed, then trimmed lower cased only because typed lookup found no user
      expect(mockUserDomainService.findByEmail).toHaveBeenCalledTimes(2)
      expect(mockUserDomainService.findByEmail).toHaveBeenNthCalledWith(1, typedInput)
      expect(mockUserDomainService.findUserWithEmail).toHaveBeenCalledWith(typedInput)
      expect(mockUserDomainService.findByEmail).toHaveBeenNthCalledWith(2, 'rider@example.com')

      // Token carries user.email (stored), NOT typedInput
      expect(mockTokenService.createEmailAuthSession).toHaveBeenCalledWith({
        sub: user.id,
        email: 'rider@example.com',
        role: user.role,
      })
      expect(result.user).toBe(user)
    })

    test('when an account exists with the email exactly as typed but password is wrong, throws ForbiddenException and does NOT try lower cased form (no second password compare)', async () => {
      const typedUser = makeUser({
        id: 'user-typed-capital',
        email: 'Rider@Example.com',
        password: 'hashed-capital-password',
      })
      const lowerUser = makeUser({
        id: 'user-lower',
        email: 'rider@example.com',
        password: 'hashed-lower-password',
      })

      mockUserDomainService.findByEmail.mockImplementation((emailToFind: string) => {
        if (emailToFind === 'Rider@Example.com') return Promise.resolve(typedUser)
        if (emailToFind === 'rider@example.com') return Promise.resolve(lowerUser)
        const notFound = new Error('No User found')
        notFound.name = 'NotFoundError'
        return Promise.reject(notFound)
      })
      // findUserWithEmail confirms an account exists with the typed email
      mockUserDomainService.findUserWithEmail.mockResolvedValue(typedUser)

      // Password matches lowerUser's password, but NOT typedUser's password
      mockPasswordService.compare.mockImplementation((pass: string, hash: string) => {
        if (hash === 'hashed-capital-password') return Promise.resolve(false)
        if (hash === 'hashed-lower-password') return Promise.resolve(true)
        return Promise.resolve(false)
      })

      const call = service.loginWithEmail({
        email: 'Rider@Example.com',
        password: 'submittedPassword',
      })

      await expect(call).rejects.toThrow(errors.ForbiddenException)
      await expect(call).rejects.toThrow('These credentials are incorrect')

      // Exactly one findByEmail call for typed email; lower cased form was NOT attempted
      expect(mockUserDomainService.findByEmail).toHaveBeenCalledTimes(1)
      expect(mockUserDomainService.findByEmail).toHaveBeenCalledWith('Rider@Example.com')
      expect(mockUserDomainService.findByEmail).not.toHaveBeenCalledWith('rider@example.com')

      // findUserWithEmail was checked for the typed email to confirm it exists
      expect(mockUserDomainService.findUserWithEmail).toHaveBeenCalledWith('Rider@Example.com')

      // Password comparison was only attempted once (for typedUser), never for lowerUser
      expect(mockPasswordService.compare).toHaveBeenCalledTimes(1)
      expect(mockPasswordService.compare).toHaveBeenCalledWith('submittedPassword', 'hashed-capital-password')
      expect(mockPasswordService.compare).not.toHaveBeenCalledWith('submittedPassword', 'hashed-lower-password')

      // No token session created
      expect(mockTokenService.createEmailAuthSession).not.toHaveBeenCalled()
    })

    test('when typed email is already lower cased and trimmed, performs one lookup only and never queries findUserWithEmail', async () => {
      const user = makeUser({ email: 'rider@example.com' })
      mockUserDomainService.findByEmail.mockResolvedValue(user)
      mockPasswordService.compare.mockResolvedValue(false)

      const call = service.loginWithEmail({
        email: 'rider@example.com',
        password: 'wrongPassword',
      })

      await expect(call).rejects.toThrow(errors.ForbiddenException)

      // Only one lookup was performed
      expect(mockUserDomainService.findByEmail).toHaveBeenCalledTimes(1)
      expect(mockUserDomainService.findByEmail).toHaveBeenCalledWith('rider@example.com')

      // findUserWithEmail is never called because normalised === email
      expect(mockUserDomainService.findUserWithEmail).not.toHaveBeenCalled()

      // Exactly one compare
      expect(mockPasswordService.compare).toHaveBeenCalledTimes(1)
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

    test('throws ForbiddenException after trying the lower cased form when a mixed case login ("Unknown@Example.com") matches nobody (AC-8)', async () => {
      const notFoundError = new Error('No User found')
      notFoundError.name = 'NotFoundError'
      mockUserDomainService.findByEmail.mockRejectedValue(notFoundError)
      mockUserDomainService.findUserWithEmail.mockResolvedValue(undefined)

      const call = service.loginWithEmail({
        email: 'Unknown@Example.com',
        password: 'wrongPassword',
      })

      await expect(call).rejects.toThrow(errors.ForbiddenException)
      await expect(call).rejects.toThrow('These credentials are incorrect')

      // Verifies fallback: typed email lookup first, check existence, then lower cased lookup
      expect(mockUserDomainService.findByEmail).toHaveBeenCalledTimes(2)
      expect(mockUserDomainService.findByEmail).toHaveBeenNthCalledWith(1, 'Unknown@Example.com')
      expect(mockUserDomainService.findUserWithEmail).toHaveBeenCalledWith('Unknown@Example.com')
      expect(mockUserDomainService.findByEmail).toHaveBeenNthCalledWith(2, 'unknown@example.com')
    })
  })

  describe('AC-7: registerCourier removal', () => {
    test('AuthDomainService has no registerCourier method', () => {
      expect((service as any).registerCourier).toBeUndefined()
    })
  })

  describe('Spec 0037: userForApiKey (AC-6, AC-10)', () => {
    test('hashes sent key with SHA-256 and looks up user by hash', async () => {
      const partnerUser = makeUser({
        id: 'user-partner-1',
        role: [EnumUserRole.PARTNER],
        apiKeyHash: hashApiKey('ock_valid_key_123'),
      })
      mockUserDomainService.findByApiKeyHash.mockResolvedValue(partnerUser)

      const result = await service.userForApiKey('ock_valid_key_123')

      expect(mockUserDomainService.findByApiKeyHash).toHaveBeenCalledTimes(1)
      expect(mockUserDomainService.findByApiKeyHash).toHaveBeenCalledWith(hashApiKey('ock_valid_key_123'))
      expect(result).toBe(partnerUser)
    })

    test('throws 401 UnauthorizedException with API_KEY_DOES_NOT_WORK_MESSAGE when key is unknown (AC-10)', async () => {
      mockUserDomainService.findByApiKeyHash.mockResolvedValue(null)

      const call = service.userForApiKey('ock_unknown_key_999')

      await expect(call).rejects.toThrow(errors.UnauthorizedException)
      await expect(call).rejects.toThrow(API_KEY_DOES_NOT_WORK_MESSAGE)
      expect(mockUserDomainService.findByApiKeyHash).toHaveBeenCalledWith(hashApiKey('ock_unknown_key_999'))
    })

    test('default empty string key hashes empty string and throws 401 if not found', async () => {
      mockUserDomainService.findByApiKeyHash.mockResolvedValue(null)

      const call = service.userForApiKey()

      await expect(call).rejects.toThrow(errors.UnauthorizedException)
      await expect(call).rejects.toThrow(API_KEY_DOES_NOT_WORK_MESSAGE)
      expect(mockUserDomainService.findByApiKeyHash).toHaveBeenCalledWith(hashApiKey(''))
    })
  })

  describe('Spec 0037: loginPartnerWithUsername (AC-2, AC-8)', () => {
    test('successful partner login creates session without generating or storing an API key', async () => {
      const partnerUser = makeUser({
        id: 'user-partner-1',
        email: 'partner@volos.gr',
        role: [EnumUserRole.PARTNER],
      })
      mockUserDomainService.findByEmail.mockResolvedValue(partnerUser)
      mockPasswordService.compare.mockResolvedValue(true)
      mockTokenService.createEmailAuthSession.mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      })

      const result = await service.loginPartnerWithUsername({
        email: 'partner@volos.gr',
        password: 'valid-password',
      })

      expect(result.user).toBe(partnerUser)
      expect(result.session).toBeDefined()
      // ensurePartnerApiKey or generateApiKey are not called / do not exist
      expect((service as any).ensurePartnerApiKey).toBeUndefined()
      expect((service as any).generateApiKey).toBeUndefined()
      // Spec 0037, AC-8: signing in makes no user write (no update, updateMe, or replaceApiKeyHash)
      expect(mockUserDomainService.update).not.toHaveBeenCalled()
      expect(mockUserDomainService.updateMe).not.toHaveBeenCalled()
      expect(mockUserDomainService.replaceApiKeyHash).not.toHaveBeenCalled()
    })

    test('throws ForbiddenException when user does not have PARTNER role', async () => {
      const courierUser = makeUser({
        id: 'user-courier-1',
        role: [EnumUserRole.COURIER],
      })
      mockUserDomainService.findByEmail.mockResolvedValue(courierUser)
      mockPasswordService.compare.mockResolvedValue(true)

      const call = service.loginPartnerWithUsername({
        email: 'rider@volos.gr',
        password: 'valid-password',
      })

      await expect(call).rejects.toThrow(errors.ForbiddenException)
      await expect(call).rejects.toThrow('You are not allowed to login as partner')
    })
  })

  describe('createSessionForUser (row 17, spec 0039 AC-10)', () => {
    test('creates email auth session with sub, email and role for user', async () => {
      const user = makeUser({
        id: 'user-courier-99',
        email: 'rider99@volos.gr',
        role: [EnumUserRole.COURIER],
      })

      const expectedSession = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        refreshExpiresIn: 7200,
      }
      mockTokenService.createEmailAuthSession.mockResolvedValue(expectedSession)

      const result = await service.createSessionForUser(user)

      expect(mockTokenService.createEmailAuthSession).toHaveBeenCalledWith({
        sub: 'user-courier-99',
        email: 'rider99@volos.gr',
        role: [EnumUserRole.COURIER],
      })
      expect(result).toEqual({
        user,
        session: expectedSession,
      })
    })

    test('handles user with null email by falling back to empty string', async () => {
      const user = makeUser({
        id: 'user-no-email',
        email: null,
        role: [EnumUserRole.COURIER],
      })
      mockTokenService.createEmailAuthSession.mockResolvedValue({} as any)

      await service.createSessionForUser(user)

      expect(mockTokenService.createEmailAuthSession).toHaveBeenCalledWith({
        sub: 'user-no-email',
        email: '',
        role: [EnumUserRole.COURIER],
      })
    })
  })

  // Spec 0051 (AC-2, AC-11, cross checks 2 and 3): a deactivated rider is refused at every door with 401
  // and the code ACCOUNT_DEACTIVATED, and the sentence ends with how to reach the co-op.
  describe('Spec 0051: a deactivated rider is refused at every door (AC-2, AC-11)', () => {
    const PLAIN_SENTENCE = 'Your account was deactivated by the co-op. If you think this is a mistake, contact the co-op.'

    const expectDeactivatedRefusal = async (call: Promise<unknown>, sentence = PLAIN_SENTENCE) => {
      await expect(call).rejects.toThrow(errors.AccountDeactivatedException)
      await expect(call).rejects.toMatchObject({
        code: errors.ErrorCode.ACCOUNT_DEACTIVATED,
        statusCode: 401,
        message: sentence,
      })
    }

    beforeEach(() => {
      mockCourierDomainService.isUserDeactivated.mockResolvedValue(true)
    })

    test('the two codes exist and are not the generic UNAUTHORIZED', () => {
      expect(errors.ErrorCode.ACCOUNT_DEACTIVATED).toBe('ACCOUNT_DEACTIVATED')
      expect(errors.ErrorCode.CREDENTIALS_CHANGED).toBe('CREDENTIALS_CHANGED')
      expect(new errors.AccountDeactivatedException('x').getStatus()).toBe(401)
      expect(new errors.CredentialsChangedException('x').getStatus()).toBe(401)
    })

    test('login with the right password: 401 ACCOUNT_DEACTIVATED, and no session is made', async () => {
      const user = makeUser()
      mockUserDomainService.findByEmail.mockResolvedValue(user)
      mockPasswordService.compare.mockResolvedValue(true)

      await expectDeactivatedRefusal(service.loginWithEmail({ email: 'rider@example.com', password: 'right-password' }))

      expect(mockCourierDomainService.isUserDeactivated).toHaveBeenCalledWith('user-1')
      expect(mockTokenService.createEmailAuthSession).not.toHaveBeenCalled()
    })

    test('login with a wrong password learns nothing: the usual 403, and the deactivation is never looked up', async () => {
      const user = makeUser()
      mockUserDomainService.findByEmail.mockResolvedValue(user)
      mockUserDomainService.findUserWithEmail.mockResolvedValue(user)
      mockPasswordService.compare.mockResolvedValue(false)

      const call = service.loginWithEmail({ email: 'rider@example.com', password: 'wrong-password' })
      await expect(call).rejects.toThrow(errors.ForbiddenException)
      await expect(call).rejects.toThrow('These credentials are incorrect')

      expect(mockCourierDomainService.isUserDeactivated).not.toHaveBeenCalled()
      expect(mockTokenService.createEmailAuthSession).not.toHaveBeenCalled()
    })

    test('a bearer token: 401 ACCOUNT_DEACTIVATED', async () => {
      const user = makeUser()
      mockTokenService.decodeToken.mockReturnValue({ sub: user.id, email: user.email, iat: 2000000000 })
      mockUserDomainService.findById.mockResolvedValue(user)

      await expectDeactivatedRefusal(service.userForAuthorizationHeader('Bearer a-token'))
      expect(mockCourierDomainService.isUserDeactivated).toHaveBeenCalledWith('user-1')
    })

    test('a bearer token from before the credentials change still answers ACCOUNT_DEACTIVATED, not CREDENTIALS_CHANGED (checked first)', async () => {
      // A deactivation stamps credentialsChangedAt, so every old token meets both rules; the rider must
      // be told the real reason.
      const changeDate = new Date('2026-11-21T09:00:00.000Z')
      const user = makeUser({ credentialsChangedAt: changeDate })
      mockTokenService.decodeToken.mockReturnValue({
        sub: user.id,
        email: user.email,
        iat: Math.floor(changeDate.getTime() / 1000) - 3600,
      })
      mockUserDomainService.findById.mockResolvedValue(user)

      await expectDeactivatedRefusal(service.userForAuthorizationHeader('Bearer old-token'))
    })

    test('a refresh token (the guard): 401 ACCOUNT_DEACTIVATED, also when it predates the credentials change', async () => {
      const changeDate = new Date('2026-11-21T09:00:00.000Z')
      const user = makeUser({ credentialsChangedAt: changeDate })
      mockTokenService.decodeRefreshToken.mockReturnValue({
        sub: user.id,
        email: user.email,
        iat: Math.floor(changeDate.getTime() / 1000) - 3600,
      })
      mockUserDomainService.findById.mockResolvedValue(user)

      await expectDeactivatedRefusal(service.userForRefreshToken('Bearer old-refresh-token'))
    })

    test('refreshTokens (the renewal itself): 401 ACCOUNT_DEACTIVATED, and no new session is made', async () => {
      const user = makeUser()
      mockTokenService.decodeRefreshToken.mockReturnValue({ sub: user.id, email: user.email, iat: 2000000000 })
      mockUserDomainService.findById.mockResolvedValue(user)

      await expectDeactivatedRefusal(service.refreshTokens(user.id, 'a-refresh-token'))
      expect(mockTokenService.createEmailAuthSession).not.toHaveBeenCalled()
    })

    test('createSessionForUser (a reset by emailed code): 401 ACCOUNT_DEACTIVATED, and no session is made', async () => {
      await expectDeactivatedRefusal(service.createSessionForUser(makeUser()))
      expect(mockTokenService.createEmailAuthSession).not.toHaveBeenCalled()
    })

    test('the sentence ends with the dispatch phone when the co-op has set one', async () => {
      const mockConfigDomainService = {
        instanceConfig: { getDispatchPhoneNumber: jest.fn().mockResolvedValue('+30 24210 12345') },
      }
      service = new AuthDomainService(
        mockUserDomainService,
        mockCourierDomainService,
        mockPartnerDomainService,
        mockPasswordService,
        mockTokenService,
        mockAblyService,
        mockConfigDomainService as any
      )

      const sentence = accountDeactivatedMessage('+30 24210 12345')
      expect(sentence).toBe(
        'Your account was deactivated by the co-op. If you think this is a mistake, call the co-op on +30 24210 12345.'
      )
      await expectDeactivatedRefusal(service.createSessionForUser(makeUser()), sentence)
    })

    test('the refusal still goes out, in plain words, when the phone cannot be read', async () => {
      const mockConfigDomainService = {
        instanceConfig: { getDispatchPhoneNumber: jest.fn().mockRejectedValue(new Error('config table down')) },
      }
      service = new AuthDomainService(
        mockUserDomainService,
        mockCourierDomainService,
        mockPartnerDomainService,
        mockPasswordService,
        mockTokenService,
        mockAblyService,
        mockConfigDomainService as any
      )

      await expectDeactivatedRefusal(service.createSessionForUser(makeUser()))
    })

    test('a user with no rider (an admin, a restaurant) is never asked and passes every door', async () => {
      const admin = makeUser({ id: 'admin-1', email: 'admin@coop.gr', role: [EnumUserRole.ADMIN] })
      mockTokenService.decodeToken.mockReturnValue({ sub: admin.id, email: admin.email, iat: 2000000000 })
      mockTokenService.decodeRefreshToken.mockReturnValue({ sub: admin.id, email: admin.email, iat: 2000000000 })
      mockTokenService.createEmailAuthSession.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' })
      mockUserDomainService.findById.mockResolvedValue(admin)

      await expect(service.userForAuthorizationHeader('Bearer admin-token')).resolves.toBe(admin)
      await expect(service.userForRefreshToken('Bearer admin-refresh')).resolves.toBe(admin)
      await expect(service.createSessionForUser(admin)).resolves.toMatchObject({ user: admin })
      expect(mockCourierDomainService.isUserDeactivated).not.toHaveBeenCalled()
    })
  })

  describe('Spec 0051: an active rider passes every door', () => {
    test('login, bearer, refresh and a reset session all ask isUserDeactivated and let an active rider in', async () => {
      const user = makeUser()
      mockUserDomainService.findByEmail.mockResolvedValue(user)
      mockUserDomainService.findById.mockResolvedValue(user)
      mockPasswordService.compare.mockResolvedValue(true)
      mockTokenService.decodeToken.mockReturnValue({ sub: user.id, email: user.email, iat: 2000000000 })
      mockTokenService.decodeRefreshToken.mockReturnValue({ sub: user.id, email: user.email, iat: 2000000000 })
      mockTokenService.createEmailAuthSession.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' })

      await service.loginWithEmail({ email: 'rider@example.com', password: 'right-password' })
      await service.userForAuthorizationHeader('Bearer a-token')
      await service.userForRefreshToken('Bearer a-refresh-token')
      await service.refreshTokens(user.id, 'a-refresh-token')
      await service.createSessionForUser(user)

      expect(mockCourierDomainService.isUserDeactivated).toHaveBeenCalledTimes(5)
      expect(mockCourierDomainService.isUserDeactivated).toHaveBeenCalledWith('user-1')
    })
  })
})
