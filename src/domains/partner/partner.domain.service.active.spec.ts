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
