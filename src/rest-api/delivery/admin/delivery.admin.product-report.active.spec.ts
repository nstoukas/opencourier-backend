import { EnumDeliveryStatus, EnumProductReportKind, EnumProductReportSource, EnumUserRole } from '@prisma/types'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { DeliveryNotFoundException } from 'src/errors'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { DeliveryAdminRestApiController } from './delivery.admin.rest-api.controller'
import { ProductReportAdminDto } from '../../product-report/admin/product-report.admin.dto'

describe('Admin Delivery Product Reports (Spec 0032, AC-4, AC-6, AC-8)', () => {
  let controller: DeliveryAdminRestApiController
  let mockDeliveryDomainService: {
    getByIdOrThrow: jest.Mock
  }
  let mockProductReportDomainService: {
    listForDelivery: jest.Mock
    report: jest.Mock
  }

  const adminUser = new UserEntity({
    id: 'user-admin-1',
    email: 'admin@coop.gr',
  } as any)

  const mockDelivery = {
    id: 'del-100',
    status: EnumDeliveryStatus.CREATED,
  }

  const mockReportRow = {
    id: 'rep-admin-1',
    deliveryId: 'del-100',
    kind: EnumProductReportKind.WRONG_ITEM,
    source: EnumProductReportSource.ADMIN,
    reporterUserId: 'user-admin-1',
    reporterEmail: 'admin@coop.gr',
    itemName: 'Salad',
    note: 'Customer phoned about dressing',
    resolvedAt: null,
    resolvedByUserId: null,
    resolution: null,
    createdAt: new Date('2026-11-09T09:00:00.000Z'),
  }

  beforeEach(() => {
    mockDeliveryDomainService = {
      getByIdOrThrow: jest.fn().mockResolvedValue(mockDelivery),
    }

    mockProductReportDomainService = {
      listForDelivery: jest.fn().mockResolvedValue([mockReportRow]),
      report: jest.fn().mockResolvedValue(mockReportRow),
    }

    controller = new DeliveryAdminRestApiController(
      mockDeliveryDomainService as any,
      {} as any,
      {} as any,
      mockProductReportDomainService as any
    )
  })

  describe('GET :deliveryId/product-reports (AC-6)', () => {
    test('is protected with ADMIN role', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.getProductReports)
      expect(roles).toEqual([EnumUserRole.ADMIN])
    })

    test('returns list of reports mapped to ProductReportAdminDto', async () => {
      const result = await controller.getProductReports('del-100')

      expect(mockDeliveryDomainService.getByIdOrThrow).toHaveBeenCalledWith('del-100')
      expect(mockProductReportDomainService.listForDelivery).toHaveBeenCalledWith('del-100')
      expect(result).toHaveLength(1)
      expect(result[0]).toBeInstanceOf(ProductReportAdminDto)
      expect(result[0]?.id).toBe('rep-admin-1')
      expect(result[0]?.reporterEmail).toBe('admin@coop.gr')
      expect(result[0]?.itemName).toBe('Salad')
      expect(result[0]?.note).toBe('Customer phoned about dressing')
    })

    test('throws 404 when delivery is not found', async () => {
      mockDeliveryDomainService.getByIdOrThrow.mockRejectedValueOnce(
        new DeliveryNotFoundException('Delivery not found')
      )

      await expect(controller.getProductReports('del-unknown')).rejects.toThrow(
        new DeliveryNotFoundException('Delivery not found')
      )
      expect(mockProductReportDomainService.listForDelivery).not.toHaveBeenCalled()
    })
  })

  describe('POST :deliveryId/product-reports (AC-4, AC-8)', () => {
    test('is protected with ADMIN role', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.reportProduct)
      expect(roles).toEqual([EnumUserRole.ADMIN])
    })

    test.each([
      EnumDeliveryStatus.CREATED,
      EnumDeliveryStatus.ASSIGNING_COURIER,
      EnumDeliveryStatus.ACCEPTED,
      EnumDeliveryStatus.DISPATCHED,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      EnumDeliveryStatus.DROPPED_OFF,
      EnumDeliveryStatus.CANCELED,
      EnumDeliveryStatus.FAILED,
    ])('AC-4: admin can report product in ANY delivery status (%s)', async (status) => {
      mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce({
        id: 'del-100',
        status,
      })

      const input = {
        kind: EnumProductReportKind.MISSING_ITEM,
        itemName: 'Drink',
        note: 'Customer phoned',
      }

      const result = await controller.reportProduct('del-100', input, adminUser)

      expect(mockDeliveryDomainService.getByIdOrThrow).toHaveBeenCalledWith('del-100')
      expect(mockProductReportDomainService.report).toHaveBeenCalledWith(
        { id: 'del-100', status },
        EnumProductReportSource.ADMIN,
        'user-admin-1',
        input
      )
      expect(result).toBeInstanceOf(ProductReportAdminDto)
      expect(result.reporterEmail).toBe('admin@coop.gr')
    })

    test('throws 404 when delivery is not found', async () => {
      mockDeliveryDomainService.getByIdOrThrow.mockRejectedValueOnce(
        new DeliveryNotFoundException('Delivery not found')
      )

      await expect(
        controller.reportProduct(
          'del-unknown',
          { kind: EnumProductReportKind.WRONG_ITEM, itemName: 'Burger' },
          adminUser
        )
      ).rejects.toThrow(new DeliveryNotFoundException('Delivery not found'))

      expect(mockProductReportDomainService.report).not.toHaveBeenCalled()
    })

    test('AC-8: reporting leaves delivery status unchanged and writes no pay or charges', async () => {
      mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce({
        id: 'del-100',
        status: EnumDeliveryStatus.PICKED_UP,
      })

      await controller.reportProduct(
        'del-100',
        { kind: EnumProductReportKind.WRONG_ITEM, itemName: 'Burger' },
        adminUser
      )

      expect(mockProductReportDomainService.report).toHaveBeenCalledWith(
        { id: 'del-100', status: EnumDeliveryStatus.PICKED_UP },
        EnumProductReportSource.ADMIN,
        'user-admin-1',
        expect.anything()
      )
    })
  })
})
