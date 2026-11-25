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
      delete: jest.fn().mockResolvedValue(undefined),
      findByAddress: jest.fn(),
    }
    service = new LocationDomainService(mockLocationRepository as LocationRepository)
  })

  describe('delete (Row 166)', () => {
    it('delegates deletion to locationRepository.delete with the given locationId', async () => {
      const locationId = 'loc-unused-1'
      await service.delete(locationId)

      expect(mockLocationRepository.delete).toHaveBeenCalledTimes(1)
      expect(mockLocationRepository.delete).toHaveBeenCalledWith(locationId)
    })
  })
})
