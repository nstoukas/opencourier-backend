import { UserDomainService } from './user.domain.service'
import { UserRepository } from 'src/persistence/repositories/user.repository'

describe('UserDomainService (Row 153)', () => {
  let service: UserDomainService
  let mockUserRepository: {
    setPasswordAndRemoveApiKey: jest.Mock
  }

  beforeEach(() => {
    mockUserRepository = {
      setPasswordAndRemoveApiKey: jest.fn(),
    }
    service = new UserDomainService(mockUserRepository as unknown as UserRepository)
  })

  describe('setPasswordAndRemoveApiKey', () => {
    test('delegates to userRepository.setPasswordAndRemoveApiKey and returns result', async () => {
      const changedAt = new Date('2026-11-24T12:00:00Z')
      mockUserRepository.setPasswordAndRemoveApiKey.mockResolvedValue({ apiKeyRemoved: true })

      const result = await service.setPasswordAndRemoveApiKey('user-1', 'hashed-pw', changedAt)

      expect(mockUserRepository.setPasswordAndRemoveApiKey).toHaveBeenCalledWith('user-1', 'hashed-pw', changedAt)
      expect(result).toEqual({ apiKeyRemoved: true })
    })
  })
})
