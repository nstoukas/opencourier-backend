import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { EnumDevicePlatform } from '@prisma/types'
import { CourierDeviceCourierRestApiController } from './courier-device.courier.rest-api.controller'
import { CourierDeviceDomainService } from '../../../domains/courier-device/courier-device.domain.service'
import { CourierDeviceRegisterCourierInput } from './queries/courier-device-register.courier.input'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'

describe('CourierDeviceCourierRestApiController - Spec 0003 AC-1 Device Endpoints', () => {
  let controller: CourierDeviceCourierRestApiController
  let mockCourierDeviceDomainService: jest.Mocked<CourierDeviceDomainService>

  const mockCourier: CourierEntity = {
    id: 'courier-auth-123',
    userId: 'user-auth-123',
    firstName: 'Nikos',
    lastName: 'Rider',
  } as CourierEntity

  beforeEach(() => {
    mockCourierDeviceDomainService = {
      register: jest.fn().mockResolvedValue(undefined),
      unregister: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CourierDeviceDomainService>

    controller = new CourierDeviceCourierRestApiController(mockCourierDeviceDomainService)
  })

  describe('POST /devices (register)', () => {
    test('delegates to domain service with authenticated courier id and input payload', async () => {
      const input: CourierDeviceRegisterCourierInput = {
        token: 'fcm-push-token-abc',
        platform: EnumDevicePlatform.ANDROID,
      }

      const result = await controller.register(input, mockCourier)

      // AC-1: Courier id comes from the authenticated session, never request body
      expect(mockCourierDeviceDomainService.register).toHaveBeenCalledWith(
        'courier-auth-123',
        'fcm-push-token-abc',
        EnumDevicePlatform.ANDROID
      )
      // 204 No Content returns undefined
      expect(result).toBeUndefined()
    })
  })

  describe('DELETE /devices/:token (unregister)', () => {
    test('delegates to domain service with authenticated courier id and token parameter', async () => {
      const token = 'fcm-push-token-abc'

      const result = await controller.unregister(token, mockCourier)

      // AC-1: DELETE removes only the caller's own token
      expect(mockCourierDeviceDomainService.unregister).toHaveBeenCalledWith('courier-auth-123', token)
      expect(result).toBeUndefined()
    })

    test('returns 204 (undefined) even if token was unknown or already deleted', async () => {
      mockCourierDeviceDomainService.unregister.mockResolvedValue(undefined)

      const result = await controller.unregister('unknown-token', mockCourier)

      expect(mockCourierDeviceDomainService.unregister).toHaveBeenCalledWith('courier-auth-123', 'unknown-token')
      expect(result).toBeUndefined()
    })
  })

  describe('CourierDeviceRegisterCourierInput validation', () => {
    test('passes validation with valid Android and iOS payloads', async () => {
      const androidInput = plainToInstance(CourierDeviceRegisterCourierInput, {
        token: 'valid-fcm-android-token',
        platform: EnumDevicePlatform.ANDROID,
      })
      const androidErrors = await validate(androidInput)
      expect(androidErrors).toHaveLength(0)

      const iosInput = plainToInstance(CourierDeviceRegisterCourierInput, {
        token: 'valid-apns-ios-token',
        platform: EnumDevicePlatform.IOS,
      })
      const iosErrors = await validate(iosInput)
      expect(iosErrors).toHaveLength(0)
    })

    test('fails validation when token is missing or empty', async () => {
      const missingToken = plainToInstance(CourierDeviceRegisterCourierInput, {
        platform: EnumDevicePlatform.ANDROID,
      })
      const missingTokenErrors = await validate(missingToken)
      expect(missingTokenErrors.length).toBeGreaterThan(0)
      expect(missingTokenErrors.some((e) => e.property === 'token')).toBe(true)

      const emptyToken = plainToInstance(CourierDeviceRegisterCourierInput, {
        token: '',
        platform: EnumDevicePlatform.ANDROID,
      })
      const emptyTokenErrors = await validate(emptyToken)
      expect(emptyTokenErrors.length).toBeGreaterThan(0)
      expect(emptyTokenErrors.some((e) => e.property === 'token')).toBe(true)
    })

    test('fails validation when token exceeds 4096 characters', async () => {
      const tooLongToken = plainToInstance(CourierDeviceRegisterCourierInput, {
        token: 'a'.repeat(4097),
        platform: EnumDevicePlatform.ANDROID,
      })
      const errors = await validate(tooLongToken)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((e) => e.property === 'token')).toBe(true)
    })

    test('fails validation when platform is invalid or missing', async () => {
      const invalidPlatform = plainToInstance(CourierDeviceRegisterCourierInput, {
        token: 'valid-token',
        platform: 'WINDOWS' as any,
      })
      const invalidPlatformErrors = await validate(invalidPlatform)
      expect(invalidPlatformErrors.length).toBeGreaterThan(0)
      expect(invalidPlatformErrors.some((e) => e.property === 'platform')).toBe(true)

      const missingPlatform = plainToInstance(CourierDeviceRegisterCourierInput, {
        token: 'valid-token',
      })
      const missingPlatformErrors = await validate(missingPlatform)
      expect(missingPlatformErrors.length).toBeGreaterThan(0)
      expect(missingPlatformErrors.some((e) => e.property === 'platform')).toBe(true)
    })
  })
})
