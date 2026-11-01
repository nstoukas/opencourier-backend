import { MODULE_METADATA } from '@nestjs/common/constants'
import { AdminRestApiModule } from '../admin.rest-api.module'
import { CourierRestApiModule } from '../courier.rest-api.module'
import { PartnerRestApiModule } from '../partner.rest-api.module'
import { DispatchStopAdminRestApiModule } from './admin/dispatch-stop.admin.rest-api.module'
import { DispatchStopCourierRestApiModule } from './courier/dispatch-stop.courier.rest-api.module'
import { DispatchStopPartnerRestApiModule } from './partner/dispatch-stop.partner.rest-api.module'
import { DispatchStopAdminRestApiController } from './admin/dispatch-stop.admin.rest-api.controller'
import { DispatchStopCourierRestApiController } from './courier/dispatch-stop.courier.rest-api.controller'
import { DispatchStopPartnerRestApiController } from './partner/dispatch-stop.partner.rest-api.controller'

describe('Dispatch Stop API Modules - Audience Separation (AGENTS.md, Row 29 Review)', () => {
  it('registers each controller only in its audience module (no controller of one audience in another module)', () => {
    const adminControllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DispatchStopAdminRestApiModule) || []
    const courierControllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DispatchStopCourierRestApiModule) || []
    const partnerControllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DispatchStopPartnerRestApiModule) || []

    // Admin module registers only the admin controller
    expect(adminControllers).toContain(DispatchStopAdminRestApiController)
    expect(adminControllers).not.toContain(DispatchStopCourierRestApiController)
    expect(adminControllers).not.toContain(DispatchStopPartnerRestApiController)
    expect(adminControllers).toEqual([DispatchStopAdminRestApiController])

    // Courier module registers only the courier controller
    expect(courierControllers).toContain(DispatchStopCourierRestApiController)
    expect(courierControllers).not.toContain(DispatchStopAdminRestApiController)
    expect(courierControllers).not.toContain(DispatchStopPartnerRestApiController)
    expect(courierControllers).toEqual([DispatchStopCourierRestApiController])

    // Partner module registers only the partner controller
    expect(partnerControllers).toContain(DispatchStopPartnerRestApiController)
    expect(partnerControllers).not.toContain(DispatchStopAdminRestApiController)
    expect(partnerControllers).not.toContain(DispatchStopCourierRestApiController)
    expect(partnerControllers).toEqual([DispatchStopPartnerRestApiController])
  })

  it('imports each dispatch stop module into its respective audience root module (no audience mixing)', () => {
    const adminImports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AdminRestApiModule) || []
    const courierImports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, CourierRestApiModule) || []
    const partnerImports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, PartnerRestApiModule) || []

    // Each root module imports its own audience module
    expect(adminImports).toContain(DispatchStopAdminRestApiModule)
    expect(courierImports).toContain(DispatchStopCourierRestApiModule)
    expect(partnerImports).toContain(DispatchStopPartnerRestApiModule)

    // No audience mixing: neither root module imports modules of another audience
    expect(adminImports).not.toContain(DispatchStopCourierRestApiModule)
    expect(adminImports).not.toContain(DispatchStopPartnerRestApiModule)

    expect(courierImports).not.toContain(DispatchStopAdminRestApiModule)
    expect(courierImports).not.toContain(DispatchStopPartnerRestApiModule)

    expect(partnerImports).not.toContain(DispatchStopAdminRestApiModule)
    expect(partnerImports).not.toContain(DispatchStopCourierRestApiModule)
  })
})
