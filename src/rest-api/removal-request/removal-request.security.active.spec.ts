import { PATH_METADATA } from '@nestjs/common/constants'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX, COURIER_API_V1_PREFIX } from 'src/constants'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { RemovalRequestAdminRestApiController } from './admin/removal-request.admin.rest-api.controller'
import { RemovalRequestCourierRestApiController } from './courier/removal-request.courier.rest-api.controller'

describe('Removal Request Security Model (Spec 0035)', () => {
  describe('Admin namespace & ADMIN role protection', () => {
    it('RemovalRequestAdminRestApiController uses ADMIN_API_V1_PREFIX', () => {
      const path = Reflect.getMetadata(PATH_METADATA, RemovalRequestAdminRestApiController)
      expect(path).toBe(ADMIN_API_V1_PREFIX)
    })

    const adminEndpoints = [
      'approve',
      'decline',
      'listForDelivery',
      'listReasons',
      'createReason',
      'updateReason',
      'removeReason',
    ]

    test.each(adminEndpoints)('%s endpoint requires EnumUserRole.ADMIN role', (methodName) => {
      const handler = (RemovalRequestAdminRestApiController.prototype as any)[methodName]
      expect(handler).toBeDefined()
      const roles: EnumUserRole[] | undefined = Reflect.getMetadata(ROLES_KEY, handler)
      expect(roles).toEqual([EnumUserRole.ADMIN])
    })
  })

  describe('Courier namespace & COURIER role protection', () => {
    it('RemovalRequestCourierRestApiController uses COURIER_API_V1_PREFIX', () => {
      const path = Reflect.getMetadata(PATH_METADATA, RemovalRequestCourierRestApiController)
      expect(path).toBe(COURIER_API_V1_PREFIX)
    })

    const courierEndpoints = ['getReasons', 'request', 'withdraw']

    test.each(courierEndpoints)('%s endpoint requires EnumUserRole.COURIER role', (methodName) => {
      const handler = (RemovalRequestCourierRestApiController.prototype as any)[methodName]
      expect(handler).toBeDefined()
      const roles: EnumUserRole[] | undefined = Reflect.getMetadata(ROLES_KEY, handler)
      expect(roles).toEqual([EnumUserRole.COURIER])
    })
  })
})
