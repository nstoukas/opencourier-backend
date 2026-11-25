import { LocationDomainService } from './location.domain.service'
import { LocationRepository } from 'src/persistence/repositories/location.repository'

describe('LocationDomainService (Row 166: delete for unused Location rows)', () => {
  let service: LocationDomainService
  let mockLocationRepository: jest.Mocked<Partial<LocationRepository>>

  beforeEach(() => {
    mockLocationRepository = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      create: jest.fn(),
      deleteIfUnused: jest.fn().mockResolvedValue(true),
      findByAddress: jest.fn(),
    }
    service = new LocationDomainService(mockLocationRepository as LocationRepository)
  })

  describe('deleteIfUnused (Row 166)', () => {
    it('delegates deletion to locationRepository.deleteIfUnused with the given locationId and answers true', async () => {
      const locationId = 'loc-unused-1'
      mockLocationRepository.deleteIfUnused = jest.fn().mockResolvedValue(true)
      const result = await service.deleteIfUnused(locationId)

      expect(mockLocationRepository.deleteIfUnused).toHaveBeenCalledTimes(1)
      expect(mockLocationRepository.deleteIfUnused).toHaveBeenCalledWith(locationId)
      expect(result).toBe(true)
    })

    it('delegates deletion to locationRepository.deleteIfUnused and answers false when in use', async () => {
      const locationId = 'loc-in-use-1'
      mockLocationRepository.deleteIfUnused = jest.fn().mockResolvedValue(false)
      const result = await service.deleteIfUnused(locationId)

      expect(mockLocationRepository.deleteIfUnused).toHaveBeenCalledTimes(1)
      expect(mockLocationRepository.deleteIfUnused).toHaveBeenCalledWith(locationId)
      expect(result).toBe(false)
    })
  })
})
