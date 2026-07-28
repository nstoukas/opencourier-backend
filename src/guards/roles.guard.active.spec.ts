import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { RolesGuard } from './roles.guard'
import { ROLES_KEY } from '../decorators/roles.decorator'
import { EnumUserRole } from '@prisma/types'
import { UserEntity } from '../domains/user/entities/user.entity'

describe('RolesGuard', () => {
  let guard: RolesGuard
  let mockReflector: jest.Mocked<Reflector>

  // Helper to build fake ExecutionContext
  const createMockExecutionContext = (req: any): ExecutionContext => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext
  }

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

  const mockPartnerUser = new UserEntity({
    id: 'user-partner-1',
    email: 'partner@example.com',
    password: 'hashed-password',
    role: [EnumUserRole.PARTNER],
    username: 'partner1',
    apiKey: 'key-123',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  const mockAdminUser = new UserEntity({
    id: 'user-admin-1',
    email: 'admin@example.com',
    password: 'hashed-password',
    role: [EnumUserRole.ADMIN],
    username: 'admin1',
    apiKey: null,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  beforeEach(() => {
    mockReflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>

    guard = new RolesGuard(mockReflector)
  })

  test('9. Rejects COURIER bearer token on @Roles(PARTNER) route (returns false)', () => {
    // Courier attempts to access partner-only route
    mockReflector.getAllAndOverride.mockReturnValue([EnumUserRole.PARTNER])
    const context = createMockExecutionContext({ currentUser: mockCourierUser })

    const result = guard.canActivate(context)

    expect(result).toBe(false)
  })

  test('10. Allows PARTNER bearer token on @Roles(PARTNER) route (returns true)', () => {
    // Partner accesses partner-only route
    mockReflector.getAllAndOverride.mockReturnValue([EnumUserRole.PARTNER])
    const context = createMockExecutionContext({ currentUser: mockPartnerUser })

    const result = guard.canActivate(context)

    expect(result).toBe(true)
  })

  test('11. Rejects ADMIN bearer token on @Roles(PARTNER) route because ADMIN is not implicitly a PARTNER', () => {
    // Admin user on partner route returns false (role strictly checked against required array)
    mockReflector.getAllAndOverride.mockReturnValue([EnumUserRole.PARTNER])
    const context = createMockExecutionContext({ currentUser: mockAdminUser })

    const result = guard.canActivate(context)

    expect(result).toBe(false)
  })

  test('12. Rejects request when currentUser is undefined on @Roles(PARTNER) route', () => {
    // Unauthenticated request
    mockReflector.getAllAndOverride.mockReturnValue([EnumUserRole.PARTNER])
    const context = createMockExecutionContext({ currentUser: undefined })

    const result = guard.canActivate(context)

    expect(result).toBe(false)
  })

  test('13. Allows any request when route has no @Roles requirement (returns true)', () => {
    // Route without @Roles decorator allows through
    mockReflector.getAllAndOverride.mockReturnValue(undefined)
    const context = createMockExecutionContext({ currentUser: mockCourierUser })

    const result = guard.canActivate(context)

    expect(result).toBe(true)
  })
})
