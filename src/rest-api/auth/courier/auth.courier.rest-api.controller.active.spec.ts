import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'
import { AuthCourierRestApiController } from './auth.courier.rest-api.controller'

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
})
