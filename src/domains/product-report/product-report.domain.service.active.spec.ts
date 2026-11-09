import { BadRequestException, ConflictException } from '@nestjs/common'
import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumProductReportKind,
  EnumProductReportSource,
} from '@prisma/types'
import { NotFoundException } from 'src/errors'
import {
  COURIER_REPORT_STATUSES,
  ProductReportDomainService,
} from './product-report.domain.service'

describe('ProductReportDomainService (Spec 0032, AC-1 to AC-8)', () => {
  let service: ProductReportDomainService
  let mockProductReportRepository: {
    create: jest.Mock
    findById: jest.Mock
    findForDelivery: jest.Mock
    findPage: jest.Mock
    resolveIfOpen: jest.Mock
  }
  let mockDeliveryRepository: {
    findByIdOrThrow: jest.Mock
    update: jest.Mock
  }
  let mockDeliveryEventService: {
    recordProductReportEvent: jest.Mock
  }

  const mockDelivery = {
    id: 'del-100',
    status: EnumDeliveryStatus.DROPPED_OFF,
  }

  const mockCreatedReport = {
    id: 'rep-1',
    deliveryId: 'del-100',
    kind: EnumProductReportKind.WRONG_ITEM,
    source: EnumProductReportSource.COURIER,
    reporterUserId: 'user-courier-1',
    itemName: 'Veggie Burger',
    note: 'Customer received beef burger instead',
    resolvedAt: null,
    resolvedByUserId: null,
    resolution: null,
    createdAt: new Date('2026-11-09T08:00:00.000Z'),
  }

  beforeEach(() => {
    mockProductReportRepository = {
      create: jest.fn().mockResolvedValue(mockCreatedReport),
      findById: jest.fn().mockResolvedValue(mockCreatedReport),
      findForDelivery: jest.fn().mockResolvedValue([mockCreatedReport]),
      findPage: jest.fn().mockResolvedValue({ data: [mockCreatedReport], pagination: { totalItems: 1 } }),
      resolveIfOpen: jest.fn().mockResolvedValue(true),
    }

    mockDeliveryRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue(mockDelivery),
      update: jest.fn(),
    }

    mockDeliveryEventService = {
      recordProductReportEvent: jest.fn().mockResolvedValue(undefined),
    }

    service = new ProductReportDomainService(
      mockProductReportRepository as any,
      mockDeliveryRepository as any,
      mockDeliveryEventService as any
    )
  })

  describe('report (AC-1, AC-5, AC-8)', () => {
    test('creates report with trimmed itemName and trimmed note', async () => {
      await service.report(
        mockDelivery,
        EnumProductReportSource.COURIER,
        'user-courier-1',
        {
          kind: EnumProductReportKind.WRONG_ITEM,
          itemName: '   Veggie Burger   ',
          note: '   Wrong patty inside   ',
        },
        'courier-1'
      )

      expect(mockProductReportRepository.create).toHaveBeenCalledWith({
        deliveryId: 'del-100',
        kind: EnumProductReportKind.WRONG_ITEM,
        source: EnumProductReportSource.COURIER,
        reporterUserId: 'user-courier-1',
        itemName: 'Veggie Burger',
        note: 'Wrong patty inside',
      })
    })

    test('treats empty string or whitespace-only itemName and note as null', async () => {
      await service.report(
        mockDelivery,
        EnumProductReportSource.ADMIN,
        'user-admin-1',
        {
          kind: EnumProductReportKind.MISSING_ITEM,
          itemName: '   ',
          note: 'Drink was missing from the bag',
        }
      )

      expect(mockProductReportRepository.create).toHaveBeenCalledWith({
        deliveryId: 'del-100',
        kind: EnumProductReportKind.MISSING_ITEM,
        source: EnumProductReportSource.ADMIN,
        reporterUserId: 'user-admin-1',
        itemName: null,
        note: 'Drink was missing from the bag',
      })
    })

    test.each([
      ['both undefined', undefined, undefined],
      ['both null', null, null],
      ['both empty string', '', ''],
      ['both whitespace', '   ', ' \t \n '],
      ['one empty one whitespace', '', '   '],
    ])('refuses report with 400 when neither item nor note is provided (%s)', async (_desc, itemName, note) => {
      await expect(
        service.report(
          mockDelivery,
          EnumProductReportSource.COURIER,
          'user-courier-1',
          {
            kind: EnumProductReportKind.WRONG_ITEM,
            itemName,
            note,
          }
        )
      ).rejects.toThrow(new BadRequestException('Name the item or add a note.'))

      expect(mockProductReportRepository.create).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.recordProductReportEvent).not.toHaveBeenCalled()
    })

    test('AC-5: records one PRODUCT_REPORTED event without the note on courier report', async () => {
      await service.report(
        { id: 'del-100', status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION },
        EnumProductReportSource.COURIER,
        'user-courier-1',
        {
          kind: EnumProductReportKind.WRONG_ITEM,
          itemName: 'Fries',
          note: 'Secret note about cold fries',
        },
        'courier-1'
      )

      expect(mockDeliveryEventService.recordProductReportEvent).toHaveBeenCalledTimes(1)
      expect(mockDeliveryEventService.recordProductReportEvent).toHaveBeenCalledWith(
        {
          deliveryId: 'del-100',
          type: EnumDeliveryEventType.PRODUCT_REPORTED,
          actor: EnumEventActor.COURIER,
          source: EnumDeliveryEventSource.OPENCOURIER,
          message: 'Reported WRONG_ITEM: Fries (COURIER)',
          courierId: 'courier-1',
        },
        EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION
      )
      // AC-5 & Decision 15.3: Ensure the note is NOT in the event message
      const eventArg = mockDeliveryEventService.recordProductReportEvent.mock.calls[0][0]
      expect(eventArg.message).not.toContain('Secret note')
    })

    test('AC-5: records PRODUCT_REPORTED event for partner with PARTNER_APP source and no item in message when itemName is null', async () => {
      await service.report(
        { id: 'del-100', status: EnumDeliveryStatus.DROPPED_OFF },
        EnumProductReportSource.PARTNER,
        'user-partner-1',
        {
          kind: EnumProductReportKind.MISSING_ITEM,
          note: 'Dessert not delivered',
        }
      )

      expect(mockDeliveryEventService.recordProductReportEvent).toHaveBeenCalledWith(
        {
          deliveryId: 'del-100',
          type: EnumDeliveryEventType.PRODUCT_REPORTED,
          actor: EnumEventActor.PARTNER,
          source: EnumDeliveryEventSource.PARTNER_APP,
          message: 'Reported MISSING_ITEM (PARTNER)',
        },
        EnumDeliveryStatus.DROPPED_OFF
      )
    })

    test('AC-5: records PRODUCT_REPORTED event for admin with ADMIN actor and OPENCOURIER source', async () => {
      await service.report(
        { id: 'del-100', status: EnumDeliveryStatus.ACCEPTED },
        EnumProductReportSource.ADMIN,
        'user-admin-1',
        {
          kind: EnumProductReportKind.WRONG_ITEM,
          itemName: 'Greek Salad',
          note: 'Customer phoned',
        }
      )

      expect(mockDeliveryEventService.recordProductReportEvent).toHaveBeenCalledWith(
        {
          deliveryId: 'del-100',
          type: EnumDeliveryEventType.PRODUCT_REPORTED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
          message: 'Reported WRONG_ITEM: Greek Salad (ADMIN)',
        },
        EnumDeliveryStatus.ACCEPTED
      )
    })

    test('AC-8: reporting does not change delivery status or write pay or charges', async () => {
      await service.report(
        mockDelivery,
        EnumProductReportSource.COURIER,
        'user-courier-1',
        {
          kind: EnumProductReportKind.WRONG_ITEM,
          itemName: 'Pizza',
        },
        'courier-1'
      )

      // Delivery repository update must not be called
      expect(mockDeliveryRepository.update).not.toHaveBeenCalled()
      // Status passed to event recorder must match the existing status
      expect(mockDeliveryEventService.recordProductReportEvent).toHaveBeenCalledWith(
        expect.anything(),
        mockDelivery.status
      )
    })
  })

  describe('refuseUnlessCourierMayReport (AC-2)', () => {
    test.each(COURIER_REPORT_STATUSES)(
      'allows report when delivery is in %s',
      (status) => {
        expect(() => service.refuseUnlessCourierMayReport(status)).not.toThrow()
      }
    )

    test.each([
      EnumDeliveryStatus.CREATED,
      EnumDeliveryStatus.ASSIGNING_COURIER,
      EnumDeliveryStatus.ACCEPTED,
      EnumDeliveryStatus.DISPATCHED,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.CANCELED,
      EnumDeliveryStatus.FAILED,
    ])('throws 409 Conflict when delivery is in %s', (status) => {
      expect(() => service.refuseUnlessCourierMayReport(status)).toThrow(
        new ConflictException('You can report this once you are at the customer.')
      )
    })
  })

  describe('refuseUnlessPartnerMayReport (AC-3)', () => {
    test('allows report when delivery is DROPPED_OFF', () => {
      expect(() => service.refuseUnlessPartnerMayReport(EnumDeliveryStatus.DROPPED_OFF)).not.toThrow()
    })

    test.each([
      EnumDeliveryStatus.CREATED,
      EnumDeliveryStatus.ASSIGNING_COURIER,
      EnumDeliveryStatus.ACCEPTED,
      EnumDeliveryStatus.DISPATCHED,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      EnumDeliveryStatus.CANCELED,
      EnumDeliveryStatus.FAILED,
    ])('throws 409 Conflict when delivery is in %s', (status) => {
      expect(() => service.refuseUnlessPartnerMayReport(status)).toThrow(
        new ConflictException('You can report this once the order is delivered.')
      )
    })
  })

  describe('listForDelivery (AC-6)', () => {
    test('delegates to repository findForDelivery', async () => {
      const result = await service.listForDelivery('del-100')
      expect(mockProductReportRepository.findForDelivery).toHaveBeenCalledWith('del-100')
      expect(result).toEqual([mockCreatedReport])
    })
  })

  describe('listPage (AC-6)', () => {
    test('delegates to repository findPage with state, page, and perPage', async () => {
      const result = await service.listPage('open', 1, 20)
      expect(mockProductReportRepository.findPage).toHaveBeenCalledWith('open', 1, 20)
      expect(result).toEqual({ data: [mockCreatedReport], pagination: { totalItems: 1 } })
    })
  })

  describe('resolve (AC-7, AC-8)', () => {
    test('throws NotFoundException when report does not exist', async () => {
      mockProductReportRepository.findById.mockResolvedValueOnce(null)

      await expect(service.resolve('unknown-rep', 'admin-user-1', 'Refund issued')).rejects.toThrow(
        new NotFoundException('Product report not found')
      )
      expect(mockProductReportRepository.resolveIfOpen).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.recordProductReportEvent).not.toHaveBeenCalled()
    })

    test('AC-7: resolves open report, trims resolution, and records PRODUCT_REPORT_RESOLVED event', async () => {
      mockProductReportRepository.resolveIfOpen.mockResolvedValueOnce(true)
      const resolvedDate = new Date()
      const resolvedReport = {
        ...mockCreatedReport,
        resolvedAt: resolvedDate,
        resolvedByUserId: 'admin-user-1',
        resolution: 'Credit issued to customer',
      }
      mockProductReportRepository.findById.mockResolvedValueOnce(mockCreatedReport).mockResolvedValueOnce(resolvedReport)

      const result = await service.resolve('rep-1', 'admin-user-1', '   Credit issued to customer   ')

      expect(mockProductReportRepository.resolveIfOpen).toHaveBeenCalledWith(
        'rep-1',
        'admin-user-1',
        'Credit issued to customer'
      )
      expect(mockDeliveryRepository.findByIdOrThrow).toHaveBeenCalledWith('del-100')
      expect(mockDeliveryEventService.recordProductReportEvent).toHaveBeenCalledWith(
        {
          deliveryId: 'del-100',
          type: EnumDeliveryEventType.PRODUCT_REPORT_RESOLVED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
          message: 'Report resolved (WRONG_ITEM)',
        },
        EnumDeliveryStatus.DROPPED_OFF
      )
      expect(result).toEqual(resolvedReport)
    })

    test('AC-7: cleans empty resolution to null when resolving', async () => {
      mockProductReportRepository.resolveIfOpen.mockResolvedValueOnce(true)

      await service.resolve('rep-1', 'admin-user-1', '    ')

      expect(mockProductReportRepository.resolveIfOpen).toHaveBeenCalledWith('rep-1', 'admin-user-1', null)
    })

    test('AC-7: resolving an already resolved report answers it unchanged and records nothing', async () => {
      // resolveIfOpen returns false because resolvedAt was already set
      mockProductReportRepository.resolveIfOpen.mockResolvedValueOnce(false)
      const alreadyResolved = {
        ...mockCreatedReport,
        resolvedAt: new Date('2026-11-09T08:30:00.000Z'),
        resolvedByUserId: 'first-admin',
        resolution: 'Already handled',
      }
      mockProductReportRepository.findById.mockResolvedValue(alreadyResolved)

      const result = await service.resolve('rep-1', 'second-admin', 'Try again')

      expect(mockProductReportRepository.resolveIfOpen).toHaveBeenCalledWith('rep-1', 'second-admin', 'Try again')
      // Must NOT record an event when resolving twice
      expect(mockDeliveryEventService.recordProductReportEvent).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.findByIdOrThrow).not.toHaveBeenCalled()
      expect(result).toEqual(alreadyResolved)
    })

    test('AC-8: resolving leaves delivery status unchanged and writes no pay or charges', async () => {
      mockProductReportRepository.resolveIfOpen.mockResolvedValueOnce(true)

      await service.resolve('rep-1', 'admin-user-1', 'Handled')

      expect(mockDeliveryRepository.update).not.toHaveBeenCalled()
    })
  })
})
