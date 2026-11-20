import { CourierCourierRestApiController } from './courier.courier.rest-api.controller'
import { CourierDomainService } from '../../../domains/courier/courier.domain.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { PATH_METADATA } from '@nestjs/common/constants'
import { EnumCourierDeliverySetting, EnumCourierStatus, EnumCourierStatusChangeCause, EnumUserRole } from '@prisma/types'
import { ROLES_KEY } from 'src/decorators/roles.decorator'

describe('CourierCourierRestApiController', () => {
  let controller: CourierCourierRestApiController
  let mockCourierDomainService: jest.Mocked<CourierDomainService>
  let mockDeliveryEventService: jest.Mocked<DeliveryEventService>

  const mockCourier = {
    id: 'courier-777',
    firstName: 'Nikos',
    lastName: 'Papastamou',
  } as CourierEntity

  beforeEach(() => {
    mockCourierDomainService = {
      updateCurrentLocation: jest.fn().mockResolvedValue(undefined),
      changeStatus: jest.fn().mockResolvedValue({ changed: true, fromStatus: EnumCourierStatus.OFFLINE }),
      updateDeliverySetting: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CourierDomainService>

    mockDeliveryEventService = {
      handleCourierStatusChanged: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeliveryEventService>

    controller = new CourierCourierRestApiController(mockCourierDomainService, mockDeliveryEventService)
  })

  describe('updateCurrentLocation', () => {
    test('calls courierDomainService.updateCurrentLocation with courier id and coordinates', async () => {
      await controller.updateCurrentLocation({ latitude: 39.36, longitude: 22.94 }, mockCourier)

      expect(mockCourierDomainService.updateCurrentLocation).toHaveBeenCalledWith('courier-777', {
        latitude: 39.36,
        longitude: 22.94,
      })
    })
  })

  describe('updateStatus', () => {
    test('changes status with cause RIDER and triggers handleCourierStatusChanged', async () => {
      await controller.updateStatus({ status: EnumCourierStatus.ONLINE }, mockCourier)

      expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
        'courier-777',
        EnumCourierStatus.ONLINE,
        EnumCourierStatusChangeCause.RIDER
      )
      expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
        'courier-777',
        EnumCourierStatus.ONLINE
      )
    })
  })

  describe('updateDeliverySetting', () => {
    test('calls courierDomainService.updateDeliverySetting with setting', async () => {
      await controller.updateDeliverySetting(
        { deliverySetting: EnumCourierDeliverySetting.AUTO_ACCEPT },
        mockCourier
      )

      expect(mockCourierDomainService.updateDeliverySetting).toHaveBeenCalledWith(
        'courier-777',
        EnumCourierDeliverySetting.AUTO_ACCEPT
      )
    })
  })

  describe('Route metadata and deleted routes (AC-6, AC-17)', () => {
    test('has location, status and delivery-setting routes with @Roles(COURIER)', () => {
      const proto = CourierCourierRestApiController.prototype

      expect(Reflect.getMetadata(ROLES_KEY, proto.updateCurrentLocation)).toEqual([EnumUserRole.COURIER])
      expect(Reflect.getMetadata(ROLES_KEY, proto.updateStatus)).toEqual([EnumUserRole.COURIER])
      expect(Reflect.getMetadata(ROLES_KEY, proto.updateDeliverySetting)).toEqual([EnumUserRole.COURIER])

      expect(Reflect.getMetadata('path', proto.updateCurrentLocation)).toBe('location')
      expect(Reflect.getMetadata('path', proto.updateStatus)).toBe('status')
      expect(Reflect.getMetadata('path', proto.updateDeliverySetting)).toBe('delivery-setting')
    })

    test('old earnings routes no longer exist on CourierCourierRestApiController (PATH metadata check)', () => {
      const proto = CourierCourierRestApiController.prototype as any
      expect(proto.getMyEarningsSummary).toBeUndefined()
      expect(proto.getMyEarningsDay).toBeUndefined()
      expect(proto.getMyEarningsDeliveryDetail).toBeUndefined()

      const methodNames = Object.getOwnPropertyNames(proto).filter(
        (m) => m !== 'constructor' && typeof proto[m] === 'function'
      )
      for (const name of methodNames) {
        const handler = proto[name]
        const path = Reflect.getMetadata(PATH_METADATA, handler)
        const paths = Array.isArray(path) ? path : [path]
        expect(paths).not.toContain('earnings-summary')
        expect(paths).not.toContain('earnings/day')
        expect(paths).not.toContain('earnings/delivery/:deliveryId')
      }
    })
  })
})
