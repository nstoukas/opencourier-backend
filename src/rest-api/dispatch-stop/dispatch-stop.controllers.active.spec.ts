import { EnumUserRole } from '@prisma/types'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { DispatchStopAdminRestApiController } from './admin/dispatch-stop.admin.rest-api.controller'
import { DispatchStopCourierRestApiController } from './courier/dispatch-stop.courier.rest-api.controller'
import { DispatchStopPartnerRestApiController } from './partner/dispatch-stop.partner.rest-api.controller'
import { UserEntity } from 'src/domains/user/entities/user.entity'

describe('Dispatch Stop Controllers - Roles and Endpoints (Spec 0014, AC-10)', () => {
  let mockDispatchStopService: any
  let adminController: DispatchStopAdminRestApiController
  let courierController: DispatchStopCourierRestApiController
  let partnerController: DispatchStopPartnerRestApiController

  const adminUser = new UserEntity({
    id: 'admin-1',
    email: 'admin@coop.gr',
    role: [EnumUserRole.ADMIN],
    credentialsChangedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any)

  beforeEach(() => {
    mockDispatchStopService = {
      adminOverview: jest.fn().mockResolvedValue({ current: null, scheduled: [], history: [] }),
      preview: jest.fn().mockResolvedValue({ offersToEnd: 1, deliveriesToReturn: 2 }),
      create: jest.fn().mockResolvedValue({ id: 'stop-created' }),
      endOrCancel: jest.fn().mockResolvedValue({ id: 'stop-ended' }),
      state: jest.fn().mockResolvedValue({ current: null, next: null }),
    }

    adminController = new DispatchStopAdminRestApiController(mockDispatchStopService)
    courierController = new DispatchStopCourierRestApiController(mockDispatchStopService)
    partnerController = new DispatchStopPartnerRestApiController(mockDispatchStopService)
  })

  describe('DispatchStopAdminRestApiController', () => {
    test('all admin route handlers carry @Roles(ADMIN)', () => {
      const handlers = ['overview', 'preview', 'create', 'end']
      for (const handlerName of handlers) {
        const handler = (adminController as any)[handlerName]
        const roles = Reflect.getMetadata(ROLES_KEY, handler)
        expect(roles).toEqual([EnumUserRole.ADMIN])
      }
    })

    test('admin handlers delegate to dispatchStopService with admin userId', async () => {
      await adminController.overview()
      expect(mockDispatchStopService.adminOverview).toHaveBeenCalledWith(expect.any(Date))

      await adminController.preview()
      expect(mockDispatchStopService.preview).toHaveBeenCalled()

      const createBody: any = { reason: 'HEAT' }
      await adminController.create(createBody, adminUser)
      expect(mockDispatchStopService.create).toHaveBeenCalledWith(createBody, adminUser.id)

      await adminController.end('stop-1', adminUser)
      expect(mockDispatchStopService.endOrCancel).toHaveBeenCalledWith('stop-1', adminUser.id)
    })
  })

  describe('DispatchStopCourierRestApiController', () => {
    test('state route handler carries @Roles(COURIER)', () => {
      const handler = courierController.state
      const roles = Reflect.getMetadata(ROLES_KEY, handler)
      expect(roles).toEqual([EnumUserRole.COURIER])
    })

    test('delegates to dispatchStopService.state with courier audience', async () => {
      await courierController.state()
      expect(mockDispatchStopService.state).toHaveBeenCalledWith('courier', expect.any(Date))
    })
  })

  describe('DispatchStopPartnerRestApiController', () => {
    test('state route handler carries @Roles(PARTNER)', () => {
      const handler = partnerController.state
      const roles = Reflect.getMetadata(ROLES_KEY, handler)
      expect(roles).toEqual([EnumUserRole.PARTNER])
    })

    test('delegates to dispatchStopService.state with partner audience', async () => {
      await partnerController.state()
      expect(mockDispatchStopService.state).toHaveBeenCalledWith('partner', expect.any(Date))
    })
  })
})
