import { EnumCourierStatus } from '@prisma/types'
import { CourierCourierRestApiController } from './courier/courier.courier.rest-api.controller'
import { CourierAdminRestApiController } from './admin/courier.admin.rest-api.controller'
import { CourierDomainService } from '../../domains/courier/courier.domain.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { CourierEntity } from '../../domains/courier/entities/courier.entity'

describe('Courier Controllers - Offer Expiry Hooks (Spec 0002, AC-6)', () => {
  let mockCourierDomainService: jest.Mocked<CourierDomainService>
  let mockDeliveryEventService: jest.Mocked<DeliveryEventService>

  beforeEach(() => {
    mockCourierDomainService = {
      updateStatus: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockImplementation((id, data) =>
        Promise.resolve(
          new CourierEntity({
            id,
            status: data.status ?? EnumCourierStatus.ONLINE,
            firstName: 'Test',
            lastName: 'Rider',
          } as any)
        )
      ),
    } as unknown as jest.Mocked<CourierDomainService>

    mockDeliveryEventService = {
      handleCourierStatusChanged: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeliveryEventService>
  })

  describe('CourierCourierRestApiController (PATCH courier/status)', () => {
    let controller: CourierCourierRestApiController

    beforeEach(() => {
      controller = new CourierCourierRestApiController(
        mockCourierDomainService,
        {} as any,
        {} as any,
        mockDeliveryEventService
      )
    })

    it('calls handleCourierStatusChanged with rider id and new status when rider changes status', async () => {
      const courier = new CourierEntity({ id: 'courier-rider-1' } as any)
      const input = { status: EnumCourierStatus.OFFLINE }

      await controller.updateStatus(input as any, courier)

      expect(mockCourierDomainService.updateStatus).toHaveBeenCalledWith('courier-rider-1', EnumCourierStatus.OFFLINE)
      expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
        'courier-rider-1',
        EnumCourierStatus.OFFLINE
      )
    })
  })

  describe('CourierAdminRestApiController (PATCH admin/v1/courier/:id)', () => {
    let controller: CourierAdminRestApiController

    beforeEach(() => {
      controller = new CourierAdminRestApiController(
        mockCourierDomainService,
        mockDeliveryEventService
      )
    })

    it('calls handleCourierStatusChanged when status is provided in update payload', async () => {
      const courierId = 'courier-admin-target'
      const input = { status: EnumCourierStatus.OFFLINE, firstName: 'Updated' }

      await controller.updateCourier(courierId, input as any)

      expect(mockCourierDomainService.update).toHaveBeenCalledWith(courierId, input)
      expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
        courierId,
        EnumCourierStatus.OFFLINE
      )
    })

    it('does NOT call handleCourierStatusChanged when status is omitted from update payload', async () => {
      const courierId = 'courier-admin-target'
      const input = { firstName: 'OnlyNameChange' } // status is undefined

      await controller.updateCourier(courierId, input as any)

      expect(mockCourierDomainService.update).toHaveBeenCalledWith(courierId, input)
      expect(mockDeliveryEventService.handleCourierStatusChanged).not.toHaveBeenCalled()
    })
  })
})
