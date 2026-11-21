import { ExecutionContext, RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from 'src/constants'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { EnumJobEndLabel } from 'src/domains/time-worked/worked-shifts'
import { CourierCourierRestApiController } from 'src/rest-api/courier/courier/courier.courier.rest-api.controller'
import { DeliveryCourierRestApiController } from 'src/rest-api/delivery/courier/delivery.courier.rest-api.controller'
import { TimeWorkedCourierRestApiController } from './time-worked.courier.rest-api.controller'
import { EarningsCourierRestApiController } from './earnings.courier.rest-api.controller'
import { TimeWorkedService } from 'src/services/time-worked/time-worked.service'

describe('EarningsCourierRestApiController (spec 0042 AC-6, AC-17)', () => {
  let controller: EarningsCourierRestApiController
  let mockTimeWorkedService: jest.Mocked<TimeWorkedService>

  const fakeCourier = new CourierEntity({
    id: 'courier-session-123',
    firstName: 'Kostas',
    lastName: 'Rider',
    userId: 'user-1',
  } as any)

  beforeEach(() => {
    mockTimeWorkedService = {
      riderMonth: jest.fn(),
      deliveryDetail: jest.fn(),
    } as unknown as jest.Mocked<TimeWorkedService>

    controller = new EarningsCourierRestApiController(mockTimeWorkedService)
  })

  describe('Route metadata and roles (AC-17)', () => {
    test('controller is mounted at courier/v1/earnings', () => {
      const path = Reflect.getMetadata(PATH_METADATA, EarningsCourierRestApiController)
      expect(path).toBe(`${COURIER_API_V1_PREFIX}/earnings`)
    })

    test('month route is GET "", @Roles(COURIER), and takes no rider id', () => {
      const proto = EarningsCourierRestApiController.prototype
      const method = Reflect.getMetadata(METHOD_METADATA, proto.month)
      const path = Reflect.getMetadata(PATH_METADATA, proto.month)
      const roles = Reflect.getMetadata(ROLES_KEY, proto.month)

      expect(method).toBe(RequestMethod.GET)
      expect(path).toBe('/')
      expect(roles).toEqual([EnumUserRole.COURIER])
    })

    test('delivery route is GET "deliveries/:deliveryId", @Roles(COURIER), and takes no rider id', () => {
      const proto = EarningsCourierRestApiController.prototype
      const method = Reflect.getMetadata(METHOD_METADATA, proto.delivery)
      const path = Reflect.getMetadata(PATH_METADATA, proto.delivery)
      const roles = Reflect.getMetadata(ROLES_KEY, proto.delivery)

      expect(method).toBe(RequestMethod.GET)
      expect(path).toBe('deliveries/:deliveryId')
      expect(roles).toEqual([EnumUserRole.COURIER])
    })

    test('both routes take courier from @CurrentUserCourier and never from path, body or query', () => {
      const checkCurrentUserParam = (methodName: 'month' | 'delivery', expectedParamIndex: number) => {
        const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, EarningsCourierRestApiController, methodName) as Record<
          string,
          { index: number; factory?: (data: unknown, ctx: ExecutionContext) => unknown }
        >
        const custom = Object.entries(args).find(
          ([key, arg]) => key.includes('__customRouteArgs__') && arg.index === expectedParamIndex
        )
        expect(custom).toBeDefined()

        const currentCourier = { id: 'courier-from-auth' }
        const ctx = {
          getType: () => 'http',
          switchToHttp: () => ({
            getRequest: () => ({ currentCourier, currentUser: { id: 'u1' }, body: { courierId: 'forged' } }),
          }),
        } as unknown as ExecutionContext

        expect(custom![1].factory!(undefined, ctx)).toBe(currentCourier)
      }

      // In month(args, courier): args is param 0, courier is param 1
      checkCurrentUserParam('month', 1)
      // In delivery(deliveryId, courier): deliveryId is param 0, courier is param 1
      checkCurrentUserParam('delivery', 1)
    })
  })

  describe('Route handlers delegate to TimeWorkedService with session courier (AC-17)', () => {
    test('month delegates to timeWorkedService.riderMonth with courier.id and args.month', async () => {
      mockTimeWorkedService.riderMonth.mockResolvedValue({
        from: '2026-11-01',
        to: '2026-11-20',
        month: '2026-11',
        reachFrom: '2026-09-20',
        recordedFrom: null,
        currencyCode: 'EUR',
        days: [],
        weeks: [],
        shifts: [],
        jobsInNoShift: [],
      })

      const result = await controller.month({ month: '2026-11' }, fakeCourier)

      expect(mockTimeWorkedService.riderMonth).toHaveBeenCalledWith('courier-session-123', '2026-11')
      expect(result.month).toBe('2026-11')
      expect(result.reachFrom).toBe('2026-09-20')
      expect(result.from).toBe('2026-11-01')
      expect(result.to).toBe('2026-11-20')
    })

    test('delivery delegates to timeWorkedService.deliveryDetail with courier.id and deliveryId', async () => {
      mockTimeWorkedService.deliveryDetail.mockResolvedValue({
        whyYou: null,
        deliveryId: 'del-999',
        pickupName: 'Souvlaki Bar',
        dropoffArea: 'Downtown',
        currencyCode: 'EUR',
        paidKm: 3.5,
        jobs: [
          {
            acceptedAt: new Date('2026-11-20T10:00:00Z'),
            endedAt: new Date('2026-11-20T10:30:00Z'),
            endLabel: null,
            minutes: 30,
            pickupWaitSeconds: 120,
          },
        ],
        breakdown: {
          deliveryPayCents: 500,
          baseFeeCents: 200,
          distanceFeeCents: 300,
          tipsCents: 50,
          compensations: [],
          totalCents: 550,
        },
        timeline: [],
      })

      const result = await controller.delivery('del-999', fakeCourier)

      expect(mockTimeWorkedService.deliveryDetail).toHaveBeenCalledWith('courier-session-123', 'del-999')
      expect(result.deliveryId).toBe('del-999')
      expect(result.pickupName).toBe('Souvlaki Bar')
      expect(result.breakdown.totalCents).toBe(550)
      expect(result.jobs).toHaveLength(1)
    })
  })

  describe('Verification that the five old routes no longer exist (AC-6, AC-17)', () => {
    test('courier controller has no earnings routes (PATH metadata check: earnings-summary, earnings/day, earnings/delivery/:deliveryId)', () => {
      const courierProto = CourierCourierRestApiController.prototype as any

      expect(courierProto.getMyEarningsSummary).toBeUndefined()
      expect(courierProto.getMyEarningsForDay).toBeUndefined()
      expect(courierProto.getMyEarningsForDelivery).toBeUndefined()

      // Reads the route PATH metadata for every handler on the prototype
      // Read the descriptor, not the property: a getter on the prototype (spec 0051's `accounts`) throws
      // when it is read without an instance.
      const methodNames = Object.getOwnPropertyNames(courierProto).filter(
        (m) => m !== 'constructor' && typeof Object.getOwnPropertyDescriptor(courierProto, m)?.value === 'function'
      )
      for (const name of methodNames) {
        const handler = courierProto[name]
        const path = Reflect.getMetadata(PATH_METADATA, handler)
        const paths = Array.isArray(path) ? path : [path]
        expect(paths).not.toContain('earnings-summary')
        expect(paths).not.toContain('earnings/day')
        expect(paths).not.toContain('earnings/delivery/:deliveryId')
        for (const p of paths) {
          if (typeof p === 'string') {
            expect(p).not.toContain('earnings')
          }
        }
      }
    })

    test('delivery courier controller has no getMyDoneDeliveries / done route (PATH metadata check: done)', () => {
      const deliveryProto = DeliveryCourierRestApiController.prototype as any

      expect(deliveryProto.getMyDoneDeliveries).toBeUndefined()

      const methodNames = Object.getOwnPropertyNames(deliveryProto).filter(
        (m) => m !== 'constructor' && typeof deliveryProto[m] === 'function'
      )
      for (const name of methodNames) {
        const handler = deliveryProto[name]
        const path = Reflect.getMetadata(PATH_METADATA, handler)
        const paths = Array.isArray(path) ? path : [path]
        expect(paths).not.toContain('done')
        for (const p of paths) {
          if (typeof p === 'string') {
            expect(p).not.toContain('done')
          }
        }
      }
    })

    test('time-worked courier controller has no list route (PATH metadata check: a GET "" or "/" handler fails whatever its method name)', () => {
      const timeWorkedProto = TimeWorkedCourierRestApiController.prototype as any

      expect(timeWorkedProto.list).toBeUndefined()

      // Reads the route PATH metadata (Reflect.getMetadata(PATH_METADATA, handler) for every handler on the prototype)
      // so a GET '' (or '/') handler under time-worked fails whatever its method name
      const methodNames = Object.getOwnPropertyNames(timeWorkedProto).filter(
        (m) => m !== 'constructor' && typeof timeWorkedProto[m] === 'function'
      )
      for (const name of methodNames) {
        const handler = timeWorkedProto[name]
        const path = Reflect.getMetadata(PATH_METADATA, handler)
        const paths = Array.isArray(path) ? path : [path]
        expect(paths).not.toContain('')
        expect(paths).not.toContain('/')
      }
    })
  })
})
