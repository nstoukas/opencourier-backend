import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as fs from 'fs'
import * as adminApp from 'firebase-admin/app'
import * as adminMessaging from 'firebase-admin/messaging'
import {
  PushNotificationService,
  FCM_TOKEN_DEAD_CODE,
} from './pushNotification.service'
import { FIREBASE_SERVICE_ACCOUNT_PATH } from '../../constants'

// Mock firebase-admin completely; never call Google
jest.mock('firebase-admin/app', () => ({
  cert: jest.fn().mockImplementation((sa) => sa),
  getApps: jest.fn().mockReturnValue([]),
  initializeApp: jest.fn().mockReturnValue({ name: 'opencourier-push' }),
}))

jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(),
}))

jest.mock('fs', () => ({
  readFileSync: jest.fn(),
}))

describe('PushNotificationService - Spec 0003 AC-2, AC-11, Dead Tokens & Error Resilience', () => {
  let service: PushNotificationService
  let mockConfigService: jest.Mocked<ConfigService>
  let mockMessaging: {
    sendEachForMulticast: jest.Mock
  }
  let loggerLogSpy: jest.SpyInstance
  let loggerErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()

    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {})
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {})

    mockMessaging = {
      sendEachForMulticast: jest.fn(),
    }
    ;(adminMessaging.getMessaging as jest.Mock).mockReturnValue(mockMessaging)

    mockConfigService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>

    service = new PushNotificationService(mockConfigService)
  })

  afterEach(() => {
    loggerLogSpy.mockRestore()
    loggerErrorSpy.mockRestore()
  })

  describe('AC-11: Push off when FIREBASE_SERVICE_ACCOUNT_PATH is unset', () => {
    test('logs "push is off" once at startup, isEnabled is false, sends nothing', async () => {
      mockConfigService.get.mockReturnValue(undefined)

      service.onModuleInit()

      expect(service.isEnabled()).toBe(false)
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('push is off: FIREBASE_SERVICE_ACCOUNT_PATH is not set')
      )

      // Calls to sendData return empty result immediately
      const result = await service.sendData(['token-1'], { type: 'NEW_DELIVERY_OFFER' }, 300)
      expect(result).toEqual({ deadTokens: [], failureCodes: [] })
      expect(mockMessaging.sendEachForMulticast).not.toHaveBeenCalled()
    })
  })

  describe('Decision 58.6: Bad service account file turns push off without crashing', () => {
    test('missing or invalid JSON file turns push off, logs error naming path only, does not throw', () => {
      mockConfigService.get.mockReturnValue('/etc/opencourier/invalid-key.json')
      ;(fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory')
      })

      expect(() => service.onModuleInit()).not.toThrow()

      expect(service.isEnabled()).toBe(false)
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('push is off: the service account file at /etc/opencourier/invalid-key.json could not be read')
      )
    })

    test('corrupted JSON content in key file turns push off gracefully', () => {
      mockConfigService.get.mockReturnValue('/etc/opencourier/corrupted.json')
      ;(fs.readFileSync as jest.Mock).mockReturnValue('{ not-valid-json: ')

      expect(() => service.onModuleInit()).not.toThrow()

      expect(service.isEnabled()).toBe(false)
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('push is off: the service account file at /etc/opencourier/corrupted.json could not be read')
      )
    })
  })

  describe('Push on when valid service account file is configured', () => {
    test('initializes firebase app and messaging, logs project id, isEnabled is true', () => {
      mockConfigService.get.mockReturnValue('/etc/opencourier/valid-service-account.json')
      ;(fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ project_id: 'opencourier-prod-123' })
      )

      service.onModuleInit()

      expect(service.isEnabled()).toBe(true)
      expect(adminApp.initializeApp).toHaveBeenCalledWith(
        { credential: { project_id: 'opencourier-prod-123' } },
        'opencourier-push'
      )
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('push is on: Firebase project opencourier-prod-123')
      )
    })
  })

  describe('sendData (AC-2 High Priority, Dead Token Detection, Failure Resilience)', () => {
    beforeEach(() => {
      mockConfigService.get.mockReturnValue('/etc/opencourier/key.json')
      ;(fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ project_id: 'test-p' }))
      service.onModuleInit()
    })

    test('sends high-priority data message with converted millisecond TTL', async () => {
      mockMessaging.sendEachForMulticast.mockResolvedValue({
        responses: [{ success: true }, { success: true }],
      })

      const tokens = ['device-token-1', 'device-token-2']
      const data = { type: 'NEW_DELIVERY_OFFER', deliveryId: 'del-1' }
      const ttlSeconds = 120

      const result = await service.sendData(tokens, data, ttlSeconds)

      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith({
        tokens,
        data,
        android: {
          priority: 'high',
          ttl: 120000, // 120 s in ms
        },
      })
      expect(result).toEqual({ deadTokens: [], failureCodes: [] })
    })

    test('returns early without sending if tokens array is empty', async () => {
      const result = await service.sendData([], { type: 'NEW_DELIVERY_OFFER' }, 300)

      expect(result).toEqual({ deadTokens: [], failureCodes: [] })
      expect(mockMessaging.sendEachForMulticast).not.toHaveBeenCalled()
    })

    test('clamps negative TTL to 0 ms', async () => {
      mockMessaging.sendEachForMulticast.mockResolvedValue({ responses: [] })

      await service.sendData(['token-1'], { type: 'OFFER_ENDED' }, -5)

      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith(
        expect.objectContaining({
          android: expect.objectContaining({ ttl: 0 }),
        })
      )
    })

    test('AC-1: segregates dead tokens (FCM_TOKEN_DEAD_CODE) from other failure codes', async () => {
      // Token 1: succeeded
      // Token 2: dead token (registration-token-not-registered) -> must be in deadTokens
      // Token 3: invalid argument -> must be in failureCodes
      // Token 4: internal error with no code -> fallback to 'unknown' in failureCodes
      mockMessaging.sendEachForMulticast.mockResolvedValue({
        responses: [
          { success: true },
          {
            success: false,
            error: { code: FCM_TOKEN_DEAD_CODE, message: 'Token no longer registered' },
          },
          {
            success: false,
            error: { code: 'messaging/invalid-argument', message: 'Malformed payload' },
          },
          {
            success: false,
            error: null,
          },
        ],
      })

      const tokens = ['tok-ok', 'tok-dead', 'tok-bad-arg', 'tok-no-code']
      const result = await service.sendData(tokens, { type: 'NEW_DELIVERY_OFFER' }, 300)

      expect(result.deadTokens).toEqual(['tok-dead'])
      expect(result.failureCodes).toEqual(['messaging/invalid-argument', 'unknown'])
    })

    test('never throws when multicast call throws; returns failure codes for all tokens', async () => {
      const networkError = new Error('Network timeout to FCM')
      ;(networkError as any).code = 'messaging/server-unavailable'
      mockMessaging.sendEachForMulticast.mockRejectedValue(networkError)

      const tokens = ['tok-1', 'tok-2']
      const result = await service.sendData(tokens, { type: 'NEW_DELIVERY_OFFER' }, 300)

      // AC-2: Never throws into dispatch/offer path
      expect(result.deadTokens).toEqual([])
      expect(result.failureCodes).toEqual(['messaging/server-unavailable', 'messaging/server-unavailable'])
    })
  })
})
