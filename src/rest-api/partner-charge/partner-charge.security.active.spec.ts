import { PATH_METADATA } from '@nestjs/common/constants'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { PartnerChargeAdminRestApiController } from './admin/partner-charge.admin.rest-api.controller'

describe('Partner Charge Security Model (Spec 0036, AC-13)', () => {
  describe('Admin namespace & ADMIN role protection', () => {
    it('PartnerChargeAdminRestApiController uses ADMIN_API_V1_PREFIX', () => {
      const path = Reflect.getMetadata(PATH_METADATA, PartnerChargeAdminRestApiController)
      expect(path).toBe(ADMIN_API_V1_PREFIX)
    })

    const endpoints = ['getMonth', 'getPartnerMonth', 'createBill', 'undoBill', 'getStatement']

    test.each(endpoints)('%s endpoint requires EnumUserRole.ADMIN role', (methodName) => {
      const handler = (PartnerChargeAdminRestApiController.prototype as any)[methodName]
      expect(handler).toBeDefined()
      const roles: EnumUserRole[] | undefined = Reflect.getMetadata(ROLES_KEY, handler)
      expect(roles).toEqual([EnumUserRole.ADMIN])
    })

    test('undoBill endpoint requires EnumUserRole.ADMIN role', () => {
      const handler = PartnerChargeAdminRestApiController.prototype.undoBill
      expect(handler).toBeDefined()
      const roles = Reflect.getMetadata(ROLES_KEY, handler)
      expect(roles).toEqual([EnumUserRole.ADMIN])
    })
  })
})
