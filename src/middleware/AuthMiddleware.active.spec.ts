import { AuthMiddleware, MIXED_CREDENTIALS_MESSAGE } from './AuthMiddleware'
import { CREDENTIALS_CHANGED_MESSAGE } from '../domains/auth/credentials-change'
import { UnauthorizedException } from '../errors'
import { EnumUserRole } from '@prisma/types'
import { UserEntity } from '../domains/user/entities/user.entity'

describe('AuthMiddleware', () => {
  let middleware: AuthMiddleware
  let mockAuthService: any
  let mockCourierDomainService: any
  let mockPartnerDomainService: any

  // Sample partner and courier users for testing credential resolution
  const mockPartnerUser = new UserEntity({
    id: 'user-partner-1',
    email: 'nosh@coop.gr',
    password: 'hash',
    role: [EnumUserRole.PARTNER],
    username: 'nosh',
    apiKey: 'nosh-api-key-123',
    credentialsChangedAt: null,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  const mockCourierUser = new UserEntity({
    id: 'user-courier-1',
    email: 'rider@coop.gr',
    password: 'hash',
    role: [EnumUserRole.COURIER],
    username: 'rider1',
    apiKey: null,
    credentialsChangedAt: null,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  const mockPartnerEntity = { id: 'partner-nosh-id', userId: 'user-partner-1' }
  const mockCourierEntity = { id: 'courier-rider-id', userId: 'user-courier-1' }

  beforeEach(() => {
    mockAuthService = {
      userForAuthorizationHeader: jest.fn(),
      userForRefreshToken: jest.fn(),
      userForApiKey: jest.fn(),
    }
    mockCourierDomainService = {
      getByUserId: jest.fn(),
    }
    mockPartnerDomainService = {
      getByUserId: jest.fn(),
    }

    middleware = new AuthMiddleware(
      mockAuthService,
      mockCourierDomainService,
      mockPartnerDomainService
    )
  })

  describe('Spec 0013 AC-5: passes 401 credentials changed on', () => {
    test('passes 401 UnauthorizedException with CREDENTIALS_CHANGED_MESSAGE on when authorization header token was issued before credentials change', async () => {
      const credentialsChangedErr = new UnauthorizedException(CREDENTIALS_CHANGED_MESSAGE)
      mockAuthService.userForAuthorizationHeader.mockRejectedValue(credentialsChangedErr)

      const req: any = {
        headers: {
          authorization: 'Bearer revoked-token',
        },
        query: {},
      }
      const res: any = {}
      const next = jest.fn()

      // Silence console.log from AuthMiddleware catch block
      jest.spyOn(console, 'log').mockImplementation(() => {})

      await middleware.use(req, res, next)

      expect(next).toHaveBeenCalledTimes(1)
      const passedError = next.mock.calls[0][0]
      expect(passedError).toBe(credentialsChangedErr)
      expect(passedError).toBeInstanceOf(UnauthorizedException)
      expect(passedError.getStatus()).toBe(401)
      expect(passedError.message).toBe(CREDENTIALS_CHANGED_MESSAGE)
    })

    test('passes 401 UnauthorizedException on when x-refresh-token was issued before credentials change', async () => {
      const credentialsChangedErr = new UnauthorizedException(CREDENTIALS_CHANGED_MESSAGE)
      mockAuthService.userForRefreshToken.mockRejectedValue(credentialsChangedErr)

      const req: any = {
        headers: {
          'x-refresh-token': 'revoked-refresh-token',
        },
        query: {},
      }
      const res: any = {}
      const next = jest.fn()

      jest.spyOn(console, 'log').mockImplementation(() => {})

      await middleware.use(req, res, next)

      expect(next).toHaveBeenCalledTimes(1)
      const passedError = next.mock.calls[0][0]
      expect(passedError).toBe(credentialsChangedErr)
      expect(passedError.getStatus()).toBe(401)
      expect(passedError.message).toBe(CREDENTIALS_CHANGED_MESSAGE)
    })

    test('attaches currentUser and calls next() without error for valid authorization header', async () => {
      const user = new UserEntity({
        id: 'admin-1',
        email: 'admin@coop.gr',
        password: 'hash',
        role: [EnumUserRole.ADMIN],
        username: null,
        apiKey: null,
        credentialsChangedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      mockAuthService.userForAuthorizationHeader.mockResolvedValue(user)

      const req: any = {
        headers: {
          authorization: 'Bearer valid-token',
        },
        query: {},
      }
      const res: any = {}
      const next = jest.fn()

      await middleware.use(req, res, next)

      expect(req.currentUser).toBe(user)
      expect(next).toHaveBeenCalledWith()
    })
  })

  describe('Scope row 113: refuses mixed credentials (API key beside login token)', () => {
    test('x-api-key header + "Bearer <token>": next called with 401 UnauthorizedException(MIXED_CREDENTIALS_MESSAGE), no lookups performed, req.currentUser unset', async () => {
      const req: any = {
        headers: {
          'x-api-key': 'nosh-api-key-123',
          authorization: 'Bearer rider-jwt-token',
        },
        query: {},
      }
      const res: any = {}
      const next = jest.fn()

      await middleware.use(req, res, next)

      // (1) Request is refused with 401 UnauthorizedException carrying MIXED_CREDENTIALS_MESSAGE
      expect(next).toHaveBeenCalledTimes(1)
      const passedError = next.mock.calls[0][0]
      expect(passedError).toBeInstanceOf(UnauthorizedException)
      expect(passedError.getStatus()).toBe(401)
      expect(passedError.message).toBe(MIXED_CREDENTIALS_MESSAGE)

      // (2) NONE of userForApiKey, userForAuthorizationHeader, userForRefreshToken is called
      expect(mockAuthService.userForApiKey).not.toHaveBeenCalled()
      expect(mockAuthService.userForAuthorizationHeader).not.toHaveBeenCalled()
      expect(mockAuthService.userForRefreshToken).not.toHaveBeenCalled()
      expect(mockPartnerDomainService.getByUserId).not.toHaveBeenCalled()
      expect(mockCourierDomainService.getByUserId).not.toHaveBeenCalled()

      // (3) req.currentUser stays unset
      expect(req.currentUser).toBeUndefined()
      expect(req.currentPartner).toBeUndefined()
      expect(req.currentCourier).toBeUndefined()
    })

    test('?api_key query + Bearer: next called with 401 UnauthorizedException(MIXED_CREDENTIALS_MESSAGE), no lookups performed, req.currentUser unset', async () => {
      const req: any = {
        headers: {
          authorization: 'Bearer valid-jwt-token',
        },
        query: {
          api_key: 'nosh-api-key-123',
        },
      }
      const res: any = {}
      const next = jest.fn()

      await middleware.use(req, res, next)

      expect(next).toHaveBeenCalledTimes(1)
      const passedError = next.mock.calls[0][0]
      expect(passedError).toBeInstanceOf(UnauthorizedException)
      expect(passedError.getStatus()).toBe(401)
      expect(passedError.message).toBe(MIXED_CREDENTIALS_MESSAGE)

      expect(mockAuthService.userForApiKey).not.toHaveBeenCalled()
      expect(mockAuthService.userForAuthorizationHeader).not.toHaveBeenCalled()
      expect(mockAuthService.userForRefreshToken).not.toHaveBeenCalled()
      expect(req.currentUser).toBeUndefined()
    })

    test('x-api-key + x-refresh-token: next called with 401 UnauthorizedException(MIXED_CREDENTIALS_MESSAGE), no lookups performed, req.currentUser unset', async () => {
      const req: any = {
        headers: {
          'x-api-key': 'nosh-api-key-123',
          'x-refresh-token': 'valid-refresh-token-value',
        },
        query: {},
      }
      const res: any = {}
      const next = jest.fn()

      await middleware.use(req, res, next)

      expect(next).toHaveBeenCalledTimes(1)
      const passedError = next.mock.calls[0][0]
      expect(passedError).toBeInstanceOf(UnauthorizedException)
      expect(passedError.getStatus()).toBe(401)
      expect(passedError.message).toBe(MIXED_CREDENTIALS_MESSAGE)

      expect(mockAuthService.userForApiKey).not.toHaveBeenCalled()
      expect(mockAuthService.userForAuthorizationHeader).not.toHaveBeenCalled()
      expect(mockAuthService.userForRefreshToken).not.toHaveBeenCalled()
      expect(req.currentUser).toBeUndefined()
    })

    test('?api_key query + x-refresh-token: next called with 401 UnauthorizedException(MIXED_CREDENTIALS_MESSAGE), no lookups performed, req.currentUser unset', async () => {
      const req: any = {
        headers: {
          'x-refresh-token': 'valid-refresh-token-value',
        },
        query: {
          api_key: 'nosh-api-key-123',
        },
      }
      const res: any = {}
      const next = jest.fn()

      await middleware.use(req, res, next)

      expect(next).toHaveBeenCalledTimes(1)
      const passedError = next.mock.calls[0][0]
      expect(passedError).toBeInstanceOf(UnauthorizedException)
      expect(passedError.getStatus()).toBe(401)
      expect(passedError.message).toBe(MIXED_CREDENTIALS_MESSAGE)

      expect(mockAuthService.userForApiKey).not.toHaveBeenCalled()
      expect(mockAuthService.userForAuthorizationHeader).not.toHaveBeenCalled()
      expect(mockAuthService.userForRefreshToken).not.toHaveBeenCalled()
      expect(req.currentUser).toBeUndefined()
    })

    test('refuses mixed credentials whichever route is targeted (e.g. partner chat messages route)', async () => {
      // Regardless of req.path or req.originalUrl, AuthMiddleware intercepts before any route/guard
      const req: any = {
        headers: {
          'x-api-key': 'nosh-api-key-123',
          authorization: 'Bearer rider-jwt-token',
        },
        query: {},
        originalUrl: '/api/partner/v1/chat/messages',
        path: '/api/partner/v1/chat/messages',
      }
      const res: any = {}
      const next = jest.fn()

      await middleware.use(req, res, next)

      expect(next).toHaveBeenCalledTimes(1)
      const passedError = next.mock.calls[0][0]
      expect(passedError).toBeInstanceOf(UnauthorizedException)
      expect(passedError.getStatus()).toBe(401)
      expect(passedError.message).toBe(MIXED_CREDENTIALS_MESSAGE)
      expect(req.currentUser).toBeUndefined()
      expect(mockAuthService.userForApiKey).not.toHaveBeenCalled()
    })
  })

  describe('Scope row 113: valid unmixed credentials and non-bearer auth work as before', () => {
    test('API key alone in x-api-key header: userForApiKey is called and req.currentUser / currentPartner are set as before (no refusal)', async () => {
      mockAuthService.userForApiKey.mockResolvedValue(mockPartnerUser)
      mockPartnerDomainService.getByUserId.mockResolvedValue(mockPartnerEntity)

      const req: any = {
        headers: {
          'x-api-key': 'nosh-api-key-123',
        },
        query: {},
      }
      const res: any = {}
      const next = jest.fn()

      await middleware.use(req, res, next)

      expect(mockAuthService.userForApiKey).toHaveBeenCalledTimes(1)
      expect(mockAuthService.userForApiKey).toHaveBeenCalledWith('nosh-api-key-123')
      expect(mockAuthService.userForAuthorizationHeader).not.toHaveBeenCalled()
      expect(mockAuthService.userForRefreshToken).not.toHaveBeenCalled()
      expect(mockPartnerDomainService.getByUserId).toHaveBeenCalledWith(mockPartnerUser.id)

      expect(req.currentUser).toBe(mockPartnerUser)
      expect(req.currentPartner).toBe(mockPartnerEntity)
      expect(next).toHaveBeenCalledWith()
    })

    test('API key alone in ?api_key query: userForApiKey is called and req.currentUser / currentPartner are set as before (no refusal)', async () => {
      mockAuthService.userForApiKey.mockResolvedValue(mockPartnerUser)
      mockPartnerDomainService.getByUserId.mockResolvedValue(mockPartnerEntity)

      const req: any = {
        headers: {},
        query: {
          api_key: 'nosh-query-key-456',
        },
      }
      const res: any = {}
      const next = jest.fn()

      await middleware.use(req, res, next)

      expect(mockAuthService.userForApiKey).toHaveBeenCalledTimes(1)
      expect(mockAuthService.userForApiKey).toHaveBeenCalledWith('nosh-query-key-456')
      expect(mockAuthService.userForAuthorizationHeader).not.toHaveBeenCalled()
      expect(mockAuthService.userForRefreshToken).not.toHaveBeenCalled()

      expect(req.currentUser).toBe(mockPartnerUser)
      expect(req.currentPartner).toBe(mockPartnerEntity)
      expect(next).toHaveBeenCalledWith()
    })

    test('Bearer alone: as before (userForAuthorizationHeader called, req.currentUser / currentCourier set, no refusal)', async () => {
      mockAuthService.userForAuthorizationHeader.mockResolvedValue(mockCourierUser)
      mockCourierDomainService.getByUserId.mockResolvedValue(mockCourierEntity)

      const req: any = {
        headers: {
          authorization: 'Bearer rider-access-token',
        },
        query: {},
      }
      const res: any = {}
      const next = jest.fn()

      await middleware.use(req, res, next)

      expect(mockAuthService.userForAuthorizationHeader).toHaveBeenCalledTimes(1)
      expect(mockAuthService.userForAuthorizationHeader).toHaveBeenCalledWith('Bearer rider-access-token')
      expect(mockAuthService.userForApiKey).not.toHaveBeenCalled()
      expect(mockAuthService.userForRefreshToken).not.toHaveBeenCalled()
      expect(mockCourierDomainService.getByUserId).toHaveBeenCalledWith(mockCourierUser.id)

      expect(req.currentUser).toBe(mockCourierUser)
      expect(req.currentCourier).toBe(mockCourierEntity)
      expect(next).toHaveBeenCalledWith()
    })

    test('An Authorization header that is not "Bearer ..." (e.g. "Basic x") beside an API key is not the mixed case: the key path runs as before', async () => {
      mockAuthService.userForApiKey.mockResolvedValue(mockPartnerUser)
      mockPartnerDomainService.getByUserId.mockResolvedValue(mockPartnerEntity)

      const req: any = {
        headers: {
          'x-api-key': 'nosh-api-key-123',
          authorization: 'Basic dXNlcjpwYXNzd29yZA==',
        },
        query: {},
      }
      const res: any = {}
      const next = jest.fn()

      await middleware.use(req, res, next)

      // Not considered mixed because authorization is not "Bearer ..."
      expect(mockAuthService.userForApiKey).toHaveBeenCalledTimes(1)
      expect(mockAuthService.userForApiKey).toHaveBeenCalledWith('nosh-api-key-123')
      expect(mockAuthService.userForAuthorizationHeader).not.toHaveBeenCalled()
      expect(mockAuthService.userForRefreshToken).not.toHaveBeenCalled()

      expect(req.currentUser).toBe(mockPartnerUser)
      expect(req.currentPartner).toBe(mockPartnerEntity)
      expect(next).toHaveBeenCalledWith()
    })

    test('No credential at all: next() with no error, nothing looked up', async () => {
      const req: any = {
        headers: {},
        query: {},
      }
      const res: any = {}
      const next = jest.fn()

      await middleware.use(req, res, next)

      expect(next).toHaveBeenCalledTimes(1)
      expect(next).toHaveBeenCalledWith()
      expect(mockAuthService.userForApiKey).not.toHaveBeenCalled()
      expect(mockAuthService.userForAuthorizationHeader).not.toHaveBeenCalled()
      expect(mockAuthService.userForRefreshToken).not.toHaveBeenCalled()
      expect(req.currentUser).toBeUndefined()
    })
  })
})
