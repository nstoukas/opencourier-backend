import { EnumCountryCode } from '@prisma/types'
import { LocationEntity } from 'src/domains/location/entities/location.entity'
import { LocationDomainService } from 'src/domains/location/location.domain.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { PartnerPartnerRestApiController } from './partner.partner.rest-api.controller'

describe('PartnerPartnerRestApiController', () => {
  let controller: PartnerPartnerRestApiController
  let mockLocationDomainService: jest.Mocked<LocationDomainService>

  // Helper object representing a partner entity with a pickup location reference
  const mockPartnerWithLocation = new PartnerEntity({
    id: 'partner-123',
    name: 'To Steki',
    logo: 'https://example.com/logo.png',
    phoneNumber: '+302421012345',
    webhookUrl: 'https://example.com/webhook',
    userId: 'user-789',
    pickupLocationId: 'loc-456',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  // Helper object representing a location domain entity
  const mockLocationEntity = new LocationEntity({
    id: 'loc-456',
    addressLine1: null,
    addressLine2: null,
    city: 'Volos',
    state: 'Magnesia',
    street: 'Koumountourou',
    zipCode: '38221',
    countryCode: EnumCountryCode.GR,
    stateCode: 'Magnesia',
    houseNumber: '15',
    longitude: 22.943,
    latitude: 39.361,
    formattedAddress: 'Koumountourou 15, Volos',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  beforeEach(() => {
    mockLocationDomainService = {
      getById: jest.fn(),
    } as unknown as jest.Mocked<LocationDomainService>

    controller = new PartnerPartnerRestApiController(mockLocationDomainService)
  })

  describe('getProfile', () => {
    test('8. returns profile DTO with mapped pickup address fields when pickupLocationId exists', async () => {
      mockLocationDomainService.getById.mockResolvedValue(mockLocationEntity)

      const result = await controller.getProfile(mockPartnerWithLocation)

      // Ensure location domain service was queried with the partner's pickupLocationId
      expect(mockLocationDomainService.getById).toHaveBeenCalledWith('loc-456')

      // Verify mapped profile DTO fields
      expect(result.name).toBe('To Steki')
      expect(result.phoneNumber).toBe('+302421012345')
      expect(result.pickupAddress).toEqual({
        street: 'Koumountourou',
        houseNumber: '15',
        city: 'Volos',
        state: 'Magnesia',
        zipCode: '38221',
        countryCode: EnumCountryCode.GR,
        latitude: 39.361,
        longitude: 22.943,
        formattedAddress: 'Koumountourou 15, Volos',
      })
    })

    test('9. returns pickupAddress: null and skips locationDomainService call when pickupLocationId is null', async () => {
      const mockPartnerWithoutLocation = new PartnerEntity({
        ...mockPartnerWithLocation,
        pickupLocationId: null,
      })

      const result = await controller.getProfile(mockPartnerWithoutLocation)

      // Location service should not be called when partner has no pickup location
      expect(mockLocationDomainService.getById).not.toHaveBeenCalled()
      expect(result.name).toBe('To Steki')
      expect(result.phoneNumber).toBe('+302421012345')
      expect(result.pickupAddress).toBeNull()
    })

    test('10. returned DTO object exposes no sensitive or internal keys (password, apiKey, userId, webhookUrl)', async () => {
      mockLocationDomainService.getById.mockResolvedValue(mockLocationEntity)

      const result = await controller.getProfile(mockPartnerWithLocation)
      const keys = Object.keys(result)

      // Ensure sensitive credentials or internal keys are not present in the DTO returned to partner API
      expect(keys).not.toContain('password')
      expect(keys).not.toContain('apiKey')
      expect(keys).not.toContain('userId')
      expect(keys).not.toContain('webhookUrl')
      expect(keys).toEqual(expect.arrayContaining(['name', 'phoneNumber', 'pickupAddress']))
    })
  })
})
