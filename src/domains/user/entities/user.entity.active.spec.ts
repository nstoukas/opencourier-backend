// Spec 0054 (AC-1, AC-2): User.language handling on UserEntity domain class.
// Default language is Greek ('el') on new install or when not set.
// Invalid/unknown language codes fall back safely to 'el'.
import { EnumUserRole } from '@prisma/types'
import { UserEntity } from './user.entity'

describe('UserEntity language (Spec 0054, AC-1, AC-2)', () => {
  const baseUserData = {
    id: 'user-test-1',
    email: 'user@coop.gr',
    password: 'hashed-password',
    role: [EnumUserRole.COURIER],
    username: null,
    apiKeyHash: null,
    apiKeyCreatedAt: null,
    credentialsChangedAt: null,
    createdAt: new Date('2026-11-20T10:00:00Z'),
    updatedAt: new Date('2026-11-20T10:00:00Z'),
  }

  test('defaults language to Greek (el) when language is undefined or not provided', () => {
    const user = new UserEntity(baseUserData as any)
    expect(user.language).toBe('el')
  })

  test('defaults language to Greek (el) when language is null or an unknown string', () => {
    const userWithNull = new UserEntity({ ...baseUserData, language: null as any })
    expect(userWithNull.language).toBe('el')

    const userWithUnknown = new UserEntity({ ...baseUserData, language: 'de' as any })
    expect(userWithUnknown.language).toBe('el')
  })

  test('preserves language when set to en', () => {
    const user = new UserEntity({ ...baseUserData, language: 'en' })
    expect(user.language).toBe('en')
  })

  test('preserves language when set to el', () => {
    const user = new UserEntity({ ...baseUserData, language: 'el' })
    expect(user.language).toBe('el')
  })
})
