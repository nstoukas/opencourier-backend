import { EnumProductReportKind, EnumProductReportSource, EnumUserRole } from '@prisma/types'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { NotFoundException } from 'src/errors'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { ProductReportAdminRestApiController } from './product-report.admin.rest-api.controller'
import { ProductReportAdminDto } from './product-report.admin.dto'

describe('ProductReportAdminRestApiController (Spec 0032, AC-6, AC-7)', () => {
  let controller: ProductReportAdminRestApiController
  let mockProductReportDomainService: {
    listPage: jest.Mock
    resolve: jest.Mock
  }

  const adminUser = new UserEntity({
    id: 'user-admin-1',
    email: 'admin@coop.gr',
  } as any)

  const mockReport = {
    id: 'rep-1',
    deliveryId: 'del-100',
    kind: EnumProductReportKind.WRONG_ITEM,
    source: EnumProductReportSource.COURIER,
    reporterUserId: 'user-courier-1',
    reporterEmail: 'courier@coop.gr',
    itemName: 'Salad',
    note: 'Wrong dressing',
    resolvedAt: null,
    resolvedByUserId: null,
    resolution: null,
    createdAt: new Date('2026-11-09T08:00:00.000Z'),
  }

  beforeEach(() => {
    mockProductReportDomainService = {
      listPage: jest.fn().mockResolvedValue({
        data: [mockReport],
        pagination: { totalItems: 1, totalPages: 1, currentPage: 1, perPage: 20 },
      }),
      resolve: jest.fn().mockResolvedValue({
        ...mockReport,
        resolvedAt: new Date('2026-11-09T08:30:00.000Z'),
        resolvedByUserId: 'user-admin-1',
        resolution: 'Credit issued',
      }),
    }

    controller = new ProductReportAdminRestApiController(mockProductReportDomainService as any)
  })

  describe('GET admin/v1/product-reports (AC-6)', () => {
    test('is protected with ADMIN role', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.list)
      expect(roles).toEqual([EnumUserRole.ADMIN])
    })

    test('defaults state to "open" when state query arg is not provided', async () => {
      const result = await controller.list({})

      expect(mockProductReportDomainService.listPage).toHaveBeenCalledWith('open', undefined, undefined)
      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toBeInstanceOf(ProductReportAdminDto)
      expect(result.data[0]?.id).toBe('rep-1')
      expect(result.data[0]?.reporterEmail).toBe('courier@coop.gr')
      expect(result.pagination?.totalItems).toBe(1)
    })

    test.each(['open', 'resolved', 'all'] as const)(
      'passes state="%s", page, and perPage to domain service',
      async (state) => {
        await controller.list({ state, page: 2, perPage: 15 })

        expect(mockProductReportDomainService.listPage).toHaveBeenCalledWith(state, 2, 15)
      }
    )
  })

  describe('POST admin/v1/product-reports/:id/resolve (AC-7)', () => {
    test('is protected with ADMIN role', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.resolve)
      expect(roles).toEqual([EnumUserRole.ADMIN])
    })

    test('resolves product report and returns ProductReportAdminDto', async () => {
      const result = await controller.resolve('rep-1', { resolution: 'Credit issued' }, adminUser)

      expect(mockProductReportDomainService.resolve).toHaveBeenCalledWith('rep-1', 'user-admin-1', 'Credit issued')
      expect(result).toBeInstanceOf(ProductReportAdminDto)
      expect(result?.resolvedAt).toBeInstanceOf(Date)
      expect(result?.resolution).toBe('Credit issued')
    })

    test('handles resolve with no resolution provided', async () => {
      await controller.resolve('rep-1', {}, adminUser)

      expect(mockProductReportDomainService.resolve).toHaveBeenCalledWith('rep-1', 'user-admin-1', undefined)
    })

    test('throws NotFoundException when report is not found', async () => {
      mockProductReportDomainService.resolve.mockRejectedValueOnce(
        new NotFoundException('Product report not found')
      )

      await expect(
        controller.resolve('unknown-rep', { resolution: 'Done' }, adminUser)
      ).rejects.toThrow(new NotFoundException('Product report not found'))
    })
  })
})
