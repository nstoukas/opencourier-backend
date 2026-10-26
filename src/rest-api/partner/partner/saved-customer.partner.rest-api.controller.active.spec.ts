import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { SavedCustomerDomainService } from 'src/domains/saved-customer/saved-customer.domain.service'
import { SavedCustomerPartnerRestApiController } from './saved-customer.partner.rest-api.controller'
import { SavedCustomerCreatePartnerInput } from './queries/saved-customer-create.partner.input'
import { SavedCustomerUpdateInput } from './queries/saved-customer-update.input'
import { SavedCustomerListDto, SavedCustomerResultDto, SavedCustomerSaveResultDto } from './dtos/saved-customer.dto'

describe('SavedCustomerPartnerRestApiController (AC-1, AC-3, AC-4, AC-5)', () => {
  let controller: SavedCustomerPartnerRestApiController
  let domainService: jest.Mocked<SavedCustomerDomainService>

  const mockPartner = new PartnerEntity({
    id: 'partner-volos-1',
    name: 'To Steki',
    logo: 'https://example.com/logo.png',
    phoneNumber: '+302421012345',
    webhookUrl: 'https://example.com/webhook',
    userId: 'user-789',
    pickupLocationId: 'loc-456',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  const sampleCustomerRecord: any = {
    id: 'cust-1',
    partnerId: 'partner-volos-1',
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
    domainService = {
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      markUsed: jest.fn(),
      delete: jest.fn(),
    } as any

    controller = new SavedCustomerPartnerRestApiController(domainService)
  })

  describe('list', () => {
    it('uses partner.id from CurrentUserPartner and parses search arguments', async () => {
      domainService.list.mockResolvedValue({ items: [sampleCustomerRecord], total: 1 })

      const result = await controller.list({ q: 'Nikos', page: 1, perPage: 10 }, mockPartner)

      expect(domainService.list).toHaveBeenCalledWith(mockPartner.id, 'Nikos', 1, 10)
      expect(result).toBeInstanceOf(SavedCustomerListDto)
      expect(result.items.length).toBe(1)
      expect(result.total).toBe(1)
    })
  })

  describe('create', () => {
    it('always passes partner.id from CurrentUserPartner, default onPhoneClash refuse and markUsed false', async () => {
      domainService.create.mockResolvedValue({ customer: sampleCustomerRecord, created: true })

      const input: SavedCustomerCreatePartnerInput = {
        name: 'Nikos Dimas',
        phone: '6912345678',
        addressLine1: 'Iasonos 10',
        city: 'Volos',
        latitude: 39.362,
        longitude: 22.945,
      }

      const result = await controller.create(input, mockPartner)

      expect(domainService.create).toHaveBeenCalledWith(
        mockPartner.id,
        expect.objectContaining({ name: 'Nikos Dimas', phone: '6912345678' }),
        'refuse',
        false
      )
      expect(result).toBeInstanceOf(SavedCustomerSaveResultDto)
      expect(result.created).toBe(true)
    })

    it('forwards custom onPhoneClash and markUsed options', async () => {
      domainService.create.mockResolvedValue({ customer: sampleCustomerRecord, created: false })

      const input: SavedCustomerCreatePartnerInput = {
        name: 'Nikos Dimas',
        phone: '6912345678',
        addressLine1: 'Iasonos 10',
        city: 'Volos',
        latitude: 39.362,
        longitude: 22.945,
        onPhoneClash: 'update',
        markUsed: true,
      }

      const result = await controller.create(input, mockPartner)

      expect(domainService.create).toHaveBeenCalledWith(
        mockPartner.id,
        expect.anything(),
        'update',
        true
      )
      expect(result.created).toBe(false)
    })
  })

  describe('update', () => {
    it('uses partner.id from CurrentUserPartner and forwards markUsed', async () => {
      domainService.update.mockResolvedValue(sampleCustomerRecord)

      const input: SavedCustomerUpdateInput = {
        name: 'Updated Name',
        markUsed: true,
      }

      const result = await controller.update('cust-1', input, mockPartner)

      expect(domainService.update).toHaveBeenCalledWith(
        mockPartner.id,
        'cust-1',
        { name: 'Updated Name' },
        true
      )
      expect(result).toBeInstanceOf(SavedCustomerResultDto)
    })

    it('handles update with only markUsed: true (empty field updates)', async () => {
      domainService.update.mockResolvedValue(sampleCustomerRecord)

      const result = await controller.update('cust-1', { markUsed: true }, mockPartner)

      expect(domainService.update).toHaveBeenCalledWith(
        mockPartner.id,
        'cust-1',
        {},
        true
      )
      expect(result.customer.id).toBe('cust-1')
    })
  })

  describe('markUsed', () => {
    it('calls domainService.markUsed with partner.id and customer id', async () => {
      domainService.markUsed.mockResolvedValue(undefined)

      await controller.markUsed('cust-1', mockPartner)

      expect(domainService.markUsed).toHaveBeenCalledWith(mockPartner.id, 'cust-1')
    })
  })

  describe('delete', () => {
    it('calls domainService.delete with partner.id and customer id', async () => {
      domainService.delete.mockResolvedValue(undefined)

      await controller.delete('cust-1', mockPartner)

      expect(domainService.delete).toHaveBeenCalledWith(mockPartner.id, 'cust-1')
    })
  })
})
