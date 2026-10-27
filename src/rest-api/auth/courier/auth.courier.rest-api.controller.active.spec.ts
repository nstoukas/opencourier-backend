import { Request } from 'express'
import { EnumUserRole } from '@prisma/types'
import { AuthCourierRestApiController } from './auth.courier.rest-api.controller'
import { AuthDomainService } from '../../../domains/auth/auth.domain.service'
import { UserEntity } from '../../../domains/user/entities/user.entity'
import { UserSessionEntity } from '../../../domains/auth/entities/user-session.entity'
import { UserInfoCourierDto } from './dtos/user-info.courier.dto'
import { UserSessionCourierDto } from './dtos/user-session.courier.dto'
import { ForbiddenException } from '../../../errors'
import { IS_PRIVATE_WITH_REFRESH_TOKEN } from '../../../decorators/private-with-refresh-token.decorator'
import { ROLES_KEY } from '../../../decorators/roles.decorator'

describe('AuthCourierRestApiController', () => {
  let controller: AuthCourierRestApiController
  let mockAuthDomainService: jest.Mocked<AuthDomainService>

  // A courier user with sensitive fields that must never leak to the client
  const mockCourierUser = new UserEntity({
    id: 'user-courier-123',
    email: 'courier@volos.gr',
    password: '$2b$10$verysecretpasswordhashthatmustneverleak',
    apiKey: 'courier-super-secret-api-key-999',
    role: [EnumUserRole.COURIER],
    username: 'couriervolos',
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-02T10:00:00Z'),
  })

  // A non-courier user to test role enforcement on login
  const mockPartnerUser = new UserEntity({
    id: 'user-partner-456',
    email: 'partner@volos.gr',
    password: 'hashed-password',
    apiKey: 'partner-key',
    role: [EnumUserRole.PARTNER],
    username: 'partnervolos',
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-02T10:00:00Z'),
  })

  const mockSession = new UserSessionEntity('access-token-jwt-mock', 'refresh-token-jwt-mock', 'Bearer', 3600, 86400)

  const domainAuthResult = {
    user: mockCourierUser,
    session: mockSession,
  }

  beforeEach(() => {
    // Manual mock of the domain service dependency (NestJS Dependency Injection)
    mockAuthDomainService = {
      loginWithEmail: jest.fn(),
      refreshTokens: jest.fn(),
      registerCourier: jest.fn(),
      getMeWithCourier: jest.fn(),
      getAblyToken: jest.fn(),
    } as unknown as jest.Mocked<AuthDomainService>

    controller = new AuthCourierRestApiController(mockAuthDomainService)
  })

  describe('Route Metadata & Guards', () => {
    test('refreshTokens has @PrivateWithRefreshToken and @Roles(EnumUserRole.COURIER)', () => {
      // NestJS route decorators attach metadata for authentication and role guards
      const isPrivateWithRefresh = Reflect.getMetadata(IS_PRIVATE_WITH_REFRESH_TOKEN, controller.refreshTokens)
      const roles = Reflect.getMetadata(ROLES_KEY, controller.refreshTokens)

      expect(isPrivateWithRefresh).toBe(true)
      expect(roles).toEqual([EnumUserRole.COURIER])
    })
  })

  describe('refreshTokens handler', () => {
    test('returns a UserInfoCourierDto instance with exact keys [email, id, role, session]', async () => {
      mockAuthDomainService.refreshTokens.mockResolvedValue(domainAuthResult)

      const mockReq = {
        headers: {
          'x-refresh-token': 'sample-refresh-token',
        },
      } as unknown as Request

      const result = (await controller.refreshTokens(mockCourierUser, mockReq)) as unknown as UserInfoCourierDto

      // Must return an instance of UserInfoCourierDto (Data Transfer Object)
      expect(result).toBeInstanceOf(UserInfoCourierDto)

      // Keys must strictly match the DTO shape: id, email, role, session (no user entity leakage)
      expect(Object.keys(result).sort()).toEqual(['email', 'id', 'role', 'session'])
      expect(result.id).toBe(mockCourierUser.id)
      expect(result.email).toBe(mockCourierUser.email)
      expect(result.role).toEqual([EnumUserRole.COURIER])

      // Session must be wrapped in UserSessionCourierDto
      expect(result.session).toBeInstanceOf(UserSessionCourierDto)
      if (!result.session) {
        throw new Error('Expected result.session to be defined')
      }
      expect(Object.keys(result.session).sort()).toEqual([
        'accessToken',
        'expiresIn',
        'refreshExpiresIn',
        'refreshToken',
        'tokenType',
      ])
      expect(result.session.accessToken).toBe('access-token-jwt-mock')
      expect(result.session.refreshToken).toBe('refresh-token-jwt-mock')
      expect(result.session.tokenType).toBe('Bearer')
      expect(result.session.expiresIn).toBe(3600)
      expect(result.session.refreshExpiresIn).toBe(86400)
    })

    test('JSON.stringify never includes password, apiKey, username, createdAt or updatedAt', async () => {
      mockAuthDomainService.refreshTokens.mockResolvedValue(domainAuthResult)

      const mockReq = {
        headers: {
          'x-refresh-token': 'sample-refresh-token',
        },
      } as unknown as Request

      const result = (await controller.refreshTokens(mockCourierUser, mockReq)) as unknown as UserInfoCourierDto
      const serialized = JSON.stringify(result)

      // Verify secrets and entity internals never appear anywhere in the serialized JSON
      expect(serialized).not.toContain(mockCourierUser.password)
      expect(serialized).not.toContain(mockCourierUser.apiKey)
      expect(serialized).not.toContain('password')
      expect(serialized).not.toContain('apiKey')
      expect(serialized).not.toContain('username')
      expect(serialized).not.toContain('createdAt')
      expect(serialized).not.toContain('updatedAt')

      // Directly verify properties on the returned object
      const anyResult = result as unknown as Record<string, unknown>
      expect(anyResult.password).toBeUndefined()
      expect(anyResult.apiKey).toBeUndefined()
      expect(anyResult.username).toBeUndefined()
      expect(anyResult.createdAt).toBeUndefined()
      expect(anyResult.updatedAt).toBeUndefined()
      expect(anyResult.user).toBeUndefined()
    })

    test('login and refreshTokens return the same set of keys for the same domain result', async () => {
      mockAuthDomainService.loginWithEmail.mockResolvedValue(domainAuthResult)
      mockAuthDomainService.refreshTokens.mockResolvedValue(domainAuthResult)

      const loginResult = await controller.login({
        email: mockCourierUser.email || '',
        password: 'valid-password',
      })

      const mockReq = {
        headers: {
          'x-refresh-token': 'sample-refresh-token',
        },
      } as unknown as Request

      const refreshResult = (await controller.refreshTokens(mockCourierUser, mockReq)) as unknown as UserInfoCourierDto

      // Both must be UserInfoCourierDto instances
      expect(loginResult).toBeInstanceOf(UserInfoCourierDto)
      expect(refreshResult).toBeInstanceOf(UserInfoCourierDto)

      // Both endpoints must return exactly the same set of keys
      expect(Object.keys(refreshResult).sort()).toEqual(Object.keys(loginResult).sort())
      expect(Object.keys(refreshResult).sort()).toEqual(['email', 'id', 'role', 'session'])

      // Values must match identically
      expect(refreshResult).toEqual(loginResult)
    })

    test('extracts x-refresh-token header and passes it to domain service', async () => {
      mockAuthDomainService.refreshTokens.mockResolvedValue(domainAuthResult)

      const mockReq = {
        headers: {
          'x-refresh-token': 'test-refresh-token-xyz',
        },
      } as unknown as Request

      await controller.refreshTokens(mockCourierUser, mockReq)

      expect(mockAuthDomainService.refreshTokens).toHaveBeenCalledWith(mockCourierUser.id, 'test-refresh-token-xyz')
    })

    test('passes empty string when x-refresh-token header is absent', async () => {
      mockAuthDomainService.refreshTokens.mockResolvedValue(domainAuthResult)

      const mockReq = {
        headers: {},
      } as unknown as Request

      await controller.refreshTokens(mockCourierUser, mockReq)

      expect(mockAuthDomainService.refreshTokens).toHaveBeenCalledWith(mockCourierUser.id, '')
    })

    test('propagates error when authDomainService.refreshTokens fails', async () => {
      mockAuthDomainService.refreshTokens.mockRejectedValue(new ForbiddenException('Invalid refresh token'))

      const mockReq = {
        headers: {
          'x-refresh-token': 'bad-token',
        },
      } as unknown as Request

      await expect(controller.refreshTokens(mockCourierUser, mockReq)).rejects.toThrow(ForbiddenException)
    })
  })

  describe('login handler', () => {
    test('throws ForbiddenException when user does not have COURIER role', async () => {
      mockAuthDomainService.loginWithEmail.mockResolvedValue({
        user: mockPartnerUser,
        session: mockSession,
      })

      await expect(controller.login({ email: mockPartnerUser.email || '', password: 'secret' })).rejects.toThrow(
        ForbiddenException
      )
    })
  })
})
