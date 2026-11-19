import { RequestMethod } from '@nestjs/common'
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { IS_PUBLIC_KEY } from 'src/decorators/public.decorator'
import { AuthCourierRestApiController } from './auth.courier.rest-api.controller'
import { PasswordResetCourierRestApiService } from './password-reset.courier.rest-api.service'
import { AuthDomainService } from 'src/domains/auth/auth.domain.service'
import { ForgotPasswordCourierInput } from './queries/forgot-password.courier.input'
import { ResetPasswordCourierInput } from './queries/reset-password.courier.input'
import { UserInfoCourierDto } from './dtos/user-info.courier.dto'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { EnumUserRole } from '@prisma/types'

describe('AuthCourierRestApiController Password Reset Routes (Spec 0039 AC-7, AC-10, AC-13)', () => {
  let controller: AuthCourierRestApiController
  let mockAuthDomainService: jest.Mocked<Partial<AuthDomainService>>
  let mockPasswordResetService: {
    forgotPassword: jest.Mock
    resetPassword: jest.Mock
  }

  const mockCourierUser = new UserEntity({
    id: 'user-courier-1',
    email: 'rider@volos.coop',
    password: 'hashed-password',
    role: [EnumUserRole.COURIER],
    username: null,
    apiKeyHash: null,
    apiKeyCreatedAt: null,
    credentialsChangedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  })

  const mockSessionResult = new UserInfoCourierDto({
    user: mockCourierUser,
    session: {
      accessToken: 'jwt-access-token',
      refreshToken: 'jwt-refresh-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      refreshExpiresIn: 7200,
    },
  })

  beforeEach(() => {
    mockAuthDomainService = {}
    mockPasswordResetService = {
      forgotPassword: jest.fn(),
      resetPassword: jest.fn().mockResolvedValue(mockSessionResult),
    }

    controller = new AuthCourierRestApiController(
      mockAuthDomainService as unknown as AuthDomainService,
      mockPasswordResetService as unknown as PasswordResetCourierRestApiService
    )
  })

  describe('Route Metadata, Guards & Throttling (AC-7, AC-10, AC-13)', () => {
    describe('POST forgot-password', () => {
      test('has path "forgot-password" and POST method', () => {
        expect(Reflect.getMetadata(PATH_METADATA, controller.forgotPassword)).toBe('forgot-password')
        expect(Reflect.getMetadata(METHOD_METADATA, controller.forgotPassword)).toBe(RequestMethod.POST)
      })

      test('is marked @Public()', () => {
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, controller.forgotPassword)).toBe(true)
      })

      test('answers with @HttpCode(202) Accepted (AC-7)', () => {
        expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.forgotPassword)).toBe(202)
      })

      test('uses PUBLIC_DEFAULT_THROTTLE (limit 3, ttl 60000)', () => {
        expect(Reflect.getMetadata('THROTTLER:LIMITdefault', controller.forgotPassword)).toBe(3)
        expect(Reflect.getMetadata('THROTTLER:TTLdefault', controller.forgotPassword)).toBe(60000)
      })
    })

    describe('POST reset-password', () => {
      test('has path "reset-password" and POST method', () => {
        expect(Reflect.getMetadata(PATH_METADATA, controller.resetPassword)).toBe('reset-password')
        expect(Reflect.getMetadata(METHOD_METADATA, controller.resetPassword)).toBe(RequestMethod.POST)
      })

      test('is marked @Public()', () => {
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, controller.resetPassword)).toBe(true)
      })

      test('answers with @HttpCode(200) OK (AC-10)', () => {
        expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.resetPassword)).toBe(200)
      })

      test('uses PUBLIC_DEFAULT_THROTTLE (limit 3, ttl 60000)', () => {
        expect(Reflect.getMetadata('THROTTLER:LIMITdefault', controller.resetPassword)).toBe(3)
        expect(Reflect.getMetadata('THROTTLER:TTLdefault', controller.resetPassword)).toBe(60000)
      })
    })
  })

  describe('Handler Execution', () => {
    test('forgotPassword calls service.forgotPassword and returns undefined (empty body)', () => {
      const input = new ForgotPasswordCourierInput()
      input.email = 'rider@volos.coop'

      const result = controller.forgotPassword(input)

      expect(mockPasswordResetService.forgotPassword).toHaveBeenCalledWith('rider@volos.coop')
      expect(result).toBeUndefined()
    })

    test('resetPassword calls service.resetPassword and returns UserInfoCourierDto', async () => {
      const input = new ResetPasswordCourierInput()
      input.email = 'rider@volos.coop'
      input.code = '004219'
      input.password = 'newPassword123'

      const result = await controller.resetPassword(input)

      expect(mockPasswordResetService.resetPassword).toHaveBeenCalledWith(
        'rider@volos.coop',
        '004219',
        'newPassword123'
      )
      expect(result).toBe(mockSessionResult)
      expect(result.id).toBe('user-courier-1')
    })
  })
})
