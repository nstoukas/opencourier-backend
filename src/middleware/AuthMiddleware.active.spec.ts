import { AuthMiddleware } from './AuthMiddleware'
import { CREDENTIALS_CHANGED_MESSAGE } from '../domains/auth/credentials-change'
import { UnauthorizedException } from '../errors'
import { EnumUserRole } from '@prisma/types'
import { UserEntity } from '../domains/user/entities/user.entity'

describe('AuthMiddleware (Spec 0013 AC-5: passes 401 credentials changed on)', () => {
  let middleware: AuthMiddleware
  let mockAuthService: any
  let mockCourierDomainService: any
  let mockPartnerDomainService: any

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
