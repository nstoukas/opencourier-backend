import { ConflictException } from '@nestjs/common'
import { EnumDeliveryStatus, EnumUserRole } from '@prisma/types'
import { DeliveryNotFoundException } from 'src/errors'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { IS_API_KEY_AUTH } from 'src/decorators/api-key-auth.decorator'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { DeliveryPartnerRestApiService } from './delivery.partner.rest-api.service'
import { DeliveryPartnerRestApiController } from './delivery.partner.rest-api.controller'
import { DeliveryPartnerDto } from './dtos/delivery.partner.dto'

// Spec 0023, AC-3 to AC-5: the two partner routes. Only the delivery's own restaurant acts:
// ownership is checked first (another restaurant's order and an unknown id are the usual 404),
// before any write.
describe('Partner ready routes (spec 0023)', () => {
  const partnerId = 'partner-nosh'
  const otherPartnerId = 'partner-other'

  describe('DeliveryPartnerRestApiService.delayReady / markFoodReady (AC-5)', () => {
    let service: DeliveryPartnerRestApiService
    let deliveryDomainService: any
    let configDomainService: any

    const own = (overrides: Record<string, unknown> = {}) => ({
      id: 'del-1',
      partnerId,
      status: EnumDeliveryStatus.DISPATCHED,
      createdAt: new Date(),
      ...overrides,
    })

    beforeEach(() => {
      deliveryDomainService = {
        getByIdOrThrow: jest.fn(),
        delayReady: jest.fn().mockResolvedValue({ id: 'del-1' }),
        markFoodReady: jest.fn().mockResolvedValue({ id: 'del-1' }),
      }
      configDomainService = {
        instanceConfig: { getRestaurantHistoryDays: jest.fn().mockResolvedValue(30) },
      }
      service = new DeliveryPartnerRestApiService(
        {} as any,
        deliveryDomainService,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        { findOn: jest.fn().mockResolvedValue(null) } as any,
        configDomainService,
        {} as any,
        {} as any
      )
    })

    test('delayReady on its own delivery passes id, minutes and expectedReadyAt to the domain', async () => {
      deliveryDomainService.getByIdOrThrow.mockResolvedValue(own())
      const expected = new Date('2026-11-03T12:18:00.000Z')

      const result = await service.delayReady('del-1', partnerId, 10, expected)

      expect(deliveryDomainService.delayReady).toHaveBeenCalledWith('del-1', 10, expected)
      expect(result).toEqual({ id: 'del-1' })
    })

    test('delayReady on another restaurant delivery is the plain 404, before any write', async () => {
      deliveryDomainService.getByIdOrThrow.mockResolvedValue(own({ partnerId: otherPartnerId }))

      await expect(service.delayReady('del-1', partnerId, 10, null)).rejects.toThrow(
        new DeliveryNotFoundException('Delivery not found')
      )
      expect(deliveryDomainService.delayReady).not.toHaveBeenCalled()
    })

    test('delayReady on an own order older than the history period is 404 with the period sentence', async () => {
      deliveryDomainService.getByIdOrThrow.mockResolvedValue(
        own({ status: EnumDeliveryStatus.DROPPED_OFF, createdAt: new Date(Date.now() - 40 * 24 * 3600 * 1000) })
      )

      await expect(service.delayReady('del-1', partnerId, 10, null)).rejects.toThrow(DeliveryNotFoundException)
      expect(deliveryDomainService.delayReady).not.toHaveBeenCalled()
    })

    test('delayReady on an unknown id fails with the lookup error and writes nothing', async () => {
      deliveryDomainService.getByIdOrThrow.mockRejectedValue(new DeliveryNotFoundException('Delivery not found'))

      await expect(service.delayReady('nope', partnerId, 10, null)).rejects.toThrow(DeliveryNotFoundException)
      expect(deliveryDomainService.delayReady).not.toHaveBeenCalled()
    })

    test('markFoodReady on its own delivery passes the id to the domain', async () => {
      deliveryDomainService.getByIdOrThrow.mockResolvedValue(own())

      await service.markFoodReady('del-1', partnerId)

      expect(deliveryDomainService.markFoodReady).toHaveBeenCalledWith('del-1')
    })

    test('markFoodReady on another restaurant delivery is the plain 404, before any write', async () => {
      deliveryDomainService.getByIdOrThrow.mockResolvedValue(own({ partnerId: otherPartnerId }))

      await expect(service.markFoodReady('del-1', partnerId)).rejects.toThrow(
        new DeliveryNotFoundException('Delivery not found')
      )
      expect(deliveryDomainService.markFoodReady).not.toHaveBeenCalled()
    })

    test('markFoodReady on an unknown id writes nothing', async () => {
      deliveryDomainService.getByIdOrThrow.mockRejectedValue(new DeliveryNotFoundException('Delivery not found'))

      await expect(service.markFoodReady('nope', partnerId)).rejects.toThrow(DeliveryNotFoundException)
      expect(deliveryDomainService.markFoodReady).not.toHaveBeenCalled()
    })

    test('a domain refusal reaches the caller as it is (409 with its sentence)', async () => {
      deliveryDomainService.getByIdOrThrow.mockResolvedValue(own())
      deliveryDomainService.markFoodReady.mockRejectedValue(new ConflictException('This order has ended.'))

      await expect(service.markFoodReady('del-1', partnerId)).rejects.toThrow(new ConflictException('This order has ended.'))
    })
  })

  describe('DeliveryPartnerRestApiController routes (AC-3, AC-4)', () => {
    let controller: DeliveryPartnerRestApiController
    let restApiService: any
    const partner = new PartnerEntity({ id: partnerId } as any)

    const answered = {
      id: 'del-1',
      status: EnumDeliveryStatus.DISPATCHED,
      readyAt: new Date('2026-11-03T12:28:00.000Z'),
      foodReadyAt: null,
      pickupReadyAt: new Date('2026-11-03T12:00:00.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    beforeEach(() => {
      restApiService = {
        delayReady: jest.fn().mockResolvedValue(answered),
        markFoodReady: jest.fn().mockResolvedValue({ ...answered, foodReadyAt: new Date('2026-11-03T12:10:00.000Z') }),
      }
      controller = new DeliveryPartnerRestApiController(restApiService, {} as any)
    })

    test('ready-delay turns expectedReadyAt into a Date and answers the partner delivery DTO with readyAt and foodReadyAt', async () => {
      const dto = await controller.delayReady('del-1', partner, { minutes: 10, expectedReadyAt: '2026-11-03T12:18:00.000Z' })

      expect(restApiService.delayReady).toHaveBeenCalledWith('del-1', partnerId, 10, new Date('2026-11-03T12:18:00.000Z'))
      expect(dto).toBeInstanceOf(DeliveryPartnerDto)
      expect(dto.readyAt).toEqual(answered.readyAt)
      expect(dto.foodReadyAt).toBeNull()
      // pickupReadyAt keeps its own meaning and value (AC-1, AC-10).
      expect(dto.pickupReadyAt).toEqual(answered.pickupReadyAt)
    })

    test('ready-delay with expectedReadyAt null passes null', async () => {
      await controller.delayReady('del-1', partner, { minutes: 5, expectedReadyAt: null })

      expect(restApiService.delayReady).toHaveBeenCalledWith('del-1', partnerId, 5, null)
    })

    test('food-ready answers the partner delivery DTO with foodReadyAt', async () => {
      const dto = await controller.markFoodReady('del-1', partner)

      expect(restApiService.markFoodReady).toHaveBeenCalledWith('del-1', partnerId)
      expect(dto.foodReadyAt).toEqual(new Date('2026-11-03T12:10:00.000Z'))
    })

    test.each(['delayReady', 'markFoodReady'] as const)('%s is a partner route behind the partner session', (handler) => {
      expect(Reflect.getMetadata(ROLES_KEY, controller[handler])).toEqual([EnumUserRole.PARTNER])
      expect(Reflect.getMetadata(IS_API_KEY_AUTH, controller[handler])).toBe(true)
    })

    test('the routes are POST :deliveryId/ready-delay and POST :deliveryId/food-ready', () => {
      // Nest stores the path and method (1 = POST) on each handler.
      expect(Reflect.getMetadata('path', controller.delayReady)).toBe(':deliveryId/ready-delay')
      expect(Reflect.getMetadata('method', controller.delayReady)).toBe(1)
      expect(Reflect.getMetadata('path', controller.markFoodReady)).toBe(':deliveryId/food-ready')
      expect(Reflect.getMetadata('method', controller.markFoodReady)).toBe(1)
    })
  })
})
