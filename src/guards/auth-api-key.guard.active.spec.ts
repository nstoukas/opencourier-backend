import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthApiKeyGuard } from './auth-api-key.guard'
import { IS_API_KEY_AUTH } from 'src/decorators/api-key-auth.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { EnumUserRole } from '@prisma/types'

describe('AuthApiKeyGuard (Spec 0037, AC-6)', () => {
  let guard: AuthApiKeyGuard
  let mockReflector: jest.Mocked<Reflector>

  // Helper to construct NestJS ExecutionContext with custom request object
  const createMockExecutionContext = (req: any): ExecutionContext => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext
  }

  const mockPartnerUser = new UserEntity({
    id: 'user-partner-1',
    email: 'partner@example.com',
    password: 'hashed-password',
    role: [EnumUserRole.PARTNER],
    username: 'partner1',
    apiKeyHash: 'hash-123',
    apiKeyCreatedAt: new Date('2026-07-01T10:00:00Z'),
    credentialsChangedAt: null,
    language: 'el',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  const mockCourierUser = new UserEntity({
    id: 'user-courier-1',
    email: 'courier@example.com',
    password: 'hashed-password',
    role: [EnumUserRole.COURIER],
    username: 'courier1',
    apiKeyHash: null,
    apiKeyCreatedAt: null,
    credentialsChangedAt: null,
    language: 'el',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  beforeEach(() => {
    mockReflector = {
      get: jest.fn(),
    } as unknown as jest.Mocked<Reflector>

    // Spec 0037: Guard takes only Reflector; does no database lookup of its own
    guard = new AuthApiKeyGuard(mockReflector)
  })

  test('1. Non-@ApiKeyAuth() route returns true without checking req.currentUser', () => {
    mockReflector.get.mockReturnValue(undefined)
    const context = createMockExecutionContext({ currentUser: undefined })

    const result = guard.canActivate(context)

    expect(result).toBe(true)
  })

  test('2. @ApiKeyAuth() route with authenticated partner UserEntity returns true', () => {
    mockReflector.get.mockImplementation((key) => key === IS_API_KEY_AUTH)
    const req = {
      currentUser: mockPartnerUser,
    }
    const context = createMockExecutionContext(req)

    const result = guard.canActivate(context)

    expect(result).toBe(true)
  })

  test('3. @ApiKeyAuth() route with authenticated courier UserEntity returns true (roles handled by RolesGuard)', () => {
    mockReflector.get.mockImplementation((key) => key === IS_API_KEY_AUTH)
    const req = {
      currentUser: mockCourierUser,
    }
    const context = createMockExecutionContext(req)

    const result = guard.canActivate(context)

    expect(result).toBe(true)
  })

  test('4. @ApiKeyAuth() route returns false when req.currentUser is undefined', () => {
    mockReflector.get.mockImplementation((key) => key === IS_API_KEY_AUTH)
    const req = {
      currentUser: undefined,
    }
    const context = createMockExecutionContext(req)

    const result = guard.canActivate(context)

    expect(result).toBe(false)
  })

  test('5. @ApiKeyAuth() route returns false when req.currentUser is null', () => {
    mockReflector.get.mockImplementation((key) => key === IS_API_KEY_AUTH)
    const req = {
      currentUser: null,
    }
    const context = createMockExecutionContext(req)

    const result = guard.canActivate(context)

    expect(result).toBe(false)
  })

  test('6. @ApiKeyAuth() route returns false for a plain object (not an instance of UserEntity)', () => {
    mockReflector.get.mockImplementation((key) => key === IS_API_KEY_AUTH)
    const req = {
      currentUser: { id: 'spoofed-1', role: [EnumUserRole.PARTNER], email: 'partner@example.com' },
    }
    const context = createMockExecutionContext(req)

    const result = guard.canActivate(context)

    expect(result).toBe(false)
  })

  test('7. Guard does no lookup of its own: does not inspect headers, query parameters, or repositories (AC-6)', () => {
    mockReflector.get.mockImplementation((key) => key === IS_API_KEY_AUTH)
    // Even if x-api-key header or query param is present on the request, if currentUser is undefined, guard returns false
    const req = {
      headers: { 'x-api-key': 'valid-key' },
      query: { api_key: 'valid-key' },
      currentUser: undefined,
    }
    const context = createMockExecutionContext(req)

    const result = guard.canActivate(context)

    expect(result).toBe(false)
    expect(req.currentUser).toBeUndefined()
  })
})
