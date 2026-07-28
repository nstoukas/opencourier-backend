import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthApiKeyGuard } from './auth-api-key.guard'
import { IS_API_KEY_AUTH } from 'src/decorators/api-key-auth.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { UserRepository } from 'src/persistence/repositories/user.repository'
import { EnumUserRole } from '@prisma/types'

describe('AuthApiKeyGuard', () => {
  let guard: AuthApiKeyGuard
  let mockReflector: jest.Mocked<Reflector>
  let mockUserRepository: jest.Mocked<UserRepository>

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

  // Standard valid partner UserEntity instance
  const mockPartnerUser = new UserEntity({
    id: 'user-partner-1',
    email: 'partner@example.com',
    password: 'hashed-password',
    role: [EnumUserRole.PARTNER],
    username: 'partner1',
    apiKey: 'valid-api-key-123',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  // Standard valid courier UserEntity instance
  const mockCourierUser = new UserEntity({
    id: 'user-courier-1',
    email: 'courier@example.com',
    password: 'hashed-password',
    role: [EnumUserRole.COURIER],
    username: 'courier1',
    apiKey: null,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  beforeEach(() => {
    mockReflector = {
      get: jest.fn(),
    } as unknown as jest.Mocked<Reflector>

    mockUserRepository = {
      findByApiKey: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>

    guard = new AuthApiKeyGuard(mockReflector, mockUserRepository)
  })

  test('1. Non-@ApiKeyAuth() route returns true without querying database', async () => {
    // When route metadata IS_API_KEY_AUTH is undefined/false, guard short-circuits
    mockReflector.get.mockReturnValue(undefined)
    const context = createMockExecutionContext({ headers: {} })

    const result = await guard.canActivate(context)

    expect(result).toBe(true)
    expect(mockUserRepository.findByApiKey).not.toHaveBeenCalled()
  })

  test('2. API key route with x-api-key header and authenticated UserEntity returns true without duplicate DB lookup', async () => {
    // Request has both x-api-key header and an already-populated currentUser UserEntity
    mockReflector.get.mockImplementation((key) => key === IS_API_KEY_AUTH)
    const req = {
      headers: { 'x-api-key': 'valid-api-key-123' },
      currentUser: mockPartnerUser,
    }
    const context = createMockExecutionContext(req)

    const result = await guard.canActivate(context)

    expect(result).toBe(true)
    // Guard uses existing req.currentUser rather than querying DB again
    expect(mockUserRepository.findByApiKey).not.toHaveBeenCalled()
  })

  test('3. API key fallback intact when x-api-key header present and currentUser is undefined', async () => {
    // Request has API key header but no currentUser set by middleware yet
    mockReflector.get.mockImplementation((key) => key === IS_API_KEY_AUTH)
    mockUserRepository.findByApiKey.mockResolvedValue(mockPartnerUser)
    const req: any = {
      headers: { 'x-api-key': 'valid-api-key-123' },
      currentUser: undefined,
    }
    const context = createMockExecutionContext(req)

    const result = await guard.canActivate(context)

    expect(result).toBe(true)
    expect(mockUserRepository.findByApiKey).toHaveBeenCalledWith('valid-api-key-123')
    expect(req.currentUser).toBe(mockPartnerUser)
  })

  test('4. Query parameter api_key resolves user when valid and returns false when unknown', async () => {
    mockReflector.get.mockImplementation((key) => key === IS_API_KEY_AUTH)
    mockUserRepository.findByApiKey.mockResolvedValueOnce(mockPartnerUser)

    // Sub-case A: Valid query parameter api_key
    const validReq: any = {
      headers: {},
      query: { api_key: 'query-key-789' },
      currentUser: undefined,
    }
    const validResult = await guard.canActivate(createMockExecutionContext(validReq))
    expect(validResult).toBe(true)
    expect(mockUserRepository.findByApiKey).toHaveBeenCalledWith('query-key-789')
    expect(validReq.currentUser).toBe(mockPartnerUser)

    // Sub-case B: Unknown query parameter api_key returns false
    mockUserRepository.findByApiKey.mockResolvedValueOnce(null)
    const invalidReq = {
      headers: {},
      query: { api_key: 'unknown-key-999' },
      currentUser: undefined,
    }
    const invalidResult = await guard.canActivate(createMockExecutionContext(invalidReq))
    expect(invalidResult).toBe(false)
  })

  test('5. Partner Bearer token passes (the fix): returns true when currentUser is PARTNER UserEntity and no key header', async () => {
    // Partner authenticated via Bearer token: no x-api-key header present, but currentUser is UserEntity
    mockReflector.get.mockImplementation((key) => key === IS_API_KEY_AUTH)
    const req = {
      headers: {},
      query: {},
      currentUser: mockPartnerUser,
    }
    const context = createMockExecutionContext(req)

    const result = await guard.canActivate(context)

    expect(result).toBe(true)
    expect(mockUserRepository.findByApiKey).not.toHaveBeenCalled()
  })

  test('6. Guard returns true for COURIER UserEntity because role authorization is delegated to RolesGuard', async () => {
    // AuthApiKeyGuard verifies identity presence, not role permissions
    mockReflector.get.mockImplementation((key) => key === IS_API_KEY_AUTH)
    const req = {
      headers: {},
      query: {},
      currentUser: mockCourierUser,
    }
    const context = createMockExecutionContext(req)

    const result = await guard.canActivate(context)

    expect(result).toBe(true)
    expect(mockUserRepository.findByApiKey).not.toHaveBeenCalled()
  })

  test('7. Returns false when no credential or currentUser is provided', async () => {
    // Unauthenticated request with no headers, query params, or user entity
    mockReflector.get.mockImplementation((key) => key === IS_API_KEY_AUTH)
    const req = {
      headers: {},
      query: {},
      currentUser: undefined,
    }
    const context = createMockExecutionContext(req)

    const result = await guard.canActivate(context)

    expect(result).toBe(false)
    expect(mockUserRepository.findByApiKey).not.toHaveBeenCalled()
  })

  test('8. Spoofed plain object shape rejected: plain object currentUser does not short-circuit and falls through to key lookup', async () => {
    // Sub-case A: Plain object attempting to mimic UserEntity shape must fail instanceof check and fall through to key lookup (no key -> returns false)
    mockReflector.get.mockImplementation((key) => key === IS_API_KEY_AUTH)
    const req = {
      headers: {},
      query: {},
      currentUser: { id: 'spoofed-1', role: [EnumUserRole.PARTNER] },
    }
    const context = createMockExecutionContext(req)

    const result = await guard.canActivate(context)

    // Falls through instanceof check to key lookup, which finds no key -> returns false
    expect(result).toBe(false)
    expect(mockUserRepository.findByApiKey).not.toHaveBeenCalled()

    // Sub-case B: Spoofed plain object WITH valid API key header falls through to findByApiKey and attaches authenticated UserEntity
    mockUserRepository.findByApiKey.mockResolvedValueOnce(mockPartnerUser)
    const reqWithKey: any = {
      headers: { 'x-api-key': 'valid-api-key-123' },
      query: {},
      currentUser: { id: 'spoofed-1', role: [EnumUserRole.PARTNER] },
    }
    const resultWithKey = await guard.canActivate(createMockExecutionContext(reqWithKey))
    expect(resultWithKey).toBe(true)
    expect(mockUserRepository.findByApiKey).toHaveBeenCalledWith('valid-api-key-123')
    expect(reqWithKey.currentUser).toBe(mockPartnerUser)
  })
})
