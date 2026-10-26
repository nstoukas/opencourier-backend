import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import { SavedCustomerDomainService } from 'src/domains/saved-customer/saved-customer.domain.service'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { NotFoundException } from 'src/errors'
import { SavedCustomerAdminRestApiController } from './saved-customer.admin.rest-api.controller'
import { SavedCustomerListDto, SavedCustomerResultDto } from '../partner/dtos/saved-customer.dto'

describe('SavedCustomerAdminRestApiController (AC-6)', () => {
  let controller: SavedCustomerAdminRestApiController
  let savedCustomerDomainService: jest.Mocked<SavedCustomerDomainService>
  let partnerDomainService: jest.Mocked<PartnerDomainService>

  const partnerId = 'partner-123'
  const customerId = 'cust-456'
  const mockAdminUser = new UserEntity({
    id: 'admin-user-1',
    roles: [],
  } as any)

  const sampleCustomerRecord: any = {
    id: customerId,
    partnerId,
    name: 'Nikos Dimas',
    phone: '+306912345678',
    notes: 'Floor 2',
    addressLine1: 'Iasonos 10',
    addressLine2: null,
    city: 'Volos',
    zipCode: '38221',
    latitude: 39.362,
    longitude: 22.945,
    formattedAddress: 'Iasonos 10, Volos',
    lastUsedAt: new Date('2026-05-01T12:00:00Z'),
    createdAt: new Date('2026-05-01T12:00:00Z'),
    updatedAt: new Date('2026-05-01T12:00:00Z'),
  }

  beforeEach(() => {
    savedCustomerDomainService = {
      list: jest.fn(),
      updateAsAdmin: jest.fn(),
      deleteAsAdmin: jest.fn(),
    } as any

    partnerDomainService = {
      getById: jest.fn(),
    } as any

    controller = new SavedCustomerAdminRestApiController(
      savedCustomerDomainService,
      partnerDomainService
    )
  })

  describe('list', () => {
    it('throws 404 NotFoundException when restaurant does not exist', async () => {
      partnerDomainService.getById.mockResolvedValue(null)

      await expect(
        controller.list('unknown-partner', { q: 'Nikos' })
      ).rejects.toThrow(NotFoundException)
      expect(savedCustomerDomainService.list).not.toHaveBeenCalled()
    })

    it('returns saved customer list when restaurant exists', async () => {
      partnerDomainService.getById.mockResolvedValue({ id: partnerId } as any)
      savedCustomerDomainService.list.mockResolvedValue({ items: [sampleCustomerRecord], total: 1 })

      const result = await controller.list(partnerId, { q: 'Nikos', page: 1, perPage: 20 })

      expect(savedCustomerDomainService.list).toHaveBeenCalledWith(partnerId, 'Nikos', 1, 20)
      expect(result).toBeInstanceOf(SavedCustomerListDto)
      expect(result.items.length).toBe(1)
    })
  })

  describe('update', () => {
    it('calls updateAsAdmin with admin id and strips markUsed so admin edit never marks customer used', async () => {
      savedCustomerDomainService.updateAsAdmin.mockResolvedValue(sampleCustomerRecord)

      const result = await controller.update(
        partnerId,
        customerId,
        { name: 'Admin Correction', markUsed: true },
        mockAdminUser
      )

      expect(savedCustomerDomainService.updateAsAdmin).toHaveBeenCalledWith(
        mockAdminUser.id,
        partnerId,
        customerId,
        { name: 'Admin Correction' } // markUsed stripped!
      )
      expect(result).toBeInstanceOf(SavedCustomerResultDto)
    })
  })

  describe('delete', () => {
    it('calls deleteAsAdmin with admin id, partnerId and customer id', async () => {
      savedCustomerDomainService.deleteAsAdmin.mockResolvedValue(undefined)

      await controller.delete(partnerId, customerId, mockAdminUser)

      expect(savedCustomerDomainService.deleteAsAdmin).toHaveBeenCalledWith(
        mockAdminUser.id,
        partnerId,
        customerId
      )
    })
  })
})
