import { ConflictException, ForbiddenException } from '@nestjs/common'
import {
  EnumDeliveryStatus,
  EnumProductReportKind,
  EnumProductReportSource,
  EnumUserRole,
} from '@prisma/types'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { DeliveryNotFoundException } from 'src/errors'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryPartnerRestApiController } from './delivery.partner.rest-api.controller'
import { DeliveryPartnerRestApiService } from './delivery.partner.rest-api.service'

describe('Partner Product Report (Spec 0032, AC-3, AC-8)', () => {
  let controller: DeliveryPartnerRestApiController
  let service: DeliveryPartnerRestApiService
  let mockDeliveryDomainService: {
    getById: jest.Mock
  }
  let mockProductReportDomainService: {
    refuseUnlessPartnerMayReport: jest.Mock
    report: jest.Mock
  }
  let mockConfigDomainService: {
    instanceConfig: {
      getRestaurantHistoryDays: jest.Mock
    }
  }
  let mockDeliveryPartnerRestApiService: {
    reportProduct: jest.Mock
  }

  const partnerId = 'partner-nosh'
  const mockPartner = new PartnerEntity({
    id: partnerId,
    userId: 'user-partner-1',
  } as any)

  const mockDeliveryDelivered = new DeliveryEntity({
    id: 'del-100',
    partnerId,
    status: EnumDeliveryStatus.DROPPED_OFF,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any)

  const mockReportInput = {
    kind: EnumProductReportKind.MISSING_ITEM,
    itemName: 'Sprite',
    note: 'Drink was missing',
  }

  const mockCreatedReport = {
    id: 'rep-partner-1',
    deliveryId: 'del-100',
    kind: EnumProductReportKind.MISSING_ITEM,
    source: EnumProductReportSource.PARTNER,
    reporterUserId: 'user-partner-1',
    itemName: 'Sprite',
    note: 'Drink was missing',
    resolvedAt: null,
    resolvedByUserId: null,
    resolution: null,
    createdAt: new Date(),
  }

  beforeEach(() => {
    mockDeliveryDomainService = {
      getById: jest.fn().mockResolvedValue(mockDeliveryDelivered),
    }

    mockProductReportDomainService = {
      refuseUnlessPartnerMayReport: jest.fn(),
      report: jest.fn().mockResolvedValue(mockCreatedReport),
    }

    mockConfigDomainService = {
      instanceConfig: {
        getRestaurantHistoryDays: jest.fn().mockResolvedValue(30),
      },
    }

    service = new DeliveryPartnerRestApiService(
      {} as any,
      mockDeliveryDomainService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mockConfigDomainService as any,
      {} as any,
      mockProductReportDomainService as any
    )

    mockDeliveryPartnerRestApiService = {
      reportProduct: jest.fn().mockResolvedValue(mockCreatedReport),
    }

    controller = new DeliveryPartnerRestApiController(
      mockDeliveryPartnerRestApiService as any,
      {} as any
    )
  })

  describe('controller endpoint', () => {
    test('is protected with PARTNER role', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.reportProduct)
      expect(roles).toEqual([EnumUserRole.PARTNER])
    })

    test('calls service.reportProduct and returns { id }', async () => {
      const result = await controller.reportProduct('del-100', mockReportInput, mockPartner)

      expect(mockDeliveryPartnerRestApiService.reportProduct).toHaveBeenCalledWith(
        'del-100',
        mockPartner,
        mockReportInput
      )
      expect(result).toEqual({ id: 'rep-partner-1' })
    })
  })

  describe('service reportProduct (AC-3)', () => {
    test('succeeds for own delivered order (DROPPED_OFF)', async () => {
      const result = await service.reportProduct('del-100', mockPartner, mockReportInput)

      expect(mockDeliveryDomainService.getById).toHaveBeenCalledWith('del-100')
      expect(mockProductReportDomainService.refuseUnlessPartnerMayReport).toHaveBeenCalledWith(
        EnumDeliveryStatus.DROPPED_OFF
      )
      expect(mockProductReportDomainService.report).toHaveBeenCalledWith(
        mockDeliveryDelivered,
        EnumProductReportSource.PARTNER,
        'user-partner-1',
        mockReportInput
      )
      expect(result).toEqual(mockCreatedReport)
    })

    test('AC-3: throws 404 when delivery belongs to another restaurant', async () => {
      const otherPartnerDelivery = new DeliveryEntity({
        id: 'del-100',
        partnerId: 'other-partner-id',
        status: EnumDeliveryStatus.DROPPED_OFF,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any)
      mockDeliveryDomainService.getById.mockResolvedValueOnce(otherPartnerDelivery)

      await expect(service.reportProduct('del-100', mockPartner, mockReportInput)).rejects.toThrow(
        new DeliveryNotFoundException('Delivery not found')
      )

      expect(mockProductReportDomainService.report).not.toHaveBeenCalled()
    })

    test('AC-3: throws 404 when delivery is outside the history window', async () => {
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) // 40 days ago
      const oldDelivery = new DeliveryEntity({
        id: 'del-100',
        partnerId,
        status: EnumDeliveryStatus.DROPPED_OFF,
        createdAt: oldDate,
        updatedAt: oldDate,
      } as any)
      mockDeliveryDomainService.getById.mockResolvedValueOnce(oldDelivery)

      await expect(service.reportProduct('del-100', mockPartner, mockReportInput)).rejects.toThrow(
        new DeliveryNotFoundException('This order is older than 30 days. The co-op can look it up for you.')
      )

      expect(mockProductReportDomainService.report).not.toHaveBeenCalled()
    })

    test('AC-3: throws 409 Conflict when delivery is not yet delivered (e.g. COURIER_ARRIVED_AT_DROPOFF_LOCATION or ACCEPTED)', async () => {
      const activeDelivery = new DeliveryEntity({
        id: 'del-100',
        partnerId,
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any)
      mockDeliveryDomainService.getById.mockResolvedValueOnce(activeDelivery)
      mockProductReportDomainService.refuseUnlessPartnerMayReport.mockImplementationOnce(() => {
        throw new ConflictException('You can report this once the order is delivered.')
      })

      await expect(service.reportProduct('del-100', mockPartner, mockReportInput)).rejects.toThrow(
        new ConflictException('You can report this once the order is delivered.')
      )

      expect(mockProductReportDomainService.report).not.toHaveBeenCalled()
    })

    test('throws 403 ForbiddenException when partner has no userId', async () => {
      const partnerWithoutUser = new PartnerEntity({
        id: partnerId,
        userId: null,
      } as any)

      await expect(service.reportProduct('del-100', partnerWithoutUser, mockReportInput)).rejects.toThrow(
        new ForbiddenException('This restaurant has no sign in.')
      )

      expect(mockProductReportDomainService.report).not.toHaveBeenCalled()
    })

    test('AC-8: does not write any charge, pay, or status change', async () => {
      await service.reportProduct('del-100', mockPartner, mockReportInput)

      expect(mockProductReportDomainService.report).toHaveBeenCalledWith(
        expect.objectContaining({ status: EnumDeliveryStatus.DROPPED_OFF }),
        EnumProductReportSource.PARTNER,
        'user-partner-1',
        mockReportInput
      )
    })
  })
})
