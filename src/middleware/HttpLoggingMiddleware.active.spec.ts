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

    test('drops query string for chat read routes to prevent leaking message ids as read receipts (spec 0034, AC-6)', () => {
      // Courier: GET /api/courier/v1/chat/messages?after=msg-123
      expect(redactSensitivePath('/api/courier/v1/chat/messages?after=msg-123')).toBe('/api/courier/v1/chat/messages')
      // Partner: GET /api/partner/v1/chat/messages?after=msg-456
      expect(redactSensitivePath('/api/partner/v1/chat/messages?after=msg-456')).toBe('/api/partner/v1/chat/messages')
      // Admin: GET /api/admin/v1/chat/threads/thread-1/messages?before=msg-789
      expect(redactSensitivePath('/api/admin/v1/chat/threads/thread-1/messages?before=msg-789')).toBe(
        '/api/admin/v1/chat/threads/thread-1/messages'
      )
    })

    test('keeps query string for unread-count and other chat/unrelated paths (spec 0034)', () => {
      expect(redactSensitivePath('/api/admin/v1/chat/threads/unread-count?check=1')).toBe(
        '/api/admin/v1/chat/threads/unread-count?check=1'
      )
      expect(redactSensitivePath('/api/admin/v1/chat/threads?tab=UNREAD&page=1')).toBe(
        '/api/admin/v1/chat/threads?tab=UNREAD&page=1'
      )
      expect(redactSensitivePath('/api/admin/v1/deliveries?page=2')).toBe('/api/admin/v1/deliveries?page=2')
    })

    test('keeps query string for paths that start with customers but are not /customers (AC-9)', () => {
      expect(redactSensitivePath('/customersfoo?q=1')).toBe('/customersfoo?q=1')
    })

    describe('search parameter redaction (row 96 review fix)', () => {
      test('redacts search parameter value when it is the first query parameter', () => {
        const input = '/api/admin/v1/deliveries?search=kitchen&state=active'
        expect(redactSensitivePath(input)).toBe('/api/admin/v1/deliveries?search=[redacted]&state=active')
      })

      test('redacts search parameter value when it is later in the query string', () => {
        const input = '/api/admin/v1/deliveries?perPage=1&search=kitchen&state=active'
        expect(redactSensitivePath(input)).toBe('/api/admin/v1/deliveries?perPage=1&search=[redacted]&state=active')
      })

      test('redacts search parameter value when it is the only query parameter', () => {
        const input = '/api/admin/v1/deliveries?search=Nikolaos'
        expect(redactSensitivePath(input)).toBe('/api/admin/v1/deliveries?search=[redacted]')
      })

      test('redacts search parameter value when it is at the end of the query string', () => {
        const input = '/api/admin/v1/deliveries?state=active&search=kitchen'
        expect(redactSensitivePath(input)).toBe('/api/admin/v1/deliveries?state=active&search=[redacted]')
      })

      test('redacts empty search parameter', () => {
        const input = '/api/admin/v1/deliveries?search=&page=1'
        expect(redactSensitivePath(input)).toBe('/api/admin/v1/deliveries?search=[redacted]&page=1')
      })

      test('redacts search parameter on any route and preserves fragments', () => {
        const input = '/api/partner/v1/items?search=souvlaki#section'
        expect(redactSensitivePath(input)).toBe('/api/partner/v1/items?search=[redacted]#section')
      })

      test('leaves URLs without search parameter unchanged', () => {
        const input = '/api/admin/v1/deliveries?perPage=10&state=active'
        expect(redactSensitivePath(input)).toBe('/api/admin/v1/deliveries?perPage=10&state=active')
      })

      test('still respects existing /customers query drop rule over search redaction', () => {
        // Saved customers drops entire query string per spec 0005 AC-9
        expect(redactSensitivePath('/api/partner/v1/customers?search=6912345678')).toBe('/api/partner/v1/customers')
      })

      test('redacts search alongside sensitive device tokens', () => {
        expect(redactSensitivePath('/api/courier/v1/devices/secret-token-xyz?search=courier1')).toBe(
          '/api/courier/v1/devices/:token?search=[redacted]'
        )
      })
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

    test('logs redacted search parameter on response close and never logs search query value (row 96 review fix)', () => {
      let closeHandler: (() => void) | undefined

      const mockRequest = {
        method: 'GET',
        originalUrl: '/api/admin/v1/deliveries?perPage=1&search=kitchen&state=active',
        ip: '127.0.0.1',
        get: jest.fn().mockImplementation((header: string) => {
          if (header.toLowerCase() === 'user-agent') return 'AdminWeb/1.0'
          return undefined
        }),
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
      expect(next).toHaveBeenCalledTimes(1)
      closeHandler!()

      expect(loggerLogSpy).toHaveBeenCalledTimes(1)
      const logMessage = loggerLogSpy.mock.calls[0]![0] as string

      expect(logMessage).toContain('/api/admin/v1/deliveries?perPage=1&search=[redacted]&state=active')
      expect(logMessage).not.toContain('kitchen')
    })

    test('HttpLoggerMiddleware drops query string of chat read routes so after/before cursor is never logged (AC-6)', () => {
      const chatUrls = [
        '/api/courier/v1/chat/messages?after=msg-rider-cursor-1',
        '/api/partner/v1/chat/messages?after=msg-partner-cursor-2',
        '/api/admin/v1/chat/threads/thread-abc/messages?before=msg-admin-cursor-3',
      ]

      for (const originalUrl of chatUrls) {
        let closeHandler: (() => void) | undefined
        const mockRequest = {
          method: 'GET',
          originalUrl,
          ip: '127.0.0.1',
          get: jest.fn().mockReturnValue('TestAgent'),
        } as unknown as Request
        const mockResponse = {
          statusCode: 200,
          get: jest.fn().mockReturnValue('64'),
          on: jest.fn().mockImplementation((event: string, handler: () => void) => {
            if (event === 'close') closeHandler = handler
          }),
        } as unknown as Response

        middleware.use(mockRequest, mockResponse, jest.fn())
        closeHandler!()
      }

      expect(loggerLogSpy).toHaveBeenCalledTimes(3)
      const logs = loggerLogSpy.mock.calls.map((c) => c[0] as string)

      expect(logs[0]).toBe('GET /api/courier/v1/chat/messages 200 64 - TestAgent 127.0.0.1')
      expect(logs[0]).not.toContain('after=')
      expect(logs[0]).not.toContain('msg-rider-cursor-1')

      expect(logs[1]).toBe('GET /api/partner/v1/chat/messages 200 64 - TestAgent 127.0.0.1')
      expect(logs[1]).not.toContain('after=')
      expect(logs[1]).not.toContain('msg-partner-cursor-2')

      expect(logs[2]).toBe('GET /api/admin/v1/chat/threads/thread-abc/messages 200 64 - TestAgent 127.0.0.1')
      expect(logs[2]).not.toContain('before=')
      expect(logs[2]).not.toContain('msg-admin-cursor-3')
    })

    test('HttpLoggerMiddleware preserves query string on unread-count and unrelated paths', () => {
      let closeHandler: (() => void) | undefined
      const mockRequest = {
        method: 'GET',
        originalUrl: '/api/admin/v1/chat/threads/unread-count?poll=30',
        ip: '127.0.0.1',
        get: jest.fn().mockReturnValue('AdminWeb'),
      } as unknown as Request
      const mockResponse = {
        statusCode: 200,
        get: jest.fn().mockReturnValue('16'),
        on: jest.fn().mockImplementation((event: string, handler: () => void) => {
          if (event === 'close') closeHandler = handler
        }),
      } as unknown as Response

      middleware.use(mockRequest, mockResponse, jest.fn())
      closeHandler!()

      expect(loggerLogSpy).toHaveBeenCalledWith('GET /api/admin/v1/chat/threads/unread-count?poll=30 200 16 - AdminWeb 127.0.0.1')
    })
  })
})
