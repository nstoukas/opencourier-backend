import { METHOD_METADATA, PATH_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'
import { EnumDeliveryStatus, EnumUserRole } from '@prisma/types'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { LeaveWaitCourierRestApiController } from './leave-wait.courier.rest-api.controller'
import { LeaveWaitCourierService } from './leave-wait.courier.service'

describe('LeaveWaitCourierRestApiController (Spec 0033 AC-6)', () => {
  let controller: LeaveWaitCourierRestApiController
  let mockLeaveWaitCourierService: jest.Mocked<LeaveWaitCourierService>

  const courier: CourierEntity = {
    id: 'courier-rider-1',
    userId: 'user-courier-1',
    firstName: 'Nikos',
    lastName: 'Rider',
  } as CourierEntity

  beforeEach(() => {
    mockLeaveWaitCourierService = {
      leave: jest.fn().mockResolvedValue({ status: EnumDeliveryStatus.ASSIGNING_COURIER }),
    } as unknown as jest.Mocked<LeaveWaitCourierService>

    controller = new LeaveWaitCourierRestApiController(mockLeaveWaitCourierService)
  })

  describe('Routing, HTTP Method & Roles Metadata', () => {
    it('is mapped to POST :deliveryId/leave-wait with 200 OK (not 201)', () => {
      const path = Reflect.getMetadata(PATH_METADATA, controller.leave)
      const method = Reflect.getMetadata(METHOD_METADATA, controller.leave)
      const httpCode = Reflect.getMetadata(HTTP_CODE_METADATA, controller.leave)

      expect(path).toBe(':deliveryId/leave-wait')
      expect(method).toBe(RequestMethod.POST)
      expect(httpCode).toBe(200)
    })

    it('requires COURIER role via @Roles decorator', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.leave)
      expect(roles).toEqual([EnumUserRole.COURIER])
    })
  })

  describe('Handler Execution', () => {
    it('delegates to LeaveWaitCourierService with deliveryId, courier.id, and tapAgeMs', async () => {
      const deliveryId = 'del-wait-42'
      const input = { tapAgeMs: 45_000 }

      const result = await controller.leave(deliveryId, input as any, courier)

      expect(mockLeaveWaitCourierService.leave).toHaveBeenCalledWith(
        'del-wait-42',
        'courier-rider-1',
        45_000
      )
      expect(result).toEqual({ status: EnumDeliveryStatus.ASSIGNING_COURIER })
    })

    it('passes undefined tapAgeMs when input has no tapAgeMs', async () => {
      const deliveryId = 'del-wait-43'
      const input = {}

      const result = await controller.leave(deliveryId, input as any, courier)

      expect(mockLeaveWaitCourierService.leave).toHaveBeenCalledWith(
        'del-wait-43',
        'courier-rider-1',
        undefined
      )
      expect(result).toEqual({ status: EnumDeliveryStatus.ASSIGNING_COURIER })
    })
  })
})
