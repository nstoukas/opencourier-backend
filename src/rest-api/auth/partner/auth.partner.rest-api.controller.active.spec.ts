import { AuthPartnerRestApiController } from './auth.partner.rest-api.controller'
import { AuthDomainService } from '../../../domains/auth/auth.domain.service'
import { UserEntity } from '../../../domains/user/entities/user.entity'
import { UserSessionEntity } from '../../../domains/auth/entities/user-session.entity'
import { EnumUserRole } from '@prisma/types'
import { IS_PUBLIC_KEY } from 'src/decorators/public.decorator'
import { IS_API_KEY_AUTH } from 'src/decorators/api-key-auth.decorator'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { ForbiddenException } from 'src/errors'

describe('AuthPartnerRestApiController', () => {
  let controller: AuthPartnerRestApiController
  let mockAuthDomainService: jest.Mocked<AuthDomainService>

  const mockPartnerUser = new UserEntity({
    id: 'user-partner-100',
    email: 'taverna@volos.gr',
    password: 'hashed-password',
    role: [EnumUserRole.PARTNER],
    username: 'tavernavolos',
    apiKey: 'partner-key-100',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  const mockCourierUser = new UserEntity({
    id: 'user-courier-200',
    email: 'courier@volos.gr',
    password: 'hashed-password',
    role: [EnumUserRole.COURIER],
    username: 'couriervolos',
    apiKey: 'courier-key-200',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  const mockSession = new UserSessionEntity(
    'access-token-123',
    'refresh-token-456',
    'Bearer',
    3600,
    86400
  )

  beforeEach(() => {
    mockAuthDomainService = {
      loginPartnerWithUsername: jest.fn(),
      getMe: jest.fn(),
    } as unknown as jest.Mocked<AuthDomainService>

    controller = new AuthPartnerRestApiController(mockAuthDomainService)
  })

  describe('Structural & Metadata Assertions', () => {
    test('14. AuthPartnerRestApiController prototype has NO register method (public self-registration removed)', () => {
      // Structurally assert that register is no longer callable or defined on the controller
      const prototype = AuthPartnerRestApiController.prototype as any
      expect(prototype.register).toBeUndefined()
    })

    test('15. login handler carries @Public() metadata (IS_PUBLIC_KEY = true)', () => {
      // Login must remain public so unauthenticated partners can exchange credentials for tokens
      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controller.login)
      expect(isPublic).toBe(true)
    })

    test('16. getMe handler carries @ApiKeyAuth() AND @Roles([EnumUserRole.PARTNER])', () => {
      // getMe requires authentication and partner authorization
      const isApiKeyAuth = Reflect.getMetadata(IS_API_KEY_AUTH, controller.getMe)
      const roles = Reflect.getMetadata(ROLES_KEY, controller.getMe)

      expect(isApiKeyAuth).toBe(true)
      expect(roles).toEqual([EnumUserRole.PARTNER])
    })
  })

  describe('login handler', () => {
    test('returns UserInfoPartnerDto when user has PARTNER role', async () => {
      mockAuthDomainService.loginPartnerWithUsername.mockResolvedValue({
        user: mockPartnerUser as UserEntity & { apiKey: string },
        session: mockSession,
      })

      const input = { email: 'taverna@volos.gr', password: 'securePassword123' }
      const result = await controller.login(input)

      expect(mockAuthDomainService.loginPartnerWithUsername).toHaveBeenCalledWith(input)
      expect(result.id).toBe('user-partner-100')
      expect(result.email).toBe('taverna@volos.gr')
      expect(result.apiKey).toBe('partner-key-100')
      expect(result.session?.accessToken).toBe('access-token-123')
    })

    test('throws ForbiddenException when user attempting login does not have PARTNER role', async () => {
      // e.g. Courier credentials submitted to partner login endpoint
      mockAuthDomainService.loginPartnerWithUsername.mockResolvedValue({
        user: mockCourierUser as UserEntity & { apiKey: string },
        session: mockSession,
      })

      const input = { email: 'courier@volos.gr', password: 'securePassword123' }

      await expect(controller.login(input)).rejects.toThrow(ForbiddenException)
      expect(mockAuthDomainService.loginPartnerWithUsername).toHaveBeenCalledWith(input)
    })
  })

  describe('getMe handler', () => {
    test('returns UserPartnerDto for current partner user', async () => {
      mockAuthDomainService.getMe.mockResolvedValue(mockPartnerUser)

      const result = await controller.getMe(mockPartnerUser)

      expect(mockAuthDomainService.getMe).toHaveBeenCalledWith('user-partner-100')
      expect(result.id).toBe('user-partner-100')
      expect(result.email).toBe('taverna@volos.gr')
      expect(result.role).toEqual([EnumUserRole.PARTNER])
    })
  })
})
