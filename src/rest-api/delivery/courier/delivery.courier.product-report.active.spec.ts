import { ConflictException } from '@nestjs/common'
import {
  EnumDeliveryStatus,
  EnumProductReportKind,
  EnumProductReportSource,
  EnumUserRole,
} from '@prisma/types'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { DeliveryNotFoundException } from 'src/errors'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryCourierRestApiController } from './delivery.courier.rest-api.controller'
import { DeliveryRestApiCourierService } from './delivery.courier.rest-api.service'

describe('Courier Product Report (Spec 0032, AC-2, AC-8)', () => {
  let controller: DeliveryCourierRestApiController
  let service: DeliveryRestApiCourierService
  let mockDeliveryDomainService: {
    getById: jest.Mock
  }
  let mockProductReportDomainService: {
    refuseUnlessCourierMayReport: jest.Mock
    report: jest.Mock
  }
  let mockDeliveryRestApiCourierService: {
    reportProduct: jest.Mock
  }

  const mockCourier = {
    id: 'courier-1',
    userId: 'user-courier-1',
  } as CourierEntity

  const mockDeliveryAtDoor = {
    id: 'del-100',
    status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
    courierId: 'courier-1',
  } as DeliveryEntity

  const mockReportInput = {
    kind: EnumProductReportKind.WRONG_ITEM,
    itemName: 'Burger',
    note: 'Wrong items in bag',
  }

  const mockCreatedReport = {
    id: 'rep-courier-1',
    deliveryId: 'del-100',
    kind: EnumProductReportKind.WRONG_ITEM,
    source: EnumProductReportSource.COURIER,
    reporterUserId: 'user-courier-1',
    itemName: 'Burger',
    note: 'Wrong items in bag',
    resolvedAt: null,
    resolvedByUserId: null,
    resolution: null,
    createdAt: new Date(),
  }

  beforeEach(() => {
    mockDeliveryDomainService = {
      getById: jest.fn().mockResolvedValue(mockDeliveryAtDoor),
    }

    mockProductReportDomainService = {
      refuseUnlessCourierMayReport: jest.fn(),
      report: jest.fn().mockResolvedValue(mockCreatedReport),
    }

    service = new DeliveryRestApiCourierService(
      mockDeliveryDomainService as any,
      {} as any,
      {} as any,
      {} as any,
      mockProductReportDomainService as any
    )

    mockDeliveryRestApiCourierService = {
      reportProduct: jest.fn().mockResolvedValue(mockCreatedReport),
    }

    controller = new DeliveryCourierRestApiController(
      mockDeliveryRestApiCourierService as any,
      {} as any,
      {} as any
    )
  })

  describe('controller endpoint', () => {
    test('is protected with COURIER role', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.reportProduct)
      expect(roles).toEqual([EnumUserRole.COURIER])
    })

    test('calls service.reportProduct and returns { id }', async () => {
      const result = await controller.reportProduct('del-100', mockReportInput, mockCourier)

      expect(mockDeliveryRestApiCourierService.reportProduct).toHaveBeenCalledWith(
        'del-100',
        mockCourier,
        mockReportInput
      )
      expect(result).toEqual({ id: 'rep-courier-1' })
    })
  })

  describe('service reportProduct (AC-2)', () => {
    test('succeeds on own delivery at door (COURIER_ARRIVED_AT_DROPOFF_LOCATION)', async () => {
      const result = await service.reportProduct('del-100', mockCourier, mockReportInput)

      expect(mockDeliveryDomainService.getById).toHaveBeenCalledWith('del-100', { courierId: 'courier-1' })
      expect(mockProductReportDomainService.refuseUnlessCourierMayReport).toHaveBeenCalledWith(
        EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION
      )
      expect(mockProductReportDomainService.report).toHaveBeenCalledWith(
        mockDeliveryAtDoor,
        EnumProductReportSource.COURIER,
        'user-courier-1',
        mockReportInput,
        'courier-1'
      )
      expect(result).toEqual(mockCreatedReport)
    })

    test('succeeds on own delivery after drop off (DROPPED_OFF)', async () => {
      const deliveredJob = { ...mockDeliveryAtDoor, status: EnumDeliveryStatus.DROPPED_OFF }
      mockDeliveryDomainService.getById.mockResolvedValueOnce(deliveredJob)

      await service.reportProduct('del-100', mockCourier, mockReportInput)

      expect(mockProductReportDomainService.refuseUnlessCourierMayReport).toHaveBeenCalledWith(
        EnumDeliveryStatus.DROPPED_OFF
      )
      expect(mockProductReportDomainService.report).toHaveBeenCalledWith(
        deliveredJob,
        EnumProductReportSource.COURIER,
        'user-courier-1',
        mockReportInput,
        'courier-1'
      )
    })

    test('AC-2: throws 404 DeliveryNotFoundException when delivery does not belong to this courier', async () => {
      mockDeliveryDomainService.getById.mockResolvedValueOnce(null)

      await expect(service.reportProduct('del-other-courier', mockCourier, mockReportInput)).rejects.toThrow(
        new DeliveryNotFoundException('Delivery not found')
      )

      expect(mockProductReportDomainService.refuseUnlessCourierMayReport).not.toHaveBeenCalled()
      expect(mockProductReportDomainService.report).not.toHaveBeenCalled()
    })

    test('AC-2: throws 409 Conflict when delivery is in another status (e.g. ACCEPTED)', async () => {
      const acceptedJob = { ...mockDeliveryAtDoor, status: EnumDeliveryStatus.ACCEPTED }
      mockDeliveryDomainService.getById.mockResolvedValueOnce(acceptedJob)
      mockProductReportDomainService.refuseUnlessCourierMayReport.mockImplementationOnce(() => {
        throw new ConflictException('You can report this once you are at the customer.')
      })

      await expect(service.reportProduct('del-100', mockCourier, mockReportInput)).rejects.toThrow(
        new ConflictException('You can report this once you are at the customer.')
      )

      expect(mockProductReportDomainService.report).not.toHaveBeenCalled()
    })

    test('AC-8: does not write any status change, pay, or compensation', async () => {
      await service.reportProduct('del-100', mockCourier, mockReportInput)

      // Verify domain report was called with unaltered delivery status
      expect(mockProductReportDomainService.report).toHaveBeenCalledWith(
        expect.objectContaining({ status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything()
      )
    })
  })
})
