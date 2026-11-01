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
  EnumStripeAccountStatus,
  EnumUserRole,
} from '@prisma/types'
import { adminCourierListWhere } from './queries/courier-list-filter'
import { CourierFindManyAdminArgs } from './queries/courier-find-many.admin.args'

describe('CourierAdminRestApiController (scope row 97, Clause 3)', () => {
  let controller: CourierAdminRestApiController
  let mockCourierDomainService: jest.Mocked<CourierDomainService>
  let mockDeliveryEventService: jest.Mocked<DeliveryEventService>

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

    controller = new CourierAdminRestApiController(
      mockCourierDomainService,
      mockDeliveryEventService,
      // The rider create and password routes (spec 0013) are not used by these tests.
      {} as CourierAdminRestApiService
    )
  })

  describe('routing and security metadata', () => {
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
      expect(andClauses[0].OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            firstName: { contains: 'Giorgos', mode: 'insensitive' },
          }),
        ])
      )
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
})
