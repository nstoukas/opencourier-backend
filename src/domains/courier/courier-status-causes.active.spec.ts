import { Logger } from '@nestjs/common'
import {
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumUserRole,
} from '@prisma/types'
import { CourierCourierRestApiController } from 'src/rest-api/courier/courier/courier.courier.rest-api.controller'
import { CourierAdminRestApiController } from 'src/rest-api/courier/admin/courier.admin.rest-api.controller'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { CourierCutOffService } from 'src/services/courier-cut-off/courier-cut-off.service'
import { CourierAdminRestApiService } from 'src/rest-api/courier/admin/courier.admin.rest-api.service'
import { PasswordResetCourierRestApiService } from 'src/rest-api/auth/courier/password-reset.courier.rest-api.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { UserEntity } from 'src/domains/user/entities/user.entity'

describe('Courier Status Change Causes (spec 0040, AC-1)', () => {
  let mockCourierDomainService: {
    changeStatus: jest.Mock
    update: jest.Mock
  }
  let mockDeliveryEventService: {
    handleCourierStatusChanged: jest.Mock
  }

  beforeEach(() => {
    mockCourierDomainService = {
      changeStatus: jest.fn().mockResolvedValue({ changed: true, fromStatus: EnumCourierStatus.OFFLINE }),
      update: jest.fn().mockResolvedValue(new CourierEntity({ id: 'courier-1' } as any)),
    }
    mockDeliveryEventService = {
      handleCourierStatusChanged: jest.fn().mockResolvedValue(undefined),
    }
  })

  test("the rider's PATCH courier/status calls changeStatus with RIDER", async () => {
    const controller = new CourierCourierRestApiController(
      mockCourierDomainService as unknown as CourierDomainService,
      mockDeliveryEventService as unknown as DeliveryEventService
    )

    const courier = new CourierEntity({ id: 'rider-1' } as any)
    await controller.updateStatus({ status: EnumCourierStatus.ONLINE }, courier)

    expect(mockCourierDomainService.changeStatus).toHaveBeenCalledTimes(1)
    expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
      'rider-1',
      EnumCourierStatus.ONLINE,
      EnumCourierStatusChangeCause.RIDER
    )
  })

  test("the admin's PATCH courier/:id calls changeStatus with ADMIN and admin id before saving other fields, and never passes status to update", async () => {
    const callOrder: string[] = []
    mockCourierDomainService.changeStatus.mockImplementation(async () => {
      callOrder.push('changeStatus')
      return { changed: true, fromStatus: EnumCourierStatus.ONLINE }
    })
    mockCourierDomainService.update.mockImplementation(async () => {
      callOrder.push('update')
      return new CourierEntity({ id: 'rider-2' } as any)
    })

    const controller = new CourierAdminRestApiController(
      mockCourierDomainService as unknown as CourierDomainService,
      mockDeliveryEventService as unknown as DeliveryEventService,
      {} as any
    )

    const adminUser = new UserEntity({ id: 'admin-user-77', role: [EnumUserRole.ADMIN] } as any)
    const updateInput = {
      status: EnumCourierStatus.OFFLINE,
      firstName: 'UpdatedFirstName',
    }

    await controller.updateCourier('rider-2', updateInput as any, adminUser)

    expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
      'rider-2',
      EnumCourierStatus.OFFLINE,
      EnumCourierStatusChangeCause.ADMIN,
      'admin-user-77'
    )

    // Verify changeStatus is called BEFORE update
    expect(callOrder).toEqual(['changeStatus', 'update'])

    // Verify update never receives a status key
    expect(mockCourierDomainService.update).toHaveBeenCalledWith('rider-2', { firstName: 'UpdatedFirstName' })
    const passedFields = mockCourierDomainService.update.mock.calls[0]?.[1]
    expect('status' in passedFields).toBe(false)
  })

  test('cutOff passes CUT_OFF with the admin id it is given', async () => {
    const mockWebsocketDispatcher = {
      disconnectUser: jest.fn().mockResolvedValue(undefined),
    }
    const mockCourierDeviceRepository = {
      deleteAllForCourier: jest.fn().mockResolvedValue(undefined),
    }

    const cutOffService = new CourierCutOffService(
      mockWebsocketDispatcher as any,
      mockCourierDeviceRepository as any,
      mockCourierDomainService as unknown as CourierDomainService,
      mockDeliveryEventService as unknown as DeliveryEventService
    )

    const courier = new CourierEntity({ id: 'rider-3', userId: 'user-3' } as any)
    await cutOffService.cutOff(courier, 'admin-user-88')

    expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
      'rider-3',
      EnumCourierStatus.OFFLINE,
      EnumCourierStatusChangeCause.CUT_OFF,
      'admin-user-88'
    )
  })

  test('rotatePassword passes its adminUserId to cutOff', async () => {
    const mockUserDomainService = {
      findById: jest.fn().mockResolvedValue({ id: 'user-4', email: 'rider@example.com', role: [EnumUserRole.COURIER] }),
      update: jest.fn().mockResolvedValue({}),
    }
    const mockPasswordService = {
      hash: jest.fn().mockResolvedValue('hashed-pass'),
    }
    const mockCourierRepository = {
      findById: jest.fn().mockResolvedValue(new CourierEntity({ id: 'courier-4', userId: 'user-4' } as any)),
    }
    const mockCutOffService = {
      cutOff: jest.fn().mockResolvedValue(undefined),
    }

    const adminApiService = new CourierAdminRestApiService(
      mockUserDomainService as any,
      mockPasswordService as any,
      mockCourierRepository as any,
      mockCutOffService as any
    )

    await adminApiService.rotatePassword('courier-4', 'new-secure-pass', 'admin-user-99')

    expect(mockCutOffService.cutOff).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'courier-4' }),
      'admin-user-99'
    )
  })

  test('the email reset calls cutOff with no admin', async () => {
    const mockUser = { id: 'user-5', email: 'rider5@example.com', role: [EnumUserRole.COURIER] }
    const mockSession = { accessToken: 'access-tok', refreshToken: 'refresh-tok', tokenType: 'Bearer', expiresIn: 3600 }
    const mockPasswordResetService = {
      claimCode: jest.fn().mockResolvedValue({
        user: mockUser,
        courier: new CourierEntity({ id: 'courier-5', userId: 'user-5' } as any),
      }),
    }
    const mockPasswordService = {
      hash: jest.fn().mockResolvedValue('hashed-new-pass'),
    }
    const mockUserDomainService = {
      update: jest.fn().mockResolvedValue({}),
    }
    const mockAuthDomainService = {
      createSessionForUser: jest.fn().mockResolvedValue({
        user: mockUser,
        session: mockSession,
      }),
    }
    const mockCutOffService = {
      cutOff: jest.fn().mockResolvedValue(undefined),
    }

    const resetService = new PasswordResetCourierRestApiService(
      mockPasswordResetService as any,
      mockPasswordService as any,
      mockUserDomainService as any,
      mockAuthDomainService as any,
      mockCutOffService as any
    )

    await resetService.resetPassword('rider5@example.com', '123456', 'BrandNewPassword123!')

    expect(mockCutOffService.cutOff).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'courier-5' })
    )
    // adminUserId is not passed (undefined)
    expect(mockCutOffService.cutOff.mock.calls[0]?.[1]).toBeUndefined()
  })

  test("a Last Call rider's accept calls changeStatus(..., OFFLINE, LAST_CALL_ACCEPTED), and when that throws the accept still stands and the error is logged", async () => {
    const mockCourierRepo = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'courier-last-call',
        status: EnumCourierStatus.LAST_CALL,
      }),
      changeStatus: jest.fn().mockRejectedValue(new Error('Simulated DB deadlock in changeStatus')),
    }
    const mockDeliveryRepo = {
      findByIdOrThrow: jest.fn()
        .mockResolvedValueOnce({
          id: 'del-lc-1',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
        })
        .mockResolvedValue({
          id: 'del-lc-1',
          status: EnumDeliveryStatus.ACCEPTED,
          courierId: 'courier-last-call',
        }),
      updateIfMatches: jest.fn().mockResolvedValue(true),
    }
    const mockDeliveryEventRepo = {
      create: jest.fn().mockResolvedValue({ id: 'ev-accepted-1' }),
    }
    const mockConfigDomainService = {
      instanceConfig: {
        getHandBackSeconds: jest.fn().mockResolvedValue(60),
      },
    }
    const mockTaskBusService = {
      registerTaskHandler: jest.fn(),
    }

    const deliveryEventService = new DeliveryEventService(
      {} as any, // configService
      {} as any, // websocketDispatcher
      mockCourierRepo as any, // courierRepository
      mockDeliveryRepo as any, // deliveryRepository
      mockDeliveryEventRepo as any, // deliveryEventRepository
      {} as any, // taskScheduler
      mockTaskBusService as any, // taskBusService
      {} as any, // partnerWebhookService
      {} as any, // deliveryMatchingService
      {} as any, // deliveryCalculationService
      {} as any, // bullMQService
      mockConfigDomainService as any, // configDomainService
      {} as any, // cacheService
      {} as any, // offerPushService
      {} as any, // dispatchStopRepository
      {} as any, // osrmRoutingService
      {} as any, // courierCompensationRepository
      {} as any, // partnerChargeRepository
      {} as any  // removalRequestRepository
    )

    const loggerErrorSpy = jest.spyOn((deliveryEventService as any).logger as Logger, 'error').mockImplementation(() => {})
    // Spy on endOpenOffersForCourier so it doesn't fail on unmocked calls
    jest.spyOn(deliveryEventService as any, 'endOpenOffersForCourier').mockResolvedValue(undefined)

    const acceptEvent = {
      deliveryId: 'del-lc-1',
      type: EnumDeliveryEventType.ACCEPTED,
      courierId: 'courier-last-call',
      actor: 'courier-last-call',
    }

    // Must resolve successfully even though changeStatus threw!
    await expect(deliveryEventService.processDeliveryEvent(acceptEvent as any)).resolves.not.toThrow()

    // changeStatus was called with LAST_CALL_ACCEPTED
    expect(mockCourierRepo.changeStatus).toHaveBeenCalledWith(
      'courier-last-call',
      EnumCourierStatus.OFFLINE,
      EnumCourierStatusChangeCause.LAST_CALL_ACCEPTED
    )

    // The error was caught and logged
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not set courier courier-last-call Offline after their Last Call accept: Error: Simulated DB deadlock in changeStatus')
    )

    loggerErrorSpy.mockRestore()
  })
})
