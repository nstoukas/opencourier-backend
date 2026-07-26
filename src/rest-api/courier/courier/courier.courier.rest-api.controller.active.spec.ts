import { BadRequestException, NotFoundException } from '@nestjs/common'
import { CourierCourierRestApiController } from './courier.courier.rest-api.controller'
import { CourierDomainService } from '../../../domains/courier/courier.domain.service'
import { DeliveryEventDomainService } from 'src/domains/delivery-event/delivery-event.domain.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { dayjs } from 'src/core/utils/time'
import { EARNINGS_SUMMARY_DEFAULT_WINDOW_DAYS } from 'src/constants'

describe('CourierCourierRestApiController', () => {
  let controller: CourierCourierRestApiController
  let mockCourierDomainService: jest.Mocked<CourierDomainService>
  let mockDeliveryEventDomainService: jest.Mocked<DeliveryEventDomainService>
  let mockConfigDomainService: jest.Mocked<ConfigDomainService>

  // Setup minimal authenticated courier mock object
  const mockCourier = {
    id: 'courier-777',
    firstName: 'Nikos',
    lastName: 'Papastamou',
  } as CourierEntity

  beforeEach(() => {
    mockCourierDomainService = {} as jest.Mocked<CourierDomainService>

    // Mock DeliveryEventDomainService methods with safe default return values
    mockDeliveryEventDomainService = {
      getEarningsSummaryForCourier: jest.fn().mockResolvedValue([]),
      getEarningsDeliveriesForCourierDay: jest.fn().mockResolvedValue([]),
      getEarningsDeliveryDetailForCourier: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<DeliveryEventDomainService>

    // Mock ConfigDomainService for fetching instance currency
    mockConfigDomainService = {
      instanceConfig: {
        getCurrency: jest.fn().mockResolvedValue('EUR'),
      },
    } as unknown as jest.Mocked<ConfigDomainService>

    controller = new CourierCourierRestApiController(
      mockCourierDomainService,
      mockDeliveryEventDomainService,
      mockConfigDomainService
    )
  })

  describe('getMyEarningsSummary', () => {
    test('returns earnings summary DTO with default 30-day window and UTC timezone', async () => {
      // Mock domain service returning one day summary
      mockDeliveryEventDomainService.getEarningsSummaryForCourier.mockResolvedValue([
        {
          date: '2026-07-10',
          deliveryCount: 2,
          compensation: 1200,
          tips: 100,
          total: 1300,
        },
      ])

      const result = await controller.getMyEarningsSummary({}, mockCourier)

      // Check that timezone defaulted to UTC
      expect(result.timezone).toBe('UTC')
      // The default window must cover whole UTC days, or the first/last day is partial
      // and the courier's earnings are under-reported.
      expect(dayjs(result.from).utc().format('HH:mm:ss.SSS')).toBe('00:00:00.000')
      expect(dayjs(result.to).utc().format('HH:mm:ss.SSS')).toBe('23:59:59.999')
      expect(dayjs(result.to).diff(result.from, 'day')).toBe(EARNINGS_SUMMARY_DEFAULT_WINDOW_DAYS)
      // Check currency from config service
      expect(result.currency).toBe('EUR')
      // Check calculated totals
      expect(result.totalDeliveryCount).toBe(2)
      expect(result.totalCompensation).toBe(1200)
      expect(result.totalTips).toBe(100)
      expect(result.totalEarnings).toBe(1300)
      expect(result.days).toHaveLength(1)
    })

    test('accepts custom from/to dates and valid IANA timezone', async () => {
      mockDeliveryEventDomainService.getEarningsSummaryForCourier.mockResolvedValue([])

      const args = {
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-15T23:59:59.000Z',
        timezone: 'Europe/Athens',
      }

      const result = await controller.getMyEarningsSummary(args, mockCourier)

      expect(mockDeliveryEventDomainService.getEarningsSummaryForCourier).toHaveBeenCalledWith(
        'courier-777',
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-07-15T23:59:59.000Z'),
        'Europe/Athens'
      )
      expect(result.timezone).toBe('Europe/Athens')
      expect(result.totalEarnings).toBe(0)
    })

    test('anchors date-only from/to to whole days in the requested timezone', async () => {
      mockDeliveryEventDomainService.getEarningsSummaryForCourier.mockResolvedValue([])

      const args = { from: '2026-07-01', to: '2026-07-15', timezone: 'Europe/Athens' }

      const result = await controller.getMyEarningsSummary(args, mockCourier)

      // Athens is UTC+3 in July, so its 1 July starts at 21:00Z on 30 June.
      expect(result.from.toISOString()).toBe('2026-06-30T21:00:00.000Z')
      expect(result.to.toISOString()).toBe('2026-07-15T20:59:59.999Z')
    })

    test('throws BadRequestException when the requested window is too long', async () => {
      const args = { from: '2000-01-01', to: '2026-07-15' }

      await expect(controller.getMyEarningsSummary(args, mockCourier)).rejects.toThrow(BadRequestException)
    })

    test('throws BadRequestException when an invalid timezone is provided', async () => {
      const args = { timezone: 'Invalid/Timezone_Name' }

      await expect(controller.getMyEarningsSummary(args, mockCourier)).rejects.toThrow(BadRequestException)
      await expect(controller.getMyEarningsSummary(args, mockCourier)).rejects.toThrow('Unknown timezone')
    })

    test('throws BadRequestException when from date is after to date', async () => {
      const args = {
        from: '2026-07-20T00:00:00.000Z',
        to: '2026-07-10T00:00:00.000Z',
      }

      await expect(controller.getMyEarningsSummary(args, mockCourier)).rejects.toThrow(BadRequestException)
      await expect(controller.getMyEarningsSummary(args, mockCourier)).rejects.toThrow('from must be before to')
    })
  })

  describe('getMyEarningsDay', () => {
    // Test Plan Section 5: getMyEarningsDay
    test('defaults timezone to UTC and returns DTO with summed totals and mapped deliveries', async () => {
      // Mock domain service returning two deliveries for July 10
      mockDeliveryEventDomainService.getEarningsDeliveriesForCourierDay.mockResolvedValue([
        {
          deliveryId: 'del-1',
          droppedOffAt: new Date('2026-07-10T10:00:00Z'),
          dropoffAddress: 'Iasonos 12, Volos',
          pickupBusinessName: 'Ta Koutsavakia',
          compensation: 500,
          tips: 100,
          total: 600,
        },
        {
          deliveryId: 'del-2',
          droppedOffAt: new Date('2026-07-10T14:00:00Z'),
          dropoffAddress: 'Ermou 4, Volos',
          pickupBusinessName: 'O Gyros tis Elladas',
          compensation: 700,
          tips: 0,
          total: 700,
        },
      ])

      const result = await controller.getMyEarningsDay({ date: '2026-07-10' }, mockCourier)

      // Verify domain service called with UTC default
      expect(mockDeliveryEventDomainService.getEarningsDeliveriesForCourierDay).toHaveBeenCalledWith(
        'courier-777',
        '2026-07-10',
        'UTC'
      )

      // Verify DTO fields and calculated day totals
      expect(result.date).toBe('2026-07-10')
      expect(result.timezone).toBe('UTC')
      expect(result.currency).toBe('EUR')
      expect(result.deliveryCount).toBe(2)
      expect(result.compensation).toBe(1200) // 500 + 700
      expect(result.tips).toBe(100) // 100 + 0
      expect(result.total).toBe(1300) // 600 + 700
      expect(result.deliveries).toHaveLength(2)
    })

    test('passes custom valid timezone to domain service', async () => {
      mockDeliveryEventDomainService.getEarningsDeliveriesForCourierDay.mockResolvedValue([])

      const args = { date: '2026-07-10', timezone: 'Europe/Athens' }
      const result = await controller.getMyEarningsDay(args, mockCourier)

      expect(mockDeliveryEventDomainService.getEarningsDeliveriesForCourierDay).toHaveBeenCalledWith(
        'courier-777',
        '2026-07-10',
        'Europe/Athens'
      )
      expect(result.timezone).toBe('Europe/Athens')
    })

    test('throws BadRequestException when an invalid timezone is provided', async () => {
      const args = { date: '2026-07-10', timezone: 'Invalid/Zone' }

      await expect(controller.getMyEarningsDay(args, mockCourier)).rejects.toThrow(BadRequestException)
      await expect(controller.getMyEarningsDay(args, mockCourier)).rejects.toThrow('Unknown timezone')
    })

    test('throws BadRequestException when an invalid calendar date is provided', async () => {
      const args = { date: '2026-02-30' }

      await expect(controller.getMyEarningsDay(args, mockCourier)).rejects.toThrow(BadRequestException)
      await expect(controller.getMyEarningsDay(args, mockCourier)).rejects.toThrow('Invalid date')
    })
  })

  describe('getMyEarningsDeliveryDetail', () => {
    // Test Plan Section 6: getMyEarningsDeliveryDetail
    test('returns delivery detail DTO when domain service resolves a completed delivery', async () => {
      const mockDetail = {
        deliveryId: 'del-abc',
        droppedOffAt: new Date('2026-07-10T12:00:00Z'),
        dropoffAddress: 'Iasonos 12, Volos',
        pickupBusinessName: 'Ta Koutsavakia',
        compensation: 650,
        tips: 150,
        total: 800,
      }
      mockDeliveryEventDomainService.getEarningsDeliveryDetailForCourier.mockResolvedValue(mockDetail)

      const result = await controller.getMyEarningsDeliveryDetail('del-abc', mockCourier)

      // Verify domain service called with logged in courier id and URL delivery id
      expect(mockDeliveryEventDomainService.getEarningsDeliveryDetailForCourier).toHaveBeenCalledWith(
        'courier-777',
        'del-abc'
      )

      expect(result.deliveryId).toBe('del-abc')
      expect(result.currency).toBe('EUR')
      expect(result.compensation).toBe(650)
      expect(result.tips).toBe(150)
      expect(result.total).toBe(800)
      expect(result.pickupBusinessName).toBe('Ta Koutsavakia')
      expect(result.dropoffAddress).toBe('Iasonos 12, Volos')
    })

    test('throws NotFoundException when domain service returns null', async () => {
      // Domain service returns null when delivery does not exist or belong to courier
      mockDeliveryEventDomainService.getEarningsDeliveryDetailForCourier.mockResolvedValue(null)

      await expect(controller.getMyEarningsDeliveryDetail('del-unknown', mockCourier)).rejects.toThrow(
        NotFoundException
      )
      await expect(controller.getMyEarningsDeliveryDetail('del-unknown', mockCourier)).rejects.toThrow(
        'Completed delivery not found'
      )
    })

    test('always scopes query to authenticated courier ID from token', async () => {
      mockDeliveryEventDomainService.getEarningsDeliveryDetailForCourier.mockResolvedValue({
        deliveryId: 'del-abc',
        droppedOffAt: new Date('2026-07-10T12:00:00Z'),
        dropoffAddress: null,
        pickupBusinessName: 'Test Biz',
        compensation: 500,
        tips: 0,
        total: 500,
      })

      await controller.getMyEarningsDeliveryDetail('del-abc', mockCourier)

      // Confirm first argument to domain service is logged in courier.id ('courier-777')
      expect(mockDeliveryEventDomainService.getEarningsDeliveryDetailForCourier.mock.calls[0]?.[0]).toBe('courier-777')
    })
  })
})


