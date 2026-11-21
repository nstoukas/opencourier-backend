import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'
import { AuthCourierRestApiController } from './auth.courier.rest-api.controller'
import { HTTP_CODE_METADATA } from '@nestjs/common/constants'
import { EnumUserRole } from '@prisma/types'
import { IS_PUBLIC_KEY } from 'src/decorators/public.decorator'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { UserInfoCourierDto } from './dtos/user-info.courier.dto'

describe('AuthCourierRestApiController (Spec 0013 AC-7: no public courier sign up)', () => {
  test('has no register method or handler decorated with Post("register")', () => {
    // 1. No property or method named "register" or "registerCourier"
    const proto = AuthCourierRestApiController.prototype as any
    expect(proto.register).toBeUndefined()
    expect(proto.registerCourier).toBeUndefined()

    // 2. Iterate all methods on the controller and ensure none has path 'register' with POST
    const methodNames = Object.getOwnPropertyNames(AuthCourierRestApiController.prototype).filter(
      (name) => name !== 'constructor'
    )

    for (const methodName of methodNames) {
      const fn = proto[methodName]
      if (typeof fn === 'function') {
        const path = Reflect.getMetadata(PATH_METADATA, fn)
        const method = Reflect.getMetadata(METHOD_METADATA, fn)

        // Neither 'register' nor '/register' should exist
        expect(path).not.toBe('register')
        expect(path).not.toBe('/register')
        if (method === RequestMethod.POST) {
          expect(path).not.toContain('register')
        }
      }
    }
  })

  test('keeps existing public login and private session routes', () => {
    const proto = AuthCourierRestApiController.prototype as any
    expect(typeof proto.login).toBe('function')
    expect(typeof proto.refreshTokens).toBe('function')
    expect(typeof proto.getMe).toBe('function')

    expect(Reflect.getMetadata(PATH_METADATA, proto.login)).toBe('login')
    expect(Reflect.getMetadata(METHOD_METADATA, proto.login)).toBe(RequestMethod.POST)
  })

  // Spec 0051 (AC-8, cross check 13): POST courier/v1/auth/change-password, the rider's own change.
  describe('change-password (spec 0051, AC-8)', () => {
    const rider = { id: 'courier-777', userId: 'user-courier-1' } as CourierEntity
    const user = new UserEntity({
      id: 'user-courier-1',
      email: 'rider@volos.coop',
      password: 'hash-of-new',
      role: [EnumUserRole.COURIER],
      username: null,
      apiKeyHash: null,
      apiKeyCreatedAt: null,
      credentialsChangedAt: new Date('2026-11-21T10:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })
    const session = {
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
      tokenType: 'Bearer',
      expiresIn: 3600,
      refreshExpiresIn: 7200,
    }

    test('is POST "change-password", answers 200, and needs a signed in rider (not public)', () => {
      const handler = AuthCourierRestApiController.prototype.changePassword
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('change-password')
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST)
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200)
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([EnumUserRole.COURIER])
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeFalsy()
    })

    test("passes the signed in rider and the body on, and answers this phone's fresh tokens like login does", async () => {
      const accounts = { changeOwnPassword: jest.fn().mockResolvedValue({ user, session }) }
      const controller = new AuthCourierRestApiController({} as any, {} as any, accounts as any)
      const body = { currentPassword: 'current-password', newPassword: 'a-new-password', pushToken: 'token-this-phone' }

      const result = await controller.changePassword(rider, body)

      expect(accounts.changeOwnPassword).toHaveBeenCalledTimes(1)
      expect(accounts.changeOwnPassword).toHaveBeenCalledWith(rider, body)
      expect(result).toBeInstanceOf(UserInfoCourierDto)
      expect(result.session?.accessToken).toBe('fresh-access')
      expect(result.session?.refreshToken).toBe('fresh-refresh')
      // The answer never carries a password, typed or stored.
      const sent = JSON.stringify(result)
      expect(sent).not.toContain('hash-of-new')
      expect(sent).not.toContain('a-new-password')
      expect(sent).not.toContain('current-password')
    })

    test("the refusal (400 wrong current password) reaches the rider as it is", async () => {
      const refusal = new Error('Your current password is not right.')
      const accounts = { changeOwnPassword: jest.fn().mockRejectedValue(refusal) }
      const controller = new AuthCourierRestApiController({} as any, {} as any, accounts as any)

      await expect(
        controller.changePassword(rider, { currentPassword: 'not-it', newPassword: 'a-new-password' })
      ).rejects.toBe(refusal)
    })
  })
})
