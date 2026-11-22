import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { EnumUserRole } from '@prisma/types'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { IS_PUBLIC_KEY } from 'src/decorators/public.decorator'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { AuthDomainService } from 'src/domains/auth/auth.domain.service'
import { UserSessionEntity } from 'src/domains/auth/entities/user-session.entity'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import * as errors from 'src/errors'
import { LanguageDto, LanguageInput } from 'src/rest-api/common/dtos/language.dto'
import { AuthAdminRestApiController } from './auth.admin.rest-api.controller'
import { UserInfoAdminDto } from './dtos/user-info.admin.dto'
import { UserAdminDto } from './dtos/user.admin.dto'

// Spec 0054 (AC-2): admin authentication routes and language setting.
describe('AuthAdminRestApiController (spec 0054, AC-2)', () => {
  let controller: AuthAdminRestApiController
  let mockAuthDomainService: jest.Mocked<AuthDomainService>

  const mockAdminUser = new UserEntity({
    id: 'admin-user-1',
    email: 'admin@volos.coop',
    password: 'hashed-admin-password',
    role: [EnumUserRole.ADMIN],
    username: 'admin',
    apiKeyHash: null,
    apiKeyCreatedAt: null,
    credentialsChangedAt: null,
    language: 'el',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  })

  const mockCourierUser = new UserEntity({
    id: 'user-courier-2',
    email: 'courier@volos.coop',
    password: 'hashed-password',
    role: [EnumUserRole.COURIER],
    username: 'courier',
    apiKeyHash: null,
    apiKeyCreatedAt: null,
    credentialsChangedAt: null,
    language: 'el',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  })

  const mockSession = new UserSessionEntity(
    'admin-access-token',
    'admin-refresh-token',
    'Bearer',
    3600,
    7200
  )

  beforeEach(() => {
    mockAuthDomainService = {
      loginWithEmail: jest.fn(),
      getMe: jest.fn(),
      setLanguage: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuthDomainService>

    controller = new AuthAdminRestApiController(mockAuthDomainService)
  })

  describe('Route metadata', () => {
    const proto = AuthAdminRestApiController.prototype

    test('is mounted at admin/v1/auth', () => {
      expect(Reflect.getMetadata(PATH_METADATA, AuthAdminRestApiController)).toBe(`${ADMIN_API_V1_PREFIX}/auth`)
    })

    test('PUT language has @Roles(ADMIN)', () => {
      expect(Reflect.getMetadata(PATH_METADATA, proto.setLanguage)).toBe('language')
      expect(Reflect.getMetadata(METHOD_METADATA, proto.setLanguage)).toBe(RequestMethod.PUT)
      expect(Reflect.getMetadata(ROLES_KEY, proto.setLanguage)).toEqual([EnumUserRole.ADMIN])
    })

    test('GET me has GET method metadata', () => {
      expect(Reflect.getMetadata(PATH_METADATA, proto.getMe)).toBe('me')
      expect(Reflect.getMetadata(METHOD_METADATA, proto.getMe)).toBe(RequestMethod.GET)
    })

    test('POST login is public', () => {
      expect(Reflect.getMetadata(PATH_METADATA, proto.login)).toBe('login')
      expect(Reflect.getMetadata(METHOD_METADATA, proto.login)).toBe(RequestMethod.POST)
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.login)).toBe(true)
    })
  })

  describe('PUT language (spec 0054, AC-2)', () => {
    test('saves language choice and returns LanguageDto', async () => {
      const result = await controller.setLanguage(mockAdminUser, { language: 'en' })

      expect(mockAuthDomainService.setLanguage).toHaveBeenCalledTimes(1)
      expect(mockAuthDomainService.setLanguage).toHaveBeenCalledWith('admin-user-1', 'en')
      expect(result).toBeInstanceOf(LanguageDto)
      expect(result.language).toBe('en')
    })

    test('saves Greek language choice', async () => {
      const result = await controller.setLanguage(mockAdminUser, { language: 'el' })

      expect(mockAuthDomainService.setLanguage).toHaveBeenCalledWith('admin-user-1', 'el')
      expect(result).toBeInstanceOf(LanguageDto)
      expect(result.language).toBe('el')
    })

    test('LanguageInput accepts el and en', async () => {
      const elInput = plainToInstance(LanguageInput, { language: 'el' })
      expect(await validate(elInput)).toHaveLength(0)

      const enInput = plainToInstance(LanguageInput, { language: 'en' })
      expect(await validate(enInput)).toHaveLength(0)
    })

    test('LanguageInput rejects unknown languages (e.g. fr, de, empty)', async () => {
      const frInput = plainToInstance(LanguageInput, { language: 'fr' })
      const frErrors = await validate(frInput)
      expect(frErrors.some((e) => e.property === 'language')).toBe(true)

      const deInput = plainToInstance(LanguageInput, { language: 'de' })
      const deErrors = await validate(deInput)
      expect(deErrors.some((e) => e.property === 'language')).toBe(true)

      const emptyInput = plainToInstance(LanguageInput, { language: '' })
      const emptyErrors = await validate(emptyInput)
      expect(emptyErrors.some((e) => e.property === 'language')).toBe(true)
    })

    test('LanguageInput rejects non-string values', () => {
      expect(() => plainToInstance(LanguageInput, { language: 123 as any })).toThrow(
        'language must be sent as text'
      )
    })
  })

  describe('Language is returned after saving (GET me and POST login)', () => {
    test('GET me returns UserAdminDto carrying the saved language', async () => {
      const userWithEnglish = new UserEntity({
        ...mockAdminUser,
        language: 'en',
      })
      mockAuthDomainService.getMe.mockResolvedValue(userWithEnglish)

      const result = await controller.getMe(mockAdminUser)

      expect(mockAuthDomainService.getMe).toHaveBeenCalledWith('admin-user-1')
      expect(result).toBeInstanceOf(UserAdminDto)
      expect(result.id).toBe('admin-user-1')
      expect(result.email).toBe('admin@volos.coop')
      expect(result.role).toEqual([EnumUserRole.ADMIN])
      expect(result.language).toBe('en')
    })

    test('POST login returns UserInfoAdminDto carrying the saved language', async () => {
      const userWithEnglish = new UserEntity({
        ...mockAdminUser,
        language: 'en',
      })
      mockAuthDomainService.loginWithEmail.mockResolvedValue({
        user: userWithEnglish,
        session: mockSession,
      })

      const result = await controller.login({ email: 'admin@volos.coop', password: 'password123' })

      expect(result).toBeInstanceOf(UserInfoAdminDto)
      expect(result.id).toBe('admin-user-1')
      expect(result.language).toBe('en')
      expect(result.session?.accessToken).toBe('admin-access-token')
    })

    test('POST login throws ForbiddenException when user is not an admin', async () => {
      mockAuthDomainService.loginWithEmail.mockResolvedValue({
        user: mockCourierUser,
        session: mockSession,
      })

      await expect(
        controller.login({ email: 'courier@volos.coop', password: 'password123' })
      ).rejects.toThrow(errors.ForbiddenException)
    })
  })
})
