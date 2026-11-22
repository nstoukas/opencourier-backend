import { AuthPartnerRestApiController } from './auth.partner.rest-api.controller'
import { AuthDomainService } from '../../../domains/auth/auth.domain.service'
import { UserEntity } from '../../../domains/user/entities/user.entity'
import { UserSessionEntity } from '../../../domains/auth/entities/user-session.entity'
import { EnumUserRole } from '@prisma/types'
import { IS_PUBLIC_KEY } from 'src/decorators/public.decorator'
import { IS_API_KEY_AUTH } from 'src/decorators/api-key-auth.decorator'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { ForbiddenException } from 'src/errors'
import { PartnerRepository } from 'src/persistence/repositories/partner.repository'
import { LanguageDto } from 'src/rest-api/common/dtos/language.dto'
import { PATH_METADATA } from '@nestjs/common/constants'
import { METHOD_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'

describe('AuthPartnerRestApiController', () => {
  let controller: AuthPartnerRestApiController
  let mockAuthDomainService: jest.Mocked<AuthDomainService>
  let mockPartnerRepository: jest.Mocked<PartnerRepository>

  const mockPartnerUser = new UserEntity({
    id: 'user-partner-100',
    email: 'taverna@volos.gr',
    password: 'hashed-password',
    role: [EnumUserRole.PARTNER],
    username: 'tavernavolos',
    apiKeyHash: 'partner-hash-100',
    apiKeyCreatedAt: new Date('2026-07-01T10:00:00Z'),
    credentialsChangedAt: null,
    language: 'el',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  const mockCourierUser = new UserEntity({
    id: 'user-courier-200',
    email: 'courier@volos.gr',
    password: 'hashed-password',
    role: [EnumUserRole.COURIER],
    username: 'couriervolos',
    apiKeyHash: null,
    apiKeyCreatedAt: null,
    credentialsChangedAt: null,
    language: 'el',
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
      setLanguage: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuthDomainService>

    // Spec 0023 (AC-9): getMe looks the restaurant up by its user for its usual prep time.
    mockPartnerRepository = {
      findByUserId: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<PartnerRepository>

    controller = new AuthPartnerRestApiController(mockAuthDomainService, mockPartnerRepository)
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
    test('returns UserInfoPartnerDto without apiKey property when user has PARTNER role (AC-2)', async () => {
      mockAuthDomainService.loginPartnerWithUsername.mockResolvedValue({
        user: mockPartnerUser,
        session: mockSession,
      })

      const input = { email: 'taverna@volos.gr', password: 'securePassword123' }
      const result = await controller.login(input)

      expect(mockAuthDomainService.loginPartnerWithUsername).toHaveBeenCalledWith(input)
      expect(result.id).toBe('user-partner-100')
      expect(result.email).toBe('taverna@volos.gr')
      // Spec 0037 AC-2: UserInfoPartnerDto has no apiKey property
      expect((result as any).apiKey).toBeUndefined()
      expect(Object.keys(result)).not.toContain('apiKey')
      expect(Object.keys(result)).not.toContain('apiKeyHash')
      expect(result.session?.accessToken).toBe('access-token-123')
      // Spec 0054 (AC-2): carries the user's saved language
      expect(result.language).toBe('el')
    })

    test('carries the saved language on the partner login reply (spec 0054, AC-2)', async () => {
      const enPartnerUser = new UserEntity({ ...mockPartnerUser, language: 'en' })
      mockAuthDomainService.loginPartnerWithUsername.mockResolvedValue({
        user: enPartnerUser,
        session: mockSession,
      })
      const result = await controller.login({ email: 'taverna@volos.gr', password: 'securePassword123' })
      expect(result.language).toBe('en')
    })

    test('throws ForbiddenException when user attempting login does not have PARTNER role', async () => {
      // e.g. Courier credentials submitted to partner login endpoint
      mockAuthDomainService.loginPartnerWithUsername.mockResolvedValue({
        user: mockCourierUser,
        session: mockSession,
      })

      const input = { email: 'courier@volos.gr', password: 'securePassword123' }

      await expect(controller.login(input)).rejects.toThrow(ForbiddenException)
      expect(mockAuthDomainService.loginPartnerWithUsername).toHaveBeenCalledWith(input)
    })
  })

  describe('getMe handler', () => {
    test('returns UserPartnerDto for current partner user without apiKey (AC-2)', async () => {
      mockAuthDomainService.getMe.mockResolvedValue(mockPartnerUser)

      const result = await controller.getMe(mockPartnerUser)

      expect(mockAuthDomainService.getMe).toHaveBeenCalledWith('user-partner-100')
      expect(result.id).toBe('user-partner-100')
      expect(result.email).toBe('taverna@volos.gr')
      expect(result.role).toEqual([EnumUserRole.PARTNER])
      // Spec 0037 AC-2: getMe answer never carries an API key
      expect((result as any).apiKey).toBeUndefined()
      expect(Object.keys(result)).not.toContain('apiKey')
      expect(Object.keys(result)).not.toContain('apiKeyHash')
      // Spec 0054 (AC-2): carries the user's saved language
      expect(result.language).toBe('el')
    })

    test('carries the saved language on the partner me reply (spec 0054, AC-2)', async () => {
      const enPartnerUser = new UserEntity({ ...mockPartnerUser, language: 'en' })
      mockAuthDomainService.getMe.mockResolvedValue(enPartnerUser)
      mockPartnerRepository.findByUserId.mockResolvedValue(null)

      const result = await controller.getMe(enPartnerUser)
      expect(result.language).toBe('en')
    })

    // Spec 0023, AC-9: auth/me carries the restaurant's usual prep time, found by Partner.userId.
    test('carries usualPrepMinutes of the partner found by the current user id (AC-9)', async () => {
      mockAuthDomainService.getMe.mockResolvedValue(mockPartnerUser)
      mockPartnerRepository.findByUserId.mockResolvedValue({ id: 'partner-1', usualPrepMinutes: 25 } as any)

      const result = await controller.getMe(mockPartnerUser)

      expect(mockPartnerRepository.findByUserId).toHaveBeenCalledWith('user-partner-100')
      expect(result.usualPrepMinutes).toBe(25)
    })

    test('carries usualPrepMinutes 0 as 0, not null (AC-9: "Now" is a real usual time)', async () => {
      mockAuthDomainService.getMe.mockResolvedValue(mockPartnerUser)
      mockPartnerRepository.findByUserId.mockResolvedValue({ id: 'partner-1', usualPrepMinutes: 0 } as any)

      const result = await controller.getMe(mockPartnerUser)

      expect(result.usualPrepMinutes).toBe(0)
    })

    test('carries usualPrepMinutes null when the user has no restaurant (AC-9)', async () => {
      mockAuthDomainService.getMe.mockResolvedValue(mockPartnerUser)
      mockPartnerRepository.findByUserId.mockResolvedValue(null)

      const result = await controller.getMe(mockPartnerUser)

      expect(result.usualPrepMinutes).toBeNull()
      expect(result.id).toBe('user-partner-100')
    })
  })

  describe('setLanguage (spec 0054, AC-2)', () => {
    test('calls authDomainService.setLanguage with user id and language, returning LanguageDto', async () => {
      const result = await controller.setLanguage(mockPartnerUser, { language: 'en' })

      expect(mockAuthDomainService.setLanguage).toHaveBeenCalledWith('user-partner-100', 'en')
      expect(result).toBeInstanceOf(LanguageDto)
      expect(result.language).toBe('en')
    })

    test('is routed at PUT language with @Roles(PARTNER)', () => {
      const fn = AuthPartnerRestApiController.prototype.setLanguage
      expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe('language')
      expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(RequestMethod.PUT)
      expect(Reflect.getMetadata(ROLES_KEY, fn)).toEqual([EnumUserRole.PARTNER])
    })
  })
})
