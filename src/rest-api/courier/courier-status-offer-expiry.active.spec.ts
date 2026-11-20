import { CourierAdminRestApiService } from 'src/rest-api/courier/admin/courier.admin.rest-api.service'
import { EnumCourierStatus, EnumCourierStatusChangeCause } from '@prisma/types'
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
      changeStatus: jest.fn().mockResolvedValue({ changed: true, fromStatus: EnumCourierStatus.ONLINE }),
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
        mockDeliveryEventService
      )
    })

    it('calls handleCourierStatusChanged with rider id and new status when rider changes status', async () => {
      const courier = new CourierEntity({ id: 'courier-rider-1' } as any)
      const input = { status: EnumCourierStatus.OFFLINE }

      await controller.updateStatus(input as any, courier)

      expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
        'courier-rider-1',
        EnumCourierStatus.OFFLINE,
        EnumCourierStatusChangeCause.RIDER
      )
      expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
        'courier-rider-1',
        EnumCourierStatus.OFFLINE
      )
    })

    it('returns before handleCourierStatusChanged resolves (fire-and-forget matching)', async () => {
      const courier = new CourierEntity({ id: 'courier-rider-2', status: EnumCourierStatus.OFFLINE } as any)
      const input = { status: EnumCourierStatus.ONLINE }

      // handleCourierStatusChanged returns a never-resolving promise (e.g. slow matching)
      mockDeliveryEventService.handleCourierStatusChanged.mockImplementation(
        () => new Promise(() => {}) // never resolves
      )

      // The controller call must resolve promptly without waiting for handleCourierStatusChanged
      const resultPromise = controller.updateStatus(input as any, courier)
      await expect(resultPromise).resolves.toBeUndefined()
      expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
        'courier-rider-2',
        EnumCourierStatus.ONLINE,
        EnumCourierStatusChangeCause.RIDER
      )
    })
  })

  describe('CourierAdminRestApiController (PATCH admin/v1/courier/:id)', () => {
    let controller: CourierAdminRestApiController

    beforeEach(() => {
      controller = new CourierAdminRestApiController(
        mockCourierDomainService,
        mockDeliveryEventService,
      // The rider create and password routes (spec 0013) are not used by these tests.
      {} as CourierAdminRestApiService
      )
    })

    it('calls handleCourierStatusChanged when status is provided in update payload', async () => {
      const courierId = 'courier-admin-target'
      const input = { status: EnumCourierStatus.OFFLINE, firstName: 'Updated' }

      await controller.updateCourier(courierId, input as any, { id: 'admin-1' } as any)

      expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
        courierId,
        EnumCourierStatus.OFFLINE,
        EnumCourierStatusChangeCause.ADMIN,
        'admin-1'
      )
      expect(mockCourierDomainService.update).toHaveBeenCalledWith(courierId, { firstName: 'Updated' })
      expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
        courierId,
        EnumCourierStatus.OFFLINE
      )
    })

    it('does NOT call handleCourierStatusChanged when status is omitted from update payload', async () => {
      const courierId = 'courier-admin-target'
      const input = { firstName: 'OnlyNameChange' } // status is undefined

      await controller.updateCourier(courierId, input as any, { id: 'admin-1' } as any)

      expect(mockCourierDomainService.changeStatus).not.toHaveBeenCalled()
      expect(mockCourierDomainService.update).toHaveBeenCalledWith(courierId, { firstName: 'OnlyNameChange' })
      expect(mockDeliveryEventService.handleCourierStatusChanged).not.toHaveBeenCalled()
    })
  })
})
