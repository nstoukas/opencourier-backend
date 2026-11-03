import { PartnerDomainService } from './partner.domain.service'
import { PartnerRepository } from 'src/persistence/repositories/partner.repository'

describe('PartnerDomainService.getPickupPoints (Spec 0018 AC-4)', () => {
  let service: PartnerDomainService
  let mockRepository: { findPickupPoints: jest.Mock }

  beforeEach(() => {
    mockRepository = {
      findPickupPoints: jest.fn(),
    }
    service = new PartnerDomainService(mockRepository as unknown as PartnerRepository)
  })

  test('delegates directly to partnerRepository.findPickupPoints', async () => {
    const points = [
      { id: 'part-1', name: 'Nosh', latitude: 39.362, longitude: 22.942 },
      { id: 'part-2', name: 'Volos Kitchen', latitude: 39.365, longitude: 22.945 },
    ]
    mockRepository.findPickupPoints.mockResolvedValueOnce(points)

    const result = await service.getPickupPoints()

    expect(mockRepository.findPickupPoints).toHaveBeenCalledTimes(1)
    expect(result).toBe(points)
  })
})

// Row 106: getMany hands the restaurants list search to the repository unchanged.
describe('PartnerDomainService.getMany search (scope row 106)', () => {
  let service: PartnerDomainService
  let mockRepository: { findManyPaginated: jest.Mock }

  beforeEach(() => {
    mockRepository = { findManyPaginated: jest.fn() }
    service = new PartnerDomainService(mockRepository as unknown as PartnerRepository)
  })

  test('passes page, perPage and search to findManyPaginated and returns its page', async () => {
    const page = { data: [], pagination: undefined }
    mockRepository.findManyPaginated.mockResolvedValueOnce(page)

    const result = await service.getMany(3, 10, 'nosh volos')

    expect(mockRepository.findManyPaginated).toHaveBeenCalledTimes(1)
    expect(mockRepository.findManyPaginated).toHaveBeenCalledWith(3, 10, 'nosh volos')
    expect(result).toBe(page)
  })

  test('passes undefined when there is no search', async () => {
    mockRepository.findManyPaginated.mockResolvedValueOnce({ data: [] })

    await service.getMany(1, 10)

    expect(mockRepository.findManyPaginated.mock.calls[0]?.[2]).toBeUndefined()
  })
})
