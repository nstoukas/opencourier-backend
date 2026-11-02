import { NotFoundException } from '@nestjs/common'
import { DeliveryPartnerRestApiController } from './delivery.partner.rest-api.controller'
import { DeliveryPartnerRestApiService } from './delivery.partner.rest-api.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { DeliveryNotFoundException } from 'src/errors'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { EnumDeliveryStatus } from '@prisma/types'

describe('DeliveryPartnerRestApiController (Spec 0017, AC-2 & AC-3)', () => {
  let controller: DeliveryPartnerRestApiController
  let mockDeliveryPartnerRestApiService: jest.Mocked<DeliveryPartnerRestApiService>
  let mockDeliveryEventService: jest.Mocked<DeliveryEventService>

  const mockPartner = new PartnerEntity({ id: 'partner-nosh' } as any)

  beforeEach(() => {
    mockDeliveryPartnerRestApiService = {
      getManyByPartnerId: jest.fn(),
      getByIdWithRelations: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
    } as any

    mockDeliveryEventService = {
      offerWaitingDeliveryNow: jest.fn(),
    } as any

    controller = new DeliveryPartnerRestApiController(
      mockDeliveryPartnerRestApiService,
      mockDeliveryEventService
    )
  })

  describe('listDeliveries (Spec 0017, AC-2)', () => {
    it('returns DeliveryPartnerPaginatedDto carrying historyDays from getManyByPartnerId', async () => {
      const mockResult = {
        data: [
          new DeliveryEntity({
            id: 'del-1',
            status: EnumDeliveryStatus.ACCEPTED,
            pickupLocationId: 'loc-1',
            dropoffLocationId: 'loc-2',
            pickupLocation: { id: 'loc-1' } as any,
            dropoffLocation: { id: 'loc-2' } as any,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any),
        ],
        historyDays: 30,
        pagination: undefined,
      }
      mockDeliveryPartnerRestApiService.getManyByPartnerId.mockResolvedValue(mockResult as any)

      const dto = await controller.listDeliveries({ page: 1, perPage: 10 }, mockPartner)

      expect(mockDeliveryPartnerRestApiService.getManyByPartnerId).toHaveBeenCalledWith(
        'partner-nosh',
        1,
        10
      )
      expect(dto.historyDays).toBe(30)
      expect(dto.data).toHaveLength(1)
      expect(dto.data[0]?.id).toBe('del-1')
    })
  })

  describe('findCourier (test/:id/assign-courier goes through getByIdWithRelations)', () => {
    it('calls getByIdWithRelations and refuses if delivery is old ended or not found', async () => {
      mockDeliveryPartnerRestApiService.getByIdWithRelations.mockRejectedValue(
        new DeliveryNotFoundException('This order is older than 30 days. The co-op can look it up for you.')
      )

      await expect(
        controller.findCourier('del-old', mockPartner)
      ).rejects.toThrow('This order is older than 30 days. The co-op can look it up for you.')

      expect(mockDeliveryPartnerRestApiService.getByIdWithRelations).toHaveBeenCalledWith(
        'del-old',
        'partner-nosh'
      )
      expect(mockDeliveryEventService.offerWaitingDeliveryNow).not.toHaveBeenCalled()
    })

    it('proceeds to offerWaitingDeliveryNow when getByIdWithRelations succeeds', async () => {
      mockDeliveryPartnerRestApiService.getByIdWithRelations.mockResolvedValue({ id: 'del-valid' } as any)
      const mockCourier = { id: 'courier-1' }
      mockDeliveryEventService.offerWaitingDeliveryNow.mockResolvedValue(mockCourier as any)

      const result = await controller.findCourier('del-valid', mockPartner)

      expect(mockDeliveryPartnerRestApiService.getByIdWithRelations).toHaveBeenCalledWith(
        'del-valid',
        'partner-nosh'
      )
      expect(mockDeliveryEventService.offerWaitingDeliveryNow).toHaveBeenCalledWith('del-valid')
      expect(result).toBe(mockCourier)
    })

    it('throws NotFoundException when no couriers are available', async () => {
      mockDeliveryPartnerRestApiService.getByIdWithRelations.mockResolvedValue({ id: 'del-valid' } as any)
      mockDeliveryEventService.offerWaitingDeliveryNow.mockResolvedValue(undefined as any)

      await expect(
        controller.findCourier('del-valid', mockPartner)
      ).rejects.toThrow(new NotFoundException('No couriers are available.'))
    })
  })
})
