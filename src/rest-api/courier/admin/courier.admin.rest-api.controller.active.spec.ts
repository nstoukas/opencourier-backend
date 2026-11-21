import { CourierAdminRestApiService } from 'src/rest-api/courier/admin/courier.admin.rest-api.service'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'
import { CourierAdminRestApiController } from './courier.admin.rest-api.controller'
import { CourierDomainService } from '../../../domains/courier/courier.domain.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { CourierEntity } from '../../../domains/courier/entities/courier.entity'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import {
  EnumCourierDeliverySetting,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumStripeAccountStatus,
  EnumUserRole,
} from '@prisma/types'
import { adminCourierListWhere } from './queries/courier-list-filter'
import { CourierFindManyAdminArgs } from './queries/courier-find-many.admin.args'
import { CourierCreateAdminInput } from './queries/courier-create.admin.input'
import { CourierRotatePasswordAdminInput } from './queries/courier-rotate-password.admin.input'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { CourierAdminDto } from './dtos/courier.admin.dto'
import { CourierAccountService } from 'src/services/courier-account/courier-account.service'
import {
  CourierAccountAdminDto,
  CourierAccountChangeAdminDto,
} from 'src/rest-api/courier-account/courier-account.dto'
import { EnumCourierAccountChangeKind } from '@prisma/types'
import * as errors from 'src/errors'

describe('CourierAdminRestApiController (scope row 97 & row 16 Spec 0013)', () => {
  let controller: CourierAdminRestApiController
  let mockCourierDomainService: jest.Mocked<CourierDomainService>
  let mockDeliveryEventService: jest.Mocked<DeliveryEventService>
  let mockCourierAdminRestApiService: jest.Mocked<CourierAdminRestApiService>
  // Spec 0051: the account actions live in CourierAccountService; the controller only passes them on.
  let mockCourierAccountService: {
    deactivate: jest.Mock
    reactivate: jest.Mock
    editByAdmin: jest.Mock
    history: jest.Mock
    recordPasswordChange: jest.Mock
  }
  let mockPrisma: { courier: { findUnique: jest.Mock } }

  // Shared courier entity fixture modelled on real courier row
  const mockCourier = new CourierEntity({
    id: 'courier-volos-1',
    node_uri: null,
    firstName: 'Giorgos',
    lastName: 'Papadopoulos',
    phoneNumber: '+306900000000',
    status: EnumCourierStatus.ONLINE,
    deliverySetting: EnumCourierDeliverySetting.AUTO_ACCEPT,
    rejectedOffers: [],
    stripeAccountId: null,
    stripeAccountStatus: EnumStripeAccountStatus.COMPLETE,
    userId: 'user-volos-1',
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-01T10:00:00Z'),
  })

  const mockPaginatedCouriers = {
    data: [mockCourier],
    pagination: {
      perPage: 15,
      totalItems: 1,
      totalPages: 1,
      currentItems: 1,
      currentPage: 2,
      prevPage: 1,
      nextPage: null,
    },
  }

  beforeEach(() => {
    mockCourierDomainService = {
      getManyCouriers: jest.fn().mockResolvedValue(mockPaginatedCouriers),
      getByIdOrThrow: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<CourierDomainService>

    mockDeliveryEventService = {
      handleCourierStatusChanged: jest.fn(),
    } as unknown as jest.Mocked<DeliveryEventService>

    mockCourierAdminRestApiService = {
      createCourier: jest.fn().mockResolvedValue(mockCourier),
      rotatePassword: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CourierAdminRestApiService>

    mockCourierAccountService = {
      deactivate: jest.fn().mockResolvedValue(mockCourier),
      reactivate: jest.fn().mockResolvedValue(mockCourier),
      editByAdmin: jest.fn().mockResolvedValue(mockCourier),
      history: jest.fn().mockResolvedValue([]),
      recordPasswordChange: jest.fn().mockResolvedValue(undefined),
    }
    mockPrisma = { courier: { findUnique: jest.fn() } }

    controller = new CourierAdminRestApiController(
      mockCourierDomainService,
      mockDeliveryEventService,
      mockCourierAdminRestApiService,
      mockCourierAccountService as unknown as CourierAccountService,
      mockPrisma as any
    )
  })

  describe('routing and security metadata (Spec 0013 AC-10)', () => {
    test('getManyCouriers handler carries @Roles(EnumUserRole.ADMIN)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.getManyCouriers)
      expect(roles).toEqual([EnumUserRole.ADMIN])
    })

    test('getManyCouriers is routed at PATH "/" with METHOD GET', () => {
      const path = Reflect.getMetadata(PATH_METADATA, controller.getManyCouriers)
      const method = Reflect.getMetadata(METHOD_METADATA, controller.getManyCouriers)
      expect(path).toBe('/')
      expect(method).toBe(RequestMethod.GET)
    })

    test('createCourier handler carries @Roles(EnumUserRole.ADMIN)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.createCourier)
      expect(roles).toEqual([EnumUserRole.ADMIN])
    })

    test('createCourier is routed at PATH "/" with METHOD POST', () => {
      const path = Reflect.getMetadata(PATH_METADATA, controller.createCourier)
      const method = Reflect.getMetadata(METHOD_METADATA, controller.createCourier)
      expect(path).toBe('/')
      expect(method).toBe(RequestMethod.POST)
    })

    test('rotateCourierPassword handler carries @Roles(EnumUserRole.ADMIN)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.rotateCourierPassword)
      expect(roles).toEqual([EnumUserRole.ADMIN])
    })

    test('rotateCourierPassword is routed at PATH ":id/rotate-password" with METHOD POST', () => {
      const path = Reflect.getMetadata(PATH_METADATA, controller.rotateCourierPassword)
      const method = Reflect.getMetadata(METHOD_METADATA, controller.rotateCourierPassword)
      expect(path).toBe(':id/rotate-password')
      expect(method).toBe(RequestMethod.POST)
    })
  })

  describe('createCourier (Spec 0013 AC-1)', () => {
    test('delegates to courierAdminRestApiService.createCourier and returns CourierAdminDto', async () => {
      const input: CourierCreateAdminInput = {
        firstName: 'Giorgos',
        lastName: 'Papadopoulos',
        phoneNumber: '+306900000000',
        email: 'giorgos@coop.gr',
        password: 'password123',
      }
      const admin = new UserEntity({
        id: 'admin-1',
        email: 'admin@coop.gr',
        password: 'hash',
        role: [EnumUserRole.ADMIN],
        username: null,
        apiKeyHash: null,
        apiKeyCreatedAt: null,
        credentialsChangedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await controller.createCourier(input, admin)

      expect(mockCourierAdminRestApiService.createCourier).toHaveBeenCalledWith(input, 'admin-1')
      expect(result).toBeInstanceOf(CourierAdminDto)
      expect(result.id).toBe(mockCourier.id)
      expect(result.firstName).toBe(mockCourier.firstName)
    })
  })

  describe('rotateCourierPassword (Spec 0013 AC-4)', () => {
    test('delegates to courierAdminRestApiService.rotatePassword with courier id, password and admin id', async () => {
      const input: CourierRotatePasswordAdminInput = {
        password: 'newPassword123',
      }
      const admin = new UserEntity({
        id: 'admin-2',
        email: 'admin2@coop.gr',
        password: 'hash',
        role: [EnumUserRole.ADMIN],
        username: null,
        apiKeyHash: null,
        apiKeyCreatedAt: null,
        credentialsChangedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      await controller.rotateCourierPassword('courier-volos-1', input, admin)

      expect(mockCourierAdminRestApiService.rotatePassword).toHaveBeenCalledWith(
        'courier-volos-1',
        'newPassword123',
        'admin-2'
      )
      // Spec 0051 (AC-5, cross check 10): the rider's record shows that the co-op set their password,
      // written only once the password was really changed, and never holding the password.
      expect(mockCourierAccountService.recordPasswordChange).toHaveBeenCalledTimes(1)
      expect(mockCourierAccountService.recordPasswordChange).toHaveBeenCalledWith('courier-volos-1', {
        adminUserId: 'admin-2',
      })
      expect(mockCourierAdminRestApiService.rotatePassword.mock.invocationCallOrder[0]).toBeLessThan(
        mockCourierAccountService.recordPasswordChange.mock.invocationCallOrder[0]!
      )
      expect(JSON.stringify(mockCourierAccountService.recordPasswordChange.mock.calls)).not.toContain('newPassword123')
    })

    test('records nothing when the password change itself failed (spec 0051, AC-5)', async () => {
      mockCourierAdminRestApiService.rotatePassword.mockRejectedValue(new Error('Courier not found'))
      const admin = { id: 'admin-2' } as UserEntity

      await expect(
        controller.rotateCourierPassword('no-such-rider', { password: 'newPassword123' }, admin)
      ).rejects.toThrow('Courier not found')
      expect(mockCourierAccountService.recordPasswordChange).not.toHaveBeenCalled()
    })
  })

  describe('getManyCouriers', () => {
    test('passes both status and search, plus page and perPage, to courierDomainService.getManyCouriers', async () => {
      const args: CourierFindManyAdminArgs = {
        status: 'working',
        search: 'Giorgos Pap',
        page: 2,
        perPage: 15,
      }

      const result = await controller.getManyCouriers(args)

      expect(mockCourierDomainService.getManyCouriers).toHaveBeenCalledTimes(1)
      expect(mockCourierDomainService.getManyCouriers).toHaveBeenCalledWith(
        adminCourierListWhere({
          status: 'working',
          search: 'Giorgos Pap',
        }),
        2,
        15
      )
      expect(result.data).toHaveLength(1)
      expect(result.data[0]?.id).toBe('courier-volos-1')
      expect(result.pagination?.currentPage).toBe(2)
    })

    test('Clause 3: fails if status is dropped in the controller on the way to getManyCouriers', async () => {
      // If controller forgets { status: args.status }, where.status is missing
      await controller.getManyCouriers({ status: 'working' })

      expect(mockCourierDomainService.getManyCouriers).toHaveBeenCalledTimes(1)
      const call = mockCourierDomainService.getManyCouriers.mock.calls[0]
      expect(call).toBeDefined()
      const calledWhere = call![0]
      expect(calledWhere).toHaveProperty('status')
      expect(calledWhere.status).toEqual({
        in: [EnumCourierStatus.ONLINE, EnumCourierStatus.LAST_CALL],
      })
    })

    test('Clause 3: fails if status offline is dropped in the controller on the way to getManyCouriers', async () => {
      await controller.getManyCouriers({ status: 'offline' })

      expect(mockCourierDomainService.getManyCouriers).toHaveBeenCalledTimes(1)
      const call = mockCourierDomainService.getManyCouriers.mock.calls[0]
      expect(call).toBeDefined()
      const calledWhere = call![0]
      expect(calledWhere).toHaveProperty('status')
      expect(calledWhere.status).toBe(EnumCourierStatus.OFFLINE)
    })

    test('Clause 3: fails if search is dropped in the controller on the way to getManyCouriers', async () => {
      // If controller forgets { search: args.search }, where.AND is missing
      await controller.getManyCouriers({ search: 'Giorgos' })

      expect(mockCourierDomainService.getManyCouriers).toHaveBeenCalledTimes(1)
      const call = mockCourierDomainService.getManyCouriers.mock.calls[0]
      expect(call).toBeDefined()
      const calledWhere = call![0]
      expect(calledWhere).toHaveProperty('AND')
      const andClauses = calledWhere.AND as any[]
      expect(andClauses).toHaveLength(1)
      // Spec 0025 (AC-2): the folded word, matched against the database's folded column.
      expect(andClauses[0]).toEqual({ searchFold: { contains: 'giorgos' } })
    })

    test('passes empty where when no filter args are provided', async () => {
      await controller.getManyCouriers({})

      expect(mockCourierDomainService.getManyCouriers).toHaveBeenCalledWith({}, undefined, undefined)
    })

    test('passes page and perPage when filter args are omitted', async () => {
      await controller.getManyCouriers({ page: 3, perPage: 25 })

      expect(mockCourierDomainService.getManyCouriers).toHaveBeenCalledWith({}, 3, 25)
    })
  })

  describe('updateCourier (AC-1, review minor; spec 0051 AC-4)', () => {
    const adminUser = new UserEntity({
      id: 'admin-user-1',
      username: 'admin',
      email: 'admin@coop.gr',
      password: 'hash',
      role: [EnumUserRole.ADMIN],
      apiKeyHash: null,
      apiKeyCreatedAt: null,
      credentialsChangedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Spec 0051: the edit itself is CourierAccountService.editByAdmin. These two tests keep what they
    // checked before (the status first, open offers ended, then the fields) by running the real service
    // under the controller, over a fake database.
    const controllerOverRealAccountService = (callOrder: string[], fieldSave: jest.Mock) => {
      const tx = { courier: { update: fieldSave }, user: { update: jest.fn() } }
      const prisma = {
        courier: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'courier-volos-1',
            firstName: 'Giorgos',
            lastName: 'Papadopoulos',
            phoneNumber: '+306900000000',
            status: EnumCourierStatus.ONLINE,
            deliverySetting: EnumCourierDeliverySetting.AUTO_ACCEPT,
            deactivatedAt: null,
            emergencyContactName: null,
            emergencyContactPhone: null,
            user: { id: 'user-volos-1', email: 'giorgos@coop.gr' },
          }),
        },
        $transaction: jest.fn().mockImplementation((work: (client: typeof tx) => unknown) => work(tx)),
      }
      mockCourierDomainService.changeStatus = jest.fn().mockImplementation(async () => {
        callOrder.push('changeStatus')
        return { changed: true, fromStatus: EnumCourierStatus.ONLINE }
      })
      mockCourierDomainService.getByIdOrThrow = jest.fn().mockResolvedValue(mockCourier)
      mockDeliveryEventService.handleCourierStatusChanged = jest.fn().mockImplementation(async () => {
        callOrder.push('handleCourierStatusChanged')
      })
      const accountService = new CourierAccountService(
        { record: jest.fn().mockResolvedValue(undefined) } as any, // accounts
        { findByPhoneNumber: jest.fn().mockResolvedValue(null) } as any, // courierRepository
        mockCourierDomainService,
        { findUserWithEmailIgnoringCase: jest.fn().mockResolvedValue(null) } as any, // userDomainService
        {} as any, // passwordService
        {} as any, // authDomainService
        {} as any, // courierCutOffService
        mockDeliveryEventService,
        {} as any, // courierDeviceRepository
        {} as any, // websocketDispatcher
        { delete: jest.fn() } as any, // cacheService
        { isConfigured: jest.fn().mockReturnValue(false) } as any, // mailService
        {} as any, // configDomainService
        prisma as any
      )
      return new CourierAdminRestApiController(
        mockCourierDomainService,
        mockDeliveryEventService,
        mockCourierAdminRestApiService,
        accountService,
        prisma as any
      )
    }

    test('calls handleCourierStatusChanged after changeStatus and before the fields are saved', async () => {
      const callOrder: string[] = []
      const fieldSave = jest.fn().mockImplementation(async () => {
        callOrder.push('update')
      })
      const realController = controllerOverRealAccountService(callOrder, fieldSave)

      await realController.updateCourier(
        'courier-volos-1',
        { status: EnumCourierStatus.OFFLINE, firstName: 'Nikos' } as any,
        adminUser
      )

      expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
        'courier-volos-1',
        EnumCourierStatus.OFFLINE,
        EnumCourierStatusChangeCause.ADMIN,
        'admin-user-1'
      )
      expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
        'courier-volos-1',
        EnumCourierStatus.OFFLINE
      )
      // The status never rides along with the other fields.
      expect(fieldSave).toHaveBeenCalledWith({ where: { id: 'courier-volos-1' }, data: { firstName: 'Nikos' } })
      expect(callOrder).toEqual(['changeStatus', 'handleCourierStatusChanged', 'update'])
    })

    test('when the field save throws, handleCourierStatusChanged has still been called', async () => {
      const callOrder: string[] = []
      const fieldSave = jest.fn().mockRejectedValue(new Error('Phone number already in use'))
      const realController = controllerOverRealAccountService(callOrder, fieldSave)

      await expect(
        realController.updateCourier(
          'courier-volos-1',
          { status: EnumCourierStatus.OFFLINE, phoneNumber: '+306911111111' } as any,
          adminUser
        )
      ).rejects.toThrow('Phone number already in use')

      expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
        'courier-volos-1',
        EnumCourierStatus.OFFLINE,
        EnumCourierStatusChangeCause.ADMIN,
        'admin-user-1'
      )
      expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
        'courier-volos-1',
        EnumCourierStatus.OFFLINE
      )
    })

    // Spec 0051 (AC-4, AC-5, decision 108.3): the global ValidationPipe strips nothing, so the body can
    // carry any key. The controller hands on only the fields an admin may edit.
    test('hands editByAdmin the rider id, the admin id and only the editable fields', async () => {
      const body = {
        firstName: 'Nikos',
        lastName: 'Sotiriou',
        phoneNumber: '+306911111111',
        deliverySetting: EnumCourierDeliverySetting.MANUAL,
        status: EnumCourierStatus.OFFLINE,
        email: 'nikos@coop.gr',
        emergencyContactName: 'Maria',
        emergencyContactPhone: '+306922222222',
      }

      const result = await controller.updateCourier('courier-volos-1', body as any, adminUser)

      expect(mockCourierAccountService.editByAdmin).toHaveBeenCalledTimes(1)
      expect(mockCourierAccountService.editByAdmin).toHaveBeenCalledWith('courier-volos-1', body, 'admin-user-1')
      expect(result).toBeInstanceOf(CourierAdminDto)
      // The old path, which saved the whole body, is gone.
      expect(mockCourierDomainService.update).not.toHaveBeenCalled()
    })

    test('a body carrying deactivatedAt, node_uri, the Stripe fields or any other column passes none of them on', async () => {
      await controller.updateCourier(
        'courier-volos-1',
        {
          firstName: 'Nikos',
          deactivatedAt: '2020-01-01T00:00:00.000Z',
          deactivatedByUserId: 'someone',
          node_uri: 'https://elsewhere.example/rider',
          stripeAccountId: 'acct_smuggled',
          stripeAccountStatus: EnumStripeAccountStatus.COMPLETE,
          userId: 'another-user',
          rejectedOffers: ['del-1'],
        } as any,
        adminUser
      )

      const passed = mockCourierAccountService.editByAdmin.mock.calls[0][1]
      const sent = Object.keys(passed).filter((key) => passed[key] !== undefined)
      expect(sent).toEqual(['firstName'])
      for (const key of [
        'deactivatedAt',
        'deactivatedByUserId',
        'node_uri',
        'stripeAccountId',
        'stripeAccountStatus',
        'userId',
        'rejectedOffers',
      ]) {
        expect(passed).not.toHaveProperty(key)
      }
      expect(mockCourierDomainService.update).not.toHaveBeenCalled()
    })

    test("the edit's refusal reaches the admin as it is", async () => {
      mockCourierAccountService.editByAdmin.mockRejectedValue(new errors.CourierEmailTakenException())

      await expect(
        controller.updateCourier('courier-volos-1', { email: 'taken@coop.gr' } as any, adminUser)
      ).rejects.toBeInstanceOf(errors.CourierEmailTakenException)
    })
  })

  // Spec 0051 (AC-1, AC-3, AC-5, AC-6): the account routes. Admins only.
  describe('rider account routes (spec 0051)', () => {
    const adminUser = { id: 'admin-user-1' } as UserEntity

    test.each([
      ['deactivate', ':id/deactivate', RequestMethod.POST],
      ['reactivate', ':id/reactivate', RequestMethod.POST],
      ['account', ':id/account', RequestMethod.GET],
      ['accountChanges', ':id/account-changes', RequestMethod.GET],
    ] as const)('%s is routed at "%s", for admins only', (handler, path, method) => {
      const fn = controller[handler]
      expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(path)
      expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(method)
      expect(Reflect.getMetadata(ROLES_KEY, fn)).toEqual([EnumUserRole.ADMIN])
    })

    test('updateCourier stays PATCH ":id", for admins only', () => {
      expect(Reflect.getMetadata(PATH_METADATA, controller.updateCourier)).toBe(':id')
      expect(Reflect.getMetadata(METHOD_METADATA, controller.updateCourier)).toBe(RequestMethod.PATCH)
      expect(Reflect.getMetadata(ROLES_KEY, controller.updateCourier)).toEqual([EnumUserRole.ADMIN])
    })

    test('deactivate passes the rider, the acting admin and the reason, and answers the rider with deactivatedAt', async () => {
      const deactivatedAt = new Date('2026-11-21T10:00:00Z')
      mockCourierAccountService.deactivate.mockResolvedValue(
        new CourierEntity({ ...mockCourier, status: EnumCourierStatus.OFFLINE, deactivatedAt })
      )

      const result = await controller.deactivate('courier-volos-1', { reason: 'Left the co-op' }, adminUser)

      expect(mockCourierAccountService.deactivate).toHaveBeenCalledWith('courier-volos-1', 'admin-user-1', 'Left the co-op')
      expect(result).toBeInstanceOf(CourierAdminDto)
      expect(result.deactivatedAt).toEqual(deactivatedAt)
      expect(result.status).toBe(EnumCourierStatus.OFFLINE)
    })

    test("deactivate's refusal (409 holds a job) reaches the admin as it is", async () => {
      const refusal = new Error('This rider holds a job. Move it first.')
      mockCourierAccountService.deactivate.mockRejectedValue(refusal)

      await expect(controller.deactivate('courier-volos-1', { reason: 'Left' }, adminUser)).rejects.toBe(refusal)
    })

    test('reactivate passes the rider, the acting admin and the reason; no reason is passed as null', async () => {
      const result = await controller.reactivate('courier-volos-1', { reason: 'Came back' }, adminUser)
      expect(mockCourierAccountService.reactivate).toHaveBeenLastCalledWith('courier-volos-1', 'admin-user-1', 'Came back')
      expect(result).toBeInstanceOf(CourierAdminDto)
      expect(result.deactivatedAt).toBeNull()

      await controller.reactivate('courier-volos-1', {}, adminUser)
      expect(mockCourierAccountService.reactivate).toHaveBeenLastCalledWith('courier-volos-1', 'admin-user-1', null)

      await controller.reactivate('courier-volos-1', { reason: '' }, adminUser)
      expect(mockCourierAccountService.reactivate).toHaveBeenLastCalledWith('courier-volos-1', 'admin-user-1', null)
    })

    test('account answers the login email, the deactivation and the emergency contact of this rider (AC-6, cross check 12)', async () => {
      const deactivatedAt = new Date('2026-11-21T10:00:00Z')
      mockPrisma.courier.findUnique.mockResolvedValue({
        deactivatedAt,
        emergencyContactName: 'Maria Rider',
        emergencyContactPhone: '+306922222222',
        user: { email: 'giorgos@coop.gr' },
      })

      const result = await controller.account('courier-volos-1')

      expect(mockPrisma.courier.findUnique.mock.calls[0][0].where).toEqual({ id: 'courier-volos-1' })
      expect(result).toBeInstanceOf(CourierAccountAdminDto)
      expect({ ...result }).toEqual({
        email: 'giorgos@coop.gr',
        deactivatedAt,
        emergencyContactName: 'Maria Rider',
        emergencyContactPhone: '+306922222222',
      })
    })

    test('account answers 404 for an unknown rider', async () => {
      mockPrisma.courier.findUnique.mockResolvedValue(null)
      await expect(controller.account('no-such-rider')).rejects.toBeInstanceOf(errors.NotFoundException)
    })

    test("accountChanges answers this rider's record in the order given, with the acting admin's email (AC-6)", async () => {
      const base = {
        courierId: 'courier-volos-1',
        field: null,
        oldValue: null,
        newValue: null,
        reason: null,
      }
      mockCourierAccountService.history.mockResolvedValue([
        {
          ...base,
          id: 'change-2',
          kind: EnumCourierAccountChangeKind.DEACTIVATED,
          reason: 'Left the co-op',
          actorUserId: 'admin-user-1',
          actorIsRider: false,
          actorEmail: 'admin@coop.gr',
          createdAt: new Date('2026-11-21T10:00:00Z'),
        },
        {
          ...base,
          id: 'change-1',
          kind: EnumCourierAccountChangeKind.PASSWORD_CHANGED,
          actorUserId: null,
          actorIsRider: true,
          actorEmail: null,
          createdAt: new Date('2026-11-20T10:00:00Z'),
        },
      ])

      const result = await controller.accountChanges('courier-volos-1')

      expect(mockCourierAccountService.history).toHaveBeenCalledWith('courier-volos-1')
      expect(result.map((change) => change.id)).toEqual(['change-2', 'change-1'])
      expect(result[0]).toBeInstanceOf(CourierAccountChangeAdminDto)
      expect(result[0]).toMatchObject({
        kind: EnumCourierAccountChangeKind.DEACTIVATED,
        reason: 'Left the co-op',
        actorIsRider: false,
        actorEmail: 'admin@coop.gr',
      })
      expect(result[1]).toMatchObject({ actorIsRider: true, actorEmail: null })
    })
  })

  describe('CourierAdminDto (spec 0051, AC-6)', () => {
    test('carries deactivatedAt: null for an active rider, the moment for a deactivated one', () => {
      expect(new CourierAdminDto(mockCourier).deactivatedAt).toBeNull()
      const deactivatedAt = new Date('2026-11-21T10:00:00Z')
      expect(new CourierAdminDto(new CourierEntity({ ...mockCourier, deactivatedAt })).deactivatedAt).toEqual(deactivatedAt)
    })

    test('the list answers each rider with deactivatedAt, so the page can label them', async () => {
      const deactivatedAt = new Date('2026-11-21T10:00:00Z')
      mockCourierDomainService.getManyCouriers.mockResolvedValue({
        ...mockPaginatedCouriers,
        data: [mockCourier, new CourierEntity({ ...mockCourier, id: 'courier-volos-2', deactivatedAt })],
      } as any)

      const result = await controller.getManyCouriers({})

      expect(result.data.map((courier) => courier.deactivatedAt)).toEqual([null, deactivatedAt])
    })

    test('the Deactivated tab reaches the list query (cross check 14)', async () => {
      await controller.getManyCouriers({ status: 'deactivated' })

      expect(mockCourierDomainService.getManyCouriers).toHaveBeenCalledWith(
        { deactivatedAt: { not: null } },
        undefined,
        undefined
      )
    })

    test('never carries the emergency contact or the deactivating admin (never in the list)', () => {
      const dto = new CourierAdminDto(
        Object.assign(new CourierEntity({ ...mockCourier, deactivatedAt: new Date() }), {
          emergencyContactName: 'Maria Rider',
          emergencyContactPhone: '+306922222222',
          deactivatedByUserId: 'admin-user-1',
        })
      )
      const sent = JSON.stringify(dto)
      expect(sent).not.toContain('Maria Rider')
      expect(sent).not.toContain('+306922222222')
      expect(sent).not.toContain('admin-user-1')
    })
  })
})
