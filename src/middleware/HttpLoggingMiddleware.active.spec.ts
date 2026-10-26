import { Request, Response } from 'express'
import { HttpLoggerMiddleware, redactSensitivePath } from './HttpLoggingMiddleware'

describe('HttpLoggingMiddleware - Spec 0003 R1 Sensitive Path Redaction in Logs', () => {
  describe('redactSensitivePath', () => {
    test('turns /api/courier/v1/devices/abc123?x=1 into /api/courier/v1/devices/:token?x=1', () => {
      const input = '/api/courier/v1/devices/abc123?x=1'
      const result = redactSensitivePath(input)
      expect(result).toBe('/api/courier/v1/devices/:token?x=1')
    })

    test('redacts push token without query string', () => {
      const input = '/api/courier/v1/devices/some-fcm-device-token-12345'
      const result = redactSensitivePath(input)
      expect(result).toBe('/api/courier/v1/devices/:token')
    })

    test('redacts root-relative /devices/token paths', () => {
      const input = '/devices/raw-token-abc#fragment'
      const result = redactSensitivePath(input)
      expect(result).toBe('/devices/:token#fragment')
    })

    test('leaves non-sensitive paths untouched', () => {
      expect(redactSensitivePath('/api/courier/v1/deliveries/del-123')).toBe('/api/courier/v1/deliveries/del-123')
      expect(redactSensitivePath('/api/partner/v1/orders?status=active')).toBe('/api/partner/v1/orders?status=active')
      expect(redactSensitivePath('/api/public/v1/metadata')).toBe('/api/public/v1/metadata')
    })

    test('drops query string for /customers paths to prevent leaking search terms (AC-9)', () => {
      expect(redactSensitivePath('/api/partner/v1/customers?q=Nikolaos')).toBe('/api/partner/v1/customers')
      expect(redactSensitivePath('/api/admin/v1/partners/p1/customers/c1?x=1')).toBe('/api/admin/v1/partners/p1/customers/c1')
      expect(redactSensitivePath('/customers?search=6912345678')).toBe('/customers')
      expect(redactSensitivePath('/customers/cust-123?force=true')).toBe('/customers/cust-123')
    })

    test('keeps query string for paths that start with customers but are not /customers (AC-9)', () => {
      expect(redactSensitivePath('/customersfoo?q=1')).toBe('/customersfoo?q=1')
    })
  })

  describe('HttpLoggerMiddleware', () => {
    let middleware: HttpLoggerMiddleware
    let loggerLogSpy: jest.SpyInstance

    beforeEach(() => {
      middleware = new HttpLoggerMiddleware()
      // Spy on private logger instance
      loggerLogSpy = jest.spyOn((middleware as any).logger, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
      loggerLogSpy.mockRestore()
    })

    test('logs redacted path on response close and preserves the rest of the log line', () => {
      let closeHandler: (() => void) | undefined

      const mockRequest = {
        method: 'DELETE',
        originalUrl: '/api/courier/v1/devices/secret-fcm-token-xyz?x=1',
        ip: '192.168.1.50',
        get: jest.fn().mockImplementation((header: string) => {
          if (header.toLowerCase() === 'user-agent') return 'CourierMobileApp/1.0'
          return undefined
        }),
      } as unknown as Request

      const mockResponse = {
        statusCode: 204,
        get: jest.fn().mockImplementation((header: string) => {
          if (header.toLowerCase() === 'content-length') return '0'
          return undefined
        }),
        on: jest.fn().mockImplementation((event: string, handler: () => void) => {
          if (event === 'close') {
            closeHandler = handler
          }
        }),
      } as unknown as Response

      const next = jest.fn()

      middleware.use(mockRequest, mockResponse, next)

      // next() should be called immediately
      expect(next).toHaveBeenCalledTimes(1)

      // Log is emitted on response close
      expect(closeHandler).toBeDefined()
      closeHandler!()

      expect(loggerLogSpy).toHaveBeenCalledTimes(1)
      const logMessage = loggerLogSpy.mock.calls[0]![0] as string

      // The URL path segment must be replaced with :token, query param preserved
      expect(logMessage).toContain('/api/courier/v1/devices/:token?x=1')
      // The secret token itself must never appear in the log
      expect(logMessage).not.toContain('secret-fcm-token-xyz')
      // Method, status code, IP and user-agent should remain intact
      expect(logMessage).toContain('DELETE')
      expect(logMessage).toContain('204')
      expect(logMessage).toContain('192.168.1.50')
      expect(logMessage).toContain('CourierMobileApp/1.0')
    })

    test('logs unmodified path for non-sensitive endpoints', () => {
      let closeHandler: (() => void) | undefined

      const mockRequest = {
        method: 'GET',
        originalUrl: '/api/courier/v1/deliveries/del-456?filter=today',
        ip: '127.0.0.1',
        get: jest.fn().mockReturnValue('TestAgent'),
      } as unknown as Request

      const mockResponse = {
        statusCode: 200,
        get: jest.fn().mockReturnValue('128'),
        on: jest.fn().mockImplementation((event: string, handler: () => void) => {
          if (event === 'close') {
            closeHandler = handler
          }
        }),
      } as unknown as Response

      const next = jest.fn()

      middleware.use(mockRequest, mockResponse, next)
      closeHandler!()

      expect(loggerLogSpy).toHaveBeenCalledWith('GET /api/courier/v1/deliveries/del-456?filter=today 200 128 - TestAgent 127.0.0.1')
    })
  })
})
