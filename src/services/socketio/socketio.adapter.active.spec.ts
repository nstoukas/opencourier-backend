import { Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { Server } from 'socket.io'
import { AccountDeactivatedException, CredentialsChangedException, ErrorCode, ForbiddenException } from 'src/errors'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { CREDENTIALS_CHANGED_MESSAGE } from 'src/domains/auth/credentials-change'
import { UserRepository } from 'src/persistence/repositories/user.repository'
import { EnumUserRole } from '@prisma/types'
import { SocketIOAdapter } from './socketio.adapter'
import { SOCKET_GATEWAY_NAMESPACE } from './socketio.gateway'
import { ADMIN_SOCKET_NAMESPACE } from './admin-socket.gateway'

describe('SocketIOAdapter token middleware (row 57 credential leak prevention)', () => {
  let mockJwtService: { verify: jest.Mock }
  let mockUserRepository: { findUserWithEmail: jest.Mock }
  // Spec 0051: the handshake asks whether the rider's account is deactivated. Active unless a test says so.
  let mockCourierRepository: { isUserDeactivated: jest.Mock }
  let mockApp: { get: jest.Mock }
  let mockConfigService: Record<string, any>
  let adapter: SocketIOAdapter
  let middleware: (socket: any, next: (err?: any) => void) => Promise<void>
  let loggerSpies: jest.SpyInstance[]

  // Helper to assert that no logged argument from any method contains the raw bearer token.
  const assertNoLoggedStringContains = (rawToken: string) => {
    for (const spy of loggerSpies) {
      for (const callArgs of spy.mock.calls) {
        for (const arg of callArgs) {
          if (typeof arg === 'string') {
            expect(arg).not.toContain(rawToken)
          } else if (arg && typeof arg === 'object') {
            expect(JSON.stringify(arg)).not.toContain(rawToken)
          }
        }
      }
    }
  }

  beforeEach(() => {
    mockJwtService = {
      verify: jest.fn(),
    }
    mockUserRepository = {
      findUserWithEmail: jest.fn(),
    }
    mockCourierRepository = {
      isUserDeactivated: jest.fn().mockResolvedValue(false),
    }
    mockApp = {
      get: jest.fn((token) => {
        if (token === JwtService) return mockJwtService
        if (token === UserRepository) return mockUserRepository
        if (token === CourierRepository) return mockCourierRepository
        return null
      }),
    }
    mockConfigService = {}

    // Mock IoAdapter.createIOServer so we don't open real network ports or http servers in tests.
    jest.spyOn(IoAdapter.prototype, 'createIOServer').mockImplementation(() => new Server())

    adapter = new SocketIOAdapter(mockApp as any, mockConfigService as any)

    const logger = (adapter as any).logger
    loggerSpies = [
      jest.spyOn(logger, 'debug'),
      jest.spyOn(logger, 'log'),
      jest.spyOn(logger, 'warn'),
      jest.spyOn(logger, 'error'),
      jest.spyOn(logger, 'verbose'),
    ]

    // Create the server to initialize the namespace and middleware.
    const server = adapter.createIOServer(0, {} as any)
    const namespace = server.of(SOCKET_GATEWAY_NAMESPACE)
    middleware = (namespace as any)._fns[0]
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('token logging security', () => {
    it('never passes the raw bearer token to any logger method during successful validation', async () => {
      const rawToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.courier-token-secret-12345'
      mockJwtService.verify.mockReturnValue({
        sub: 'courier-user-1',
        email: 'courier@example.com',
        role: ['COURIER'],
      })
      mockUserRepository.findUserWithEmail.mockResolvedValue({
        id: 'courier-user-1',
        email: 'courier@example.com',
        role: [EnumUserRole.COURIER],
      })

      const socket: any = {
        handshake: {
          auth: { authorization: `Bearer ${rawToken}` },
          headers: {},
        },
      }
      const next = jest.fn()

      await middleware(socket, next)

      expect(next).toHaveBeenCalledWith()
      expect(socket.userId).toBe('courier-user-1')
      expect(socket.role).toEqual(['COURIER'])
      expect(socket.channelNames).toEqual(['COURIER:courier-user-1'])

      // Verify logger was called (e.g. logger.debug for validation start),
      // but crucially, ensure the raw token was never passed into any log call.
      const debugSpy = (adapter as any).logger.debug
      expect(debugSpy).toHaveBeenCalled()
      assertNoLoggedStringContains(rawToken)
    })

    it('never passes the raw bearer token to any logger method when token is in handshake headers', async () => {
      const rawToken = 'courier-header-auth-token-secret-67890'
      mockJwtService.verify.mockReturnValue({
        sub: 'courier-user-2',
        email: 'rider@example.com',
        role: ['COURIER'],
      })
      mockUserRepository.findUserWithEmail.mockResolvedValue({
        id: 'courier-user-2',
        email: 'rider@example.com',
        role: [EnumUserRole.COURIER],
      })

      const socket: any = {
        handshake: {
          auth: {},
          headers: { authorization: `Bearer ${rawToken}` },
        },
      }
      const next = jest.fn()

      await middleware(socket, next)

      expect(next).toHaveBeenCalledWith()
      expect(socket.userId).toBe('courier-user-2')
      assertNoLoggedStringContains(rawToken)
    })

    it('never passes the raw bearer token to any logger method when JWT verification fails', async () => {
      const rawToken = 'invalid-tampered-token-secret-99999'
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired or signature invalid')
      })

      const socket: any = {
        handshake: {
          auth: { authorization: `Bearer ${rawToken}` },
          headers: {},
        },
      }
      const next = jest.fn()

      await middleware(socket, next)

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException))
      expect(next.mock.calls[0][0].message).toBe('Invalid token')
      assertNoLoggedStringContains(rawToken)
    })

    it('never passes the raw bearer token to any logger method when user is not found in database', async () => {
      const rawToken = 'unregistered-courier-token-secret-77777'
      mockJwtService.verify.mockReturnValue({
        sub: 'courier-unknown',
        email: 'unknown@example.com',
        role: ['COURIER'],
      })
      mockUserRepository.findUserWithEmail.mockResolvedValue(null)

      const socket: any = {
        handshake: {
          auth: { authorization: `Bearer ${rawToken}` },
          headers: {},
        },
      }
      const next = jest.fn()

      await middleware(socket, next)

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException))
      expect(next.mock.calls[0][0].message).toBe('User not found')
      assertNoLoggedStringContains(rawToken)
    })
  })

  describe('middleware validation edge cases', () => {
    it('rejects connection when authorization header is missing', async () => {
      const socket: any = {
        handshake: {
          auth: {},
          headers: {},
        },
      }
      const next = jest.fn()

      await middleware(socket, next)

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException))
      expect(next.mock.calls[0][0].message).toBe('Invalid token')
      expect(mockJwtService.verify).not.toHaveBeenCalled()
    })

    it('rejects connection when authorization header does not use Bearer scheme', async () => {
      const socket: any = {
        handshake: {
          auth: { authorization: 'Basic dXNlcjpwYXNz' },
          headers: {},
        },
      }
      const next = jest.fn()

      await middleware(socket, next)

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException))
      expect(next.mock.calls[0][0].message).toBe('Invalid token')
      expect(mockJwtService.verify).not.toHaveBeenCalled()
    })

    it('attaches channel names for multiple user roles', async () => {
      const rawToken = 'multi-role-courier-token-secret'
      mockJwtService.verify.mockReturnValue({
        sub: 'admin-and-courier-user',
        email: 'admin@coop.gr',
        role: ['COURIER', 'ADMIN'],
      })
      mockUserRepository.findUserWithEmail.mockResolvedValue({
        id: 'admin-and-courier-user',
        email: 'admin@coop.gr',
        role: [EnumUserRole.COURIER, EnumUserRole.ADMIN],
      })

      const socket: any = {
        handshake: {
          auth: { authorization: `Bearer ${rawToken}` },
          headers: {},
        },
      }
      const next = jest.fn()

      await middleware(socket, next)

      expect(next).toHaveBeenCalledWith()
      expect(socket.channelNames).toEqual([
        'COURIER:admin-and-courier-user',
        'ADMIN:admin-and-courier-user',
      ])
      assertNoLoggedStringContains(rawToken)
    })
  })

  describe('Spec 0013 AC-5: socket handshake credentials change cut off', () => {
    test('refuses connection with 401 CredentialsChangedException, code CREDENTIALS_CHANGED in the error data, when token was issued before credentialsChangedAt', async () => {
      const changeDate = new Date('2026-11-01T12:00:10.000Z')
      const changeSeconds = Math.floor(changeDate.getTime() / 1000)

      mockJwtService.verify.mockReturnValue({
        sub: 'courier-user-1',
        email: 'rider@coop.gr',
        role: ['COURIER'],
        iat: changeSeconds - 5,
      })
      mockUserRepository.findUserWithEmail.mockResolvedValue({
        id: 'courier-user-1',
        email: 'rider@coop.gr',
        role: [EnumUserRole.COURIER],
        credentialsChangedAt: changeDate,
      })

      const socket: any = {
        handshake: {
          auth: { authorization: 'Bearer old-token-before-change' },
          headers: {},
        },
      }
      const next = jest.fn()

      await middleware(socket, next)

      expect(next).toHaveBeenCalledTimes(1)
      const err = next.mock.calls[0][0]
      // Spec 0051 (cross check 3): its own code, carried in `data`, which socket.io sends to the client.
      expect(err).toBeInstanceOf(CredentialsChangedException)
      expect(err.getStatus()).toBe(401)
      expect(err.message).toBe(CREDENTIALS_CHANGED_MESSAGE)
      expect(err.message).toBe('Your password or login email was changed. Log in again.')
      expect(err.data).toEqual({ code: ErrorCode.CREDENTIALS_CHANGED })
      expect(socket.userId).toBeUndefined()
    })

    test('accepts connection when token was issued after credentialsChangedAt', async () => {
      const changeDate = new Date('2026-11-01T12:00:10.000Z')
      const changeSeconds = Math.floor(changeDate.getTime() / 1000)

      mockJwtService.verify.mockReturnValue({
        sub: 'courier-user-1',
        email: 'rider@coop.gr',
        role: ['COURIER'],
        iat: changeSeconds + 5,
      })
      mockUserRepository.findUserWithEmail.mockResolvedValue({
        id: 'courier-user-1',
        email: 'rider@coop.gr',
        role: [EnumUserRole.COURIER],
        credentialsChangedAt: changeDate,
      })

      const socket: any = {
        handshake: {
          auth: { authorization: 'Bearer new-token-after-change' },
          headers: {},
        },
      }
      const next = jest.fn()

      await middleware(socket, next)

      expect(next).toHaveBeenCalledWith()
      expect(socket.userId).toBe('courier-user-1')
    })

    test('accepts connection when token was issued in the same second as credentialsChangedAt (iat === changeSeconds)', async () => {
      const changeDate = new Date('2026-11-01T12:00:10.000Z')
      const changeSeconds = Math.floor(changeDate.getTime() / 1000)

      mockJwtService.verify.mockReturnValue({
        sub: 'courier-user-1',
        email: 'rider@coop.gr',
        role: ['COURIER'],
        iat: changeSeconds,
      })
      mockUserRepository.findUserWithEmail.mockResolvedValue({
        id: 'courier-user-1',
        email: 'rider@coop.gr',
        role: [EnumUserRole.COURIER],
        credentialsChangedAt: changeDate,
      })

      const socket: any = {
        handshake: {
          auth: { authorization: 'Bearer same-second-token' },
          headers: {},
        },
      }
      const next = jest.fn()

      await middleware(socket, next)

      expect(next).toHaveBeenCalledWith()
      expect(socket.userId).toBe('courier-user-1')
    })
  })

  // Spec 0051 (AC-2, AC-11, cross checks 2 and 3): a deactivated rider cannot open a live connection.
  describe('Spec 0051: a deactivated rider cannot open a socket (AC-2)', () => {
    const riderSocket = (): any => ({
      handshake: { auth: { authorization: 'Bearer rider-token' }, headers: {} },
    })

    test('refuses with 401 AccountDeactivatedException, the sentence, and code ACCOUNT_DEACTIVATED in the error data', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 'courier-user-1', email: 'rider@coop.gr', role: ['COURIER'] })
      mockUserRepository.findUserWithEmail.mockResolvedValue({
        id: 'courier-user-1',
        email: 'rider@coop.gr',
        role: [EnumUserRole.COURIER],
        credentialsChangedAt: null,
      })
      mockCourierRepository.isUserDeactivated.mockResolvedValue(true)

      const socket = riderSocket()
      const next = jest.fn()
      await middleware(socket, next)

      expect(mockCourierRepository.isUserDeactivated).toHaveBeenCalledWith('courier-user-1')
      expect(next).toHaveBeenCalledTimes(1)
      const err = next.mock.calls[0][0]
      expect(err).toBeInstanceOf(AccountDeactivatedException)
      expect(err.getStatus()).toBe(401)
      expect(err.message).toBe(
        'Your account was deactivated by the co-op. If you think this is a mistake, contact the co-op.'
      )
      expect(err.data).toEqual({ code: ErrorCode.ACCOUNT_DEACTIVATED })
      // Nothing of the connection was set up.
      expect(socket.userId).toBeUndefined()
      expect(socket.channelNames).toBeUndefined()
    })

    test('checked before the credentials change: an old token of a deactivated rider answers ACCOUNT_DEACTIVATED', async () => {
      const changeDate = new Date('2026-11-21T09:00:00.000Z')
      mockJwtService.verify.mockReturnValue({
        sub: 'courier-user-1',
        email: 'rider@coop.gr',
        role: ['COURIER'],
        iat: Math.floor(changeDate.getTime() / 1000) - 3600,
      })
      mockUserRepository.findUserWithEmail.mockResolvedValue({
        id: 'courier-user-1',
        email: 'rider@coop.gr',
        role: [EnumUserRole.COURIER],
        credentialsChangedAt: changeDate,
      })
      mockCourierRepository.isUserDeactivated.mockResolvedValue(true)

      const next = jest.fn()
      await middleware(riderSocket(), next)

      const err = next.mock.calls[0][0]
      expect(err).toBeInstanceOf(AccountDeactivatedException)
      expect(err.data).toEqual({ code: ErrorCode.ACCOUNT_DEACTIVATED })
    })

    test('an active rider connects, and was asked about', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 'courier-user-1', email: 'rider@coop.gr', role: ['COURIER'] })
      mockUserRepository.findUserWithEmail.mockResolvedValue({
        id: 'courier-user-1',
        email: 'rider@coop.gr',
        role: [EnumUserRole.COURIER],
      })

      const socket = riderSocket()
      const next = jest.fn()
      await middleware(socket, next)

      expect(mockCourierRepository.isUserDeactivated).toHaveBeenCalledWith('courier-user-1')
      expect(next).toHaveBeenCalledWith()
      expect(socket.userId).toBe('courier-user-1')
    })

    test('a user with no rider (an admin) is never asked', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 'admin-user-1', email: 'admin@coop.gr', role: ['ADMIN'] })
      mockUserRepository.findUserWithEmail.mockResolvedValue({
        id: 'admin-user-1',
        email: 'admin@coop.gr',
        role: [EnumUserRole.ADMIN],
      })
      mockCourierRepository.isUserDeactivated.mockResolvedValue(true)

      const next = jest.fn()
      await middleware(riderSocket(), next)

      expect(mockCourierRepository.isUserDeactivated).not.toHaveBeenCalled()
      expect(next).toHaveBeenCalledWith()
    })

    test('the admins namespace refuses a deactivated rider who is also an admin with the same code', async () => {
      const server = adapter.createIOServer(0, {} as any)
      const adminMiddleware = (server.of(ADMIN_SOCKET_NAMESPACE) as any)._fns[0]
      mockJwtService.verify.mockReturnValue({ sub: 'both-1', email: 'both@coop.gr', role: ['COURIER', 'ADMIN'] })
      mockUserRepository.findUserWithEmail.mockResolvedValue({
        id: 'both-1',
        email: 'both@coop.gr',
        role: [EnumUserRole.COURIER, EnumUserRole.ADMIN],
      })
      mockCourierRepository.isUserDeactivated.mockResolvedValue(true)

      const next = jest.fn()
      await adminMiddleware(riderSocket(), next)

      const err = next.mock.calls[0][0]
      expect(err).toBeInstanceOf(AccountDeactivatedException)
      expect(err.data).toEqual({ code: ErrorCode.ACCOUNT_DEACTIVATED })
    })
  })

  describe('admins namespace token middleware (spec 0034, AC-8 & AC-21)', () => {
    let adminMiddleware: (socket: any, next: (err?: any) => void) => Promise<void>

    beforeEach(() => {
      const server = adapter.createIOServer(0, {} as any)
      const adminNamespace = server.of(ADMIN_SOCKET_NAMESPACE)
      adminMiddleware = (adminNamespace as any)._fns[0]
    })

    test('refuses a token whose STORED user lacks the ADMIN role (adminOnly)', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'rider-user-1',
        email: 'rider@example.com',
        role: ['COURIER'],
      })
      // Stored user has only COURIER role
      mockUserRepository.findUserWithEmail.mockResolvedValue({
        id: 'rider-user-1',
        email: 'rider@example.com',
        role: [EnumUserRole.COURIER],
      })

      const socket: any = {
        handshake: {
          auth: { authorization: 'Bearer rider-token' },
          headers: {},
        },
      }
      const next = jest.fn()

      await adminMiddleware(socket, next)

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException))
      const error = next.mock.calls[0][0]
      expect(error.message).toBe('Admins only')
    })

    test('accepts a token whose STORED user has the ADMIN role', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'admin-user-1',
        email: 'admin@opencourier.org',
        role: ['ADMIN'],
      })
      mockUserRepository.findUserWithEmail.mockResolvedValue({
        id: 'admin-user-1',
        email: 'admin@opencourier.org',
        role: [EnumUserRole.ADMIN],
      })

      const socket: any = {
        handshake: {
          auth: { authorization: 'Bearer admin-token' },
          headers: {},
        },
      }
      const next = jest.fn()

      await adminMiddleware(socket, next)

      expect(next).toHaveBeenCalledWith()
      expect(socket.userId).toBe('admin-user-1')
      expect(socket.role).toEqual(['ADMIN'])
    })

    test('couriers namespace is unchanged: accepts non-admin users without requiring ADMIN role', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'courier-user-1',
        email: 'courier@opencourier.org',
        role: ['COURIER'],
      })
      mockUserRepository.findUserWithEmail.mockResolvedValue({
        id: 'courier-user-1',
        email: 'courier@opencourier.org',
        role: [EnumUserRole.COURIER],
      })

      const socket: any = {
        handshake: {
          auth: { authorization: 'Bearer courier-token' },
          headers: {},
        },
      }
      const next = jest.fn()

      await middleware(socket, next)

      expect(next).toHaveBeenCalledWith()
      expect(socket.userId).toBe('courier-user-1')
    })
  })
})
