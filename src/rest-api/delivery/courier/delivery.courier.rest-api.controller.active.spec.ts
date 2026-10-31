import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'
import { EnumDeliveryIssueReason, EnumUserRole } from '@prisma/types'
import { DeliveryCourierRestApiController } from './delivery.courier.rest-api.controller'
import { DeliveryRestApiCourierService } from './delivery.courier.rest-api.service'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { DeliveryNotFoundException } from 'src/errors'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { DeliveryIssueWithCourier } from 'src/persistence/repositories/delivery-issue.repository'
import { DeliveryIssueCourierDto } from './dtos/delivery-issue.courier.dto'

describe('DeliveryCourierRestApiController.reportIssue (clause 1)', () => {
  let controller: DeliveryCourierRestApiController
  let mockDeliveryRestApiCourierService: jest.Mocked<DeliveryRestApiCourierService>
  let mockDeliveryDomainService: jest.Mocked<DeliveryDomainService>

  const mockCourier = {
    id: 'courier-42',
    firstName: 'Alexandros',
    lastName: 'Iordanidis',
  } as CourierEntity

  const deliveryId = 'del-xyz-789'

  const mockStoredIssue: DeliveryIssueWithCourier = {
    id: 'issue-42',
    deliveryId,
    courierId: 'courier-42',
    reason: EnumDeliveryIssueReason.ORDER_HANDED,
    note: 'Handed to recipient in lobby',
    createdAt: new Date('2026-10-27T08:20:00.000Z'),
    courier: {
      firstName: 'Alexandros',
      lastName: 'Iordanidis',
    },
  }

  beforeEach(() => {
    mockDeliveryRestApiCourierService = {
      reportIssue: jest.fn(),
      markAsDispatched: jest.fn().mockResolvedValue({ id: deliveryId, status: 'DISPATCHED' } as any),
      courierArrivedAtPickup: jest.fn().mockResolvedValue({ id: deliveryId, status: 'COURIER_ARRIVED_AT_PICKUP_LOCATION' } as any),
      courierArrivedAtDropOff: jest.fn().mockResolvedValue({ id: deliveryId, status: 'COURIER_ARRIVED_AT_DROPOFF_LOCATION' } as any),
      markAsPickedUp: jest.fn().mockResolvedValue({ id: deliveryId, status: 'PICKED_UP' } as any),
      markAsDelivered: jest.fn().mockResolvedValue({ id: deliveryId, status: 'DROPPED_OFF' } as any),
    } as unknown as jest.Mocked<DeliveryRestApiCourierService>

    mockDeliveryDomainService = {} as jest.Mocked<DeliveryDomainService>

    controller = new DeliveryCourierRestApiController(
      mockDeliveryRestApiCourierService,
      mockDeliveryDomainService
    )
  })

  test('answers the stored report as DeliveryIssueCourierDto (id, reason, note, createdAt)', async () => {
    mockDeliveryRestApiCourierService.reportIssue.mockResolvedValue(mockStoredIssue)

    const input = {
      reason: EnumDeliveryIssueReason.ORDER_HANDED,
      note: 'Handed to recipient in lobby',
    }

    const result = await controller.reportIssue(deliveryId, input, mockCourier)

    expect(mockDeliveryRestApiCourierService.reportIssue).toHaveBeenCalledWith(
      deliveryId,
      mockCourier.id,
      input
    )
    expect(result).toBeInstanceOf(DeliveryIssueCourierDto)
    expect(result.id).toBe('issue-42')
    expect(result.reason).toBe(EnumDeliveryIssueReason.ORDER_HANDED)
    expect(result.note).toBe('Handed to recipient in lobby')
    expect(result.createdAt).toEqual(new Date('2026-10-27T08:20:00.000Z'))
    // Courier DTO does not expose courier name / courier id back to caller
    expect((result as any).courierId).toBeUndefined()
    expect((result as any).courierName).toBeUndefined()
  })

  test('reportIssue handler carries @Roles(COURIER) decorator metadata', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, controller.reportIssue)
    expect(roles).toEqual([EnumUserRole.COURIER])
  })

  test('reportIssue is routed at PATH :deliveryId/issues with METHOD POST', () => {
    const path = Reflect.getMetadata(PATH_METADATA, controller.reportIssue)
    const method = Reflect.getMetadata(METHOD_METADATA, controller.reportIssue)
    expect(path).toBe(':deliveryId/issues')
    expect(method).toBe(RequestMethod.POST)
  })

  test('propagates DeliveryNotFoundException when delivery does not belong to courier or does not exist', async () => {
    mockDeliveryRestApiCourierService.reportIssue.mockRejectedValue(
      new DeliveryNotFoundException('Delivery not found')
    )

    const input = {
      reason: EnumDeliveryIssueReason.OTHER,
      note: 'Issue note',
    }

    await expect(controller.reportIssue(deliveryId, input, mockCourier)).rejects.toThrow(
      DeliveryNotFoundException
    )
  })

  describe('Five courier step endpoints forward body with tapAgeMs (Spec 0009, AC-4, AC-9)', () => {
    test('markAsDispatched forwards input to service', async () => {
      const input = { tapAgeMs: 5000 }
      await controller.markAsDispatched(deliveryId, input, mockCourier)

      expect(mockDeliveryRestApiCourierService.markAsDispatched).toHaveBeenCalledWith(
        deliveryId,
        mockCourier.id,
        input
      )
    })

    test('courierArrivedAtPickup forwards input to service', async () => {
      const input = { tapAgeMs: 3000 }
      await controller.courierArrivedAtPickup(deliveryId, input, mockCourier)

      expect(mockDeliveryRestApiCourierService.courierArrivedAtPickup).toHaveBeenCalledWith(
        deliveryId,
        mockCourier.id,
        input
      )
    })

    test('courierArrivedAtDropoff forwards input to service', async () => {
      const input = { tapAgeMs: 2500 }
      await controller.courierArrivedAtDropoff(deliveryId, input, mockCourier)

      expect(mockDeliveryRestApiCourierService.courierArrivedAtDropOff).toHaveBeenCalledWith(
        deliveryId,
        mockCourier.id,
        input
      )
    })

    test('markAsPickedUp forwards note and tapAgeMs to service', async () => {
      const input = { note: 'Picked up from chef', tapAgeMs: 6000 }
      await controller.markAsPickedUp(deliveryId, input, mockCourier)

      expect(mockDeliveryRestApiCourierService.markAsPickedUp).toHaveBeenCalledWith(
        deliveryId,
        mockCourier.id,
        {
          note: 'Picked up from chef',
          tapAgeMs: 6000,
        }
      )
    })

    test('markAsDelivered forwards input to service', async () => {
      const input = { note: 'Left at door', tapAgeMs: 4000 }
      await controller.markAsDelivered(deliveryId, input, mockCourier)

      expect(mockDeliveryRestApiCourierService.markAsDelivered).toHaveBeenCalledWith(
        deliveryId,
        mockCourier.id,
        input
      )
    })
  })
})
