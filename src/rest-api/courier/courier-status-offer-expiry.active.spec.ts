import { CourierAdminRestApiService } from 'src/rest-api/courier/admin/courier.admin.rest-api.service'
import { EnumCourierStatus, EnumCourierStatusChangeCause } from '@prisma/types'
import { CourierCourierRestApiController } from './courier/courier.courier.rest-api.controller'
import { CourierAdminRestApiController } from './admin/courier.admin.rest-api.controller'
import { CourierDomainService } from '../../domains/courier/courier.domain.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { CourierEntity } from '../../domains/courier/entities/courier.entity'
import { CourierAccountService } from 'src/services/courier-account/courier-account.service'

// Spec 0051: the admin's PATCH now runs CourierAccountService.editByAdmin. The real service is built here
// over a fake database, so these tests still check the whole path from the controller: the status first,
// with its cause, then open offers ended, then the other fields saved.
function accountServiceOverFakes(
  courierDomainService: unknown,
  deliveryEventService: unknown,
  fieldSave: jest.Mock
): { service: CourierAccountService; prisma: unknown } {
  const tx = { courier: { update: fieldSave }, user: { update: jest.fn() } }
  const prisma = {
    courier: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'stored-rider',
        firstName: 'Stored',
        lastName: 'Rider',
        phoneNumber: '+306900000000',
        status: EnumCourierStatus.ONLINE,
        deliverySetting: 'MANUAL',
        deactivatedAt: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        user: { id: 'stored-user', email: 'stored@coop.gr' },
      }),
    },
    $transaction: jest.fn().mockImplementation((work: (client: typeof tx) => unknown) => work(tx)),
  }
  const service = new CourierAccountService(
    { record: jest.fn().mockResolvedValue(undefined) } as any, // accounts
    { findByPhoneNumber: jest.fn().mockResolvedValue(null) } as any, // courierRepository
    courierDomainService as any,
    { findUserWithEmailIgnoringCase: jest.fn().mockResolvedValue(null) } as any, // userDomainService
    {} as any, // passwordService
    {} as any, // authDomainService
    {} as any, // courierCutOffService
    deliveryEventService as any,
    {} as any, // courierDeviceRepository
    {} as any, // websocketDispatcher
    { delete: jest.fn() } as any, // cacheService
    { isConfigured: jest.fn().mockReturnValue(false) } as any, // mailService
    {} as any, // configDomainService
    prisma as any
  )
  return { service, prisma }
}

describe('Courier Controllers - Offer Expiry Hooks (Spec 0002, AC-6)', () => {
  let mockCourierDomainService: jest.Mocked<CourierDomainService>
  let mockDeliveryEventService: jest.Mocked<DeliveryEventService>

  beforeEach(() => {
    mockCourierDomainService = {
      changeStatus: jest.fn().mockResolvedValue({ changed: true, fromStatus: EnumCourierStatus.ONLINE }),
      update: jest.fn().mockImplementation((id, data) =>
        Promise.resolve(
          new CourierEntity({
            id,
            status: data.status ?? EnumCourierStatus.ONLINE,
            firstName: 'Test',
            lastName: 'Rider',
          } as any)
        )
      ),
      // Spec 0051: the edit answers the rider as stored after the save.
      getByIdOrThrow: jest.fn().mockImplementation((id) =>
        Promise.resolve(new CourierEntity({ id, firstName: 'Test', lastName: 'Rider' } as any))
      ),
    } as unknown as jest.Mocked<CourierDomainService>

    mockDeliveryEventService = {
      handleCourierStatusChanged: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeliveryEventService>
  })

  describe('CourierCourierRestApiController (PATCH courier/status)', () => {
    let controller: CourierCourierRestApiController

    beforeEach(() => {
      controller = new CourierCourierRestApiController(
        mockCourierDomainService,
        mockDeliveryEventService
      )
    })

    it('calls handleCourierStatusChanged with rider id and new status when rider changes status', async () => {
      const courier = new CourierEntity({ id: 'courier-rider-1' } as any)
      const input = { status: EnumCourierStatus.OFFLINE }

      await controller.updateStatus(input as any, courier)

      expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
        'courier-rider-1',
        EnumCourierStatus.OFFLINE,
        EnumCourierStatusChangeCause.RIDER
      )
      expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
        'courier-rider-1',
        EnumCourierStatus.OFFLINE
      )
    })

    it('returns before handleCourierStatusChanged resolves (fire-and-forget matching)', async () => {
      const courier = new CourierEntity({ id: 'courier-rider-2', status: EnumCourierStatus.OFFLINE } as any)
      const input = { status: EnumCourierStatus.ONLINE }

      // handleCourierStatusChanged returns a never-resolving promise (e.g. slow matching)
      mockDeliveryEventService.handleCourierStatusChanged.mockImplementation(
        () => new Promise(() => {}) // never resolves
      )

      // The controller call must resolve promptly without waiting for handleCourierStatusChanged
      const resultPromise = controller.updateStatus(input as any, courier)
      await expect(resultPromise).resolves.toBeUndefined()
      expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
        'courier-rider-2',
        EnumCourierStatus.ONLINE,
        EnumCourierStatusChangeCause.RIDER
      )
    })
  })

  describe('CourierAdminRestApiController (PATCH admin/v1/courier/:id)', () => {
    let controller: CourierAdminRestApiController
    // Spec 0051: where the account service saves the other fields.
    let fieldSave: jest.Mock

    beforeEach(() => {
      fieldSave = jest.fn().mockResolvedValue(undefined)
      const account = accountServiceOverFakes(mockCourierDomainService, mockDeliveryEventService, fieldSave)
      controller = new CourierAdminRestApiController(
        mockCourierDomainService,
        mockDeliveryEventService,
        // The rider create and password routes (spec 0013) are not used by these tests.
        {} as CourierAdminRestApiService,
        account.service,
        account.prisma as any
      )
    })

    it('calls handleCourierStatusChanged when status is provided in update payload', async () => {
      const courierId = 'courier-admin-target'
      const input = { status: EnumCourierStatus.OFFLINE, firstName: 'Updated' }

      await controller.updateCourier(courierId, input as any, { id: 'admin-1' } as any)

      expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
        courierId,
        EnumCourierStatus.OFFLINE,
        EnumCourierStatusChangeCause.ADMIN,
        'admin-1'
      )
      expect(fieldSave).toHaveBeenCalledWith({ where: { id: courierId }, data: { firstName: 'Updated' } })
      expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
        courierId,
        EnumCourierStatus.OFFLINE
      )
    })

    it('does NOT call handleCourierStatusChanged when status is omitted from update payload', async () => {
      const courierId = 'courier-admin-target'
      const input = { firstName: 'OnlyNameChange' } // status is undefined

      await controller.updateCourier(courierId, input as any, { id: 'admin-1' } as any)

      expect(mockCourierDomainService.changeStatus).not.toHaveBeenCalled()
      expect(fieldSave).toHaveBeenCalledWith({ where: { id: courierId }, data: { firstName: 'OnlyNameChange' } })
      expect(mockDeliveryEventService.handleCourierStatusChanged).not.toHaveBeenCalled()
    })
  })
})
