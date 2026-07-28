import { IS_API_KEY_AUTH } from 'src/decorators/api-key-auth.decorator'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { EnumUserRole } from '@prisma/types'
import { AuthPartnerRestApiController } from 'src/rest-api/auth/partner/auth.partner.rest-api.controller'
import { DeliveryPartnerRestApiController } from 'src/rest-api/delivery/partner/delivery.partner.rest-api.controller'
import { DeliveryQuotePartnerRestApiController } from 'src/rest-api/delivery-quote/partner/delivery-quote.partner.rest-api.controller'
import { PartnerPartnerRestApiController } from 'src/rest-api/partner/partner/partner.partner.rest-api.controller'

// Maintenance note: To add a new partner controller, add it to this list — without an entry here,
// a missing @Roles decorator on any @ApiKeyAuth() handler will not be caught.
describe('ApiKeyRoutesHaveRoles (Regression Guard)', () => {
  const partnerControllers = [
    { name: 'AuthPartnerRestApiController', controllerClass: AuthPartnerRestApiController },
    { name: 'DeliveryPartnerRestApiController', controllerClass: DeliveryPartnerRestApiController },
    { name: 'DeliveryQuotePartnerRestApiController', controllerClass: DeliveryQuotePartnerRestApiController },
    { name: 'PartnerPartnerRestApiController', controllerClass: PartnerPartnerRestApiController },
  ]

  test('Floor assertion: total @ApiKeyAuth() handlers across partner controllers must be at least 10', () => {
    let totalApiKeyHandlers = 0
    partnerControllers.forEach(({ controllerClass }) => {
      const prototype = controllerClass.prototype as Record<string, any>
      const methodNames = Object.getOwnPropertyNames(prototype).filter(
        (prop) => prop !== 'constructor' && typeof prototype[prop] === 'function'
      )
      methodNames.forEach((methodName) => {
        const handler = prototype[methodName]
        if (Reflect.getMetadata(IS_API_KEY_AUTH, handler)) {
          totalApiKeyHandlers++
        }
      })
    })
    expect(totalApiKeyHandlers).toBeGreaterThanOrEqual(10)
  })

  partnerControllers.forEach(({ name, controllerClass }) => {
    describe(`${name}`, () => {
      const prototype = controllerClass.prototype as Record<string, any>
      const methodNames = Object.getOwnPropertyNames(prototype).filter(
        (prop) => prop !== 'constructor' && typeof prototype[prop] === 'function'
      )

      methodNames.forEach((methodName) => {
        const handler = prototype[methodName]
        const isApiKeyAuth = Reflect.getMetadata(IS_API_KEY_AUTH, handler)

        if (isApiKeyAuth) {
          test(`handler '${methodName}' carrying @ApiKeyAuth() MUST also carry @Roles(PARTNER)`, () => {
            const roles: EnumUserRole[] | undefined = Reflect.getMetadata(ROLES_KEY, handler)

            expect(roles).toBeDefined()
            expect(Array.isArray(roles)).toBe(true)
            expect(roles).toContain(EnumUserRole.PARTNER)
          })
        }
      })
    })
  })
})
