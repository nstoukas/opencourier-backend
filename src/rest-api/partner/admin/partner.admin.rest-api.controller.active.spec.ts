import { PartnerAdminRestApiController } from './partner.admin.rest-api.controller'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import { PartnerAdminRestApiService } from './partner.admin.rest-api.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { EnumCountryCode } from '@prisma/types'

describe('PartnerAdminRestApiController', () => {
  let controller: PartnerAdminRestApiController
  let mockPartnerDomainService: jest.Mocked<PartnerDomainService>
  let mockPartnerAdminRestApiService: jest.Mocked<PartnerAdminRestApiService>

  const mockPartnerEntity = new PartnerEntity({
    id: 'partner-100',
    name: 'Taverna Volos',
    logo: null,
    phoneNumber: '+302421000000',
    webhookUrl: null,
    userId: 'user-200',
    pickupLocationId: 'loc-300',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
    user: { email: 'taverna@volos.gr' },
    pickupLocation: {
      id: 'loc-300',
      addressLine1: null,
      addressLine2: null,
      city: 'Volos',
      state: 'Magnesia',
      street: 'Iasonos',
      zipCode: '38221',
      countryCode: EnumCountryCode.GR,
      stateCode: 'Magnesia',
      houseNumber: '12',
      longitude: 22.944,
      latitude: 39.362,
      formattedAddress: 'Iasonos 12, Volos',
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
    },
  })

  beforeEach(() => {
    mockPartnerDomainService = {
      getMany: jest.fn(),
      getByIdOrThrow: jest.fn(),
    } as unknown as jest.Mocked<PartnerDomainService>

    mockPartnerAdminRestApiService = {
      createRestaurant: jest.fn(),
      updateRestaurant: jest.fn(),
      rotatePassword: jest.fn(),
    } as unknown as jest.Mocked<PartnerAdminRestApiService>

    controller = new PartnerAdminRestApiController(
      mockPartnerDomainService,
      mockPartnerAdminRestApiService,
    )
  })

  describe('listPartners', () => {
    test('returns paginated partner DTO from domain service getMany', async () => {
      mockPartnerDomainService.getMany.mockResolvedValue({
        data: [mockPartnerEntity],
        pagination: {
          perPage: 10,
          totalItems: 1,
          totalPages: 1,
          currentItems: 1,
          currentPage: 1,
          prevPage: null,
          nextPage: null,
        },
      })

      const result = await controller.listPartners({ page: 1, perPage: 10 })

      expect(mockPartnerDomainService.getMany).toHaveBeenCalledWith(1, 10)
      expect(result.data).toHaveLength(1)
      expect(result.data[0]?.id).toBe('partner-100')
      expect(result.pagination?.totalItems).toBe(1)
    })
  })

  describe('getPartnerById', () => {
    test('returns PartnerAdminDto for partner matching requested ID', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)

      const result = await controller.getPartnerById('partner-100')

      expect(mockPartnerDomainService.getByIdOrThrow).toHaveBeenCalledWith('partner-100')
      expect(result.id).toBe('partner-100')
      expect(result.name).toBe('Taverna Volos')
      expect(result.email).toBe('taverna@volos.gr')
    })
  })

  describe('createPartner', () => {
    test('delegates restaurant creation to admin REST API service and wraps result in DTO', async () => {
      mockPartnerAdminRestApiService.createRestaurant.mockResolvedValue(mockPartnerEntity)

      const input = {
        name: 'Taverna Volos',
        email: 'taverna@volos.gr',
        password: 'securePassword123',
      }

      const result = await controller.createPartner(input)

      expect(mockPartnerAdminRestApiService.createRestaurant).toHaveBeenCalledWith(input)
      expect(result.id).toBe('partner-100')
      expect(result.name).toBe('Taverna Volos')
    })
  })

  describe('updatePartner', () => {
    test('delegates update to admin REST API service and returns updated DTO', async () => {
      mockPartnerAdminRestApiService.updateRestaurant.mockResolvedValue(mockPartnerEntity)

      const input = { name: 'Taverna Volos Updated' }
      const result = await controller.updatePartner('partner-100', input)

      expect(mockPartnerAdminRestApiService.updateRestaurant).toHaveBeenCalledWith('partner-100', input)
      expect(result.id).toBe('partner-100')
    })
  })

  describe('rotatePartnerPassword', () => {
    test('delegates password rotation to admin REST API service and returns undefined (204 No Content)', async () => {
      mockPartnerAdminRestApiService.rotatePassword.mockResolvedValue(undefined)

      const result = await controller.rotatePartnerPassword('partner-100', { password: 'newSecurePassword123' })

      expect(mockPartnerAdminRestApiService.rotatePassword).toHaveBeenCalledWith(
        'partner-100',
        'newSecurePassword123',
      )
      expect(result).toBeUndefined()
    })
  })
})
