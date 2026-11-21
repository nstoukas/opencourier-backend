import { CourierCourierRestApiController } from './courier.courier.rest-api.controller'
import { CourierDomainService } from '../../../domains/courier/courier.domain.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { PATH_METADATA } from '@nestjs/common/constants'
import { EnumCourierDeliverySetting, EnumCourierStatus, EnumCourierStatusChangeCause, EnumUserRole } from '@prisma/types'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { METHOD_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'
import { EnumCourierAccountChangeKind } from '@prisma/types'
import { CourierAccountService } from 'src/services/courier-account/courier-account.service'
import {
  CourierAccountChangeCourierDto,
  EmergencyContactCourierDto,
} from 'src/rest-api/courier-account/courier-account.dto'

describe('CourierCourierRestApiController', () => {
  let controller: CourierCourierRestApiController
  let mockCourierDomainService: jest.Mocked<CourierDomainService>
  let mockDeliveryEventService: jest.Mocked<DeliveryEventService>

  const mockCourier = {
    id: 'courier-777',
    firstName: 'Nikos',
    lastName: 'Papastamou',
  } as CourierEntity

  beforeEach(() => {
    mockCourierDomainService = {
      updateCurrentLocation: jest.fn().mockResolvedValue(undefined),
      changeStatus: jest.fn().mockResolvedValue({ changed: true, fromStatus: EnumCourierStatus.OFFLINE }),
      updateDeliverySetting: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CourierDomainService>

    mockDeliveryEventService = {
      handleCourierStatusChanged: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeliveryEventService>

    controller = new CourierCourierRestApiController(mockCourierDomainService, mockDeliveryEventService)
  })

  describe('updateCurrentLocation', () => {
    test('calls courierDomainService.updateCurrentLocation with courier id and coordinates', async () => {
      await controller.updateCurrentLocation({ latitude: 39.36, longitude: 22.94 }, mockCourier)

      expect(mockCourierDomainService.updateCurrentLocation).toHaveBeenCalledWith('courier-777', {
        latitude: 39.36,
        longitude: 22.94,
      })
    })
  })

  describe('updateStatus', () => {
    test('changes status with cause RIDER and triggers handleCourierStatusChanged', async () => {
      await controller.updateStatus({ status: EnumCourierStatus.ONLINE }, mockCourier)

      expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
        'courier-777',
        EnumCourierStatus.ONLINE,
        EnumCourierStatusChangeCause.RIDER
      )
      expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
        'courier-777',
        EnumCourierStatus.ONLINE
      )
    })
  })

  describe('updateDeliverySetting', () => {
    test('calls courierDomainService.updateDeliverySetting with setting', async () => {
      await controller.updateDeliverySetting(
        { deliverySetting: EnumCourierDeliverySetting.AUTO_ACCEPT },
        mockCourier
      )

      expect(mockCourierDomainService.updateDeliverySetting).toHaveBeenCalledWith(
        'courier-777',
        EnumCourierDeliverySetting.AUTO_ACCEPT
      )
    })
  })

  describe('Route metadata and deleted routes (AC-6, AC-17)', () => {
    test('has location, status and delivery-setting routes with @Roles(COURIER)', () => {
      const proto = CourierCourierRestApiController.prototype

      expect(Reflect.getMetadata(ROLES_KEY, proto.updateCurrentLocation)).toEqual([EnumUserRole.COURIER])
      expect(Reflect.getMetadata(ROLES_KEY, proto.updateStatus)).toEqual([EnumUserRole.COURIER])
      expect(Reflect.getMetadata(ROLES_KEY, proto.updateDeliverySetting)).toEqual([EnumUserRole.COURIER])

      expect(Reflect.getMetadata('path', proto.updateCurrentLocation)).toBe('location')
      expect(Reflect.getMetadata('path', proto.updateStatus)).toBe('status')
      expect(Reflect.getMetadata('path', proto.updateDeliverySetting)).toBe('delivery-setting')
    })

    test('old earnings routes no longer exist on CourierCourierRestApiController (PATH metadata check)', () => {
      const proto = CourierCourierRestApiController.prototype as any
      expect(proto.getMyEarningsSummary).toBeUndefined()
      expect(proto.getMyEarningsDay).toBeUndefined()
      expect(proto.getMyEarningsDeliveryDetail).toBeUndefined()

      // Read the descriptor, not the property: a getter on the prototype (spec 0051's `accounts`) throws
      // when it is read without an instance.
      const methodNames = Object.getOwnPropertyNames(proto).filter(
        (m) => m !== 'constructor' && typeof Object.getOwnPropertyDescriptor(proto, m)?.value === 'function'
      )
      for (const name of methodNames) {
        const handler = proto[name]
        const path = Reflect.getMetadata(PATH_METADATA, handler)
        const paths = Array.isArray(path) ? path : [path]
        expect(paths).not.toContain('earnings-summary')
        expect(paths).not.toContain('earnings/day')
        expect(paths).not.toContain('earnings/delivery/:deliveryId')
      }
    })
  })

  // Spec 0051 (AC-7, cross checks 10 and 12): the rider's own account record and emergency contact.
  describe('rider account routes (spec 0051)', () => {
    let accounts: { history: jest.Mock; emergencyContactOf: jest.Mock; setOwnEmergencyContact: jest.Mock }
    let accountController: CourierCourierRestApiController

    beforeEach(() => {
      accounts = {
        history: jest.fn().mockResolvedValue([]),
        emergencyContactOf: jest.fn().mockResolvedValue({ name: 'Maria Rider', phone: '+306922222222' }),
        setOwnEmergencyContact: jest.fn().mockResolvedValue(undefined),
      }
      accountController = new CourierCourierRestApiController(
        mockCourierDomainService,
        mockDeliveryEventService,
        accounts as unknown as CourierAccountService
      )
    })

    test.each([
      ['accountChanges', 'account-changes', RequestMethod.GET],
      ['emergencyContact', 'emergency-contact', RequestMethod.GET],
      ['setEmergencyContact', 'emergency-contact', RequestMethod.PUT],
    ] as const)('%s is routed at "%s", for riders only', (handler, path, method) => {
      const fn = CourierCourierRestApiController.prototype[handler]
      expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(path)
      expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(method)
      expect(Reflect.getMetadata(ROLES_KEY, fn)).toEqual([EnumUserRole.COURIER])
    })

    test("accountChanges reads only the signed in rider's record, and shows the actor as \"the co-op\" or \"you\", never an admin", async () => {
      const row = {
        courierId: 'courier-777',
        field: null,
        oldValue: null,
        newValue: null,
        reason: null,
        createdAt: new Date('2026-11-21T10:00:00Z'),
      }
      accounts.history.mockResolvedValue([
        {
          ...row,
          id: 'change-3',
          kind: EnumCourierAccountChangeKind.FIELD_EDITED,
          field: 'email',
          oldValue: 'old@coop.gr',
          newValue: 'new@coop.gr',
          actorUserId: 'admin-user-1',
          actorIsRider: false,
          actorEmail: 'anna.admin@coop.gr',
        },
        {
          ...row,
          id: 'change-2',
          kind: EnumCourierAccountChangeKind.PASSWORD_CHANGED,
          actorUserId: null,
          actorIsRider: true,
          actorEmail: null,
        },
        {
          ...row,
          id: 'change-1',
          kind: EnumCourierAccountChangeKind.DEACTIVATED,
          reason: 'Left the co-op',
          actorUserId: 'admin-user-2',
          actorIsRider: false,
          actorEmail: 'babis.admin@coop.gr',
        },
      ])

      const result = await accountController.accountChanges(mockCourier)

      expect(accounts.history).toHaveBeenCalledTimes(1)
      expect(accounts.history).toHaveBeenCalledWith('courier-777')
      expect(result.map((change) => change.id)).toEqual(['change-3', 'change-2', 'change-1'])
      for (const change of result) expect(change).toBeInstanceOf(CourierAccountChangeCourierDto)
      expect(result.map((change) => change.by)).toEqual(['the co-op', 'you', 'the co-op'])
      expect(result[0]).toMatchObject({ field: 'email', oldValue: 'old@coop.gr', newValue: 'new@coop.gr' })
      expect(result[2]).toMatchObject({ kind: EnumCourierAccountChangeKind.DEACTIVATED, reason: 'Left the co-op' })
      const sent = JSON.stringify(result)
      expect(sent).not.toContain('anna.admin@coop.gr')
      expect(sent).not.toContain('babis.admin@coop.gr')
      expect(sent).not.toContain('admin-user-1')
      expect(sent).not.toContain('admin-user-2')
      expect(sent).not.toContain('actorEmail')
    })

    test("emergencyContact answers the signed in rider's name and phone from the server", async () => {
      const result = await accountController.emergencyContact(mockCourier)

      expect(accounts.emergencyContactOf).toHaveBeenCalledWith('courier-777')
      expect(result).toBeInstanceOf(EmergencyContactCourierDto)
      expect({ ...result }).toEqual({ name: 'Maria Rider', phone: '+306922222222' })
    })

    test("setEmergencyContact saves name and phone for the signed in rider, then answers what is stored", async () => {
      accounts.emergencyContactOf.mockResolvedValue({ name: 'Eleni Rider', phone: '+306933333333' })

      const result = await accountController.setEmergencyContact(mockCourier, {
        name: 'Eleni Rider',
        phone: '+306933333333',
      })

      expect(accounts.setOwnEmergencyContact).toHaveBeenCalledWith('courier-777', 'Eleni Rider', '+306933333333')
      expect(accounts.setOwnEmergencyContact.mock.invocationCallOrder[0]).toBeLessThan(
        accounts.emergencyContactOf.mock.invocationCallOrder[0]!
      )
      expect({ ...result }).toEqual({ name: 'Eleni Rider', phone: '+306933333333' })
    })

    test('setEmergencyContact with a part left out clears it (saved as null)', async () => {
      await accountController.setEmergencyContact(mockCourier, {} as any)
      expect(accounts.setOwnEmergencyContact).toHaveBeenCalledWith('courier-777', null, null)
    })
  })
})
