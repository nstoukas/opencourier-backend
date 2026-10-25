import { Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { Server } from 'socket.io'
import { ForbiddenException } from 'src/errors'
import { UserRepository } from 'src/persistence/repositories/user.repository'
import { SocketIOAdapter } from './socketio.adapter'
import { SOCKET_GATEWAY_NAMESPACE } from './socketio.gateway'

describe('SocketIOAdapter token middleware (row 57 credential leak prevention)', () => {
  let mockJwtService: { verify: jest.Mock }
  let mockUserRepository: { findUserWithEmail: jest.Mock }
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
    mockApp = {
      get: jest.fn((token) => {
        if (token === JwtService) return mockJwtService
        if (token === UserRepository) return mockUserRepository
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
})
