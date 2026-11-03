import { ExecutionContext } from '@nestjs/common'
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common/enums/request-method.enum'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from 'src/constants'
import { IS_PUBLIC_KEY } from 'src/decorators/public.decorator'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { MyShiftBooking, ShiftBookingService, ShiftOccurrence } from 'src/services/shift-booking/shift-booking.service'
import { AdminRestApiModule } from '../../admin.rest-api.module'
import { CourierRestApiModule } from '../../courier.rest-api.module'
import { PartnerRestApiModule } from '../../partner.rest-api.module'
import {
  MyShiftBookingCourierDto,
  ShiftOccurrenceCourierDto,
  ShiftScheduleCourierDto,
} from './dtos/shift-schedule.courier.dto'
import { ShiftBookingCourierRestApiController } from './shift-booking.courier.rest-api.controller'
import { ShiftBookingCourierRestApiModule } from './shift-booking.courier.rest-api.module'

// Spec 0027 (row 78): the rider's shift routes, called directly with the service mocked, plus the route
// metadata (roles, status codes, where the rider id comes from) and the answer shapes (value 5).
describe('ShiftBookingCourierRestApiController (spec 0027)', () => {
  let controller: ShiftBookingCourierRestApiController
  let service: { [K in 'schedule' | 'book' | 'drop' | 'offerSwap' | 'withdrawSwap' | 'take']: jest.Mock }
  const courier = { id: 'courier-7' } as CourierEntity

  const mine: MyShiftBooking = {
    id: 'booking-1',
    shiftSlotId: 'slot-fri',
    date: '2026-11-06',
    startsAt: new Date('2026-11-06T17:00:00.000Z'),
    endsAt: new Date('2026-11-06T21:00:00.000Z'),
    startTime: '19:00',
    endTime: '23:00',
    swapOfferedAt: null,
    dropUntil: new Date('2026-11-06T05:00:00.000Z'),
    dropUntilText: 'Fri 6 Nov, 07:00',
    slotRemoved: false,
  }
  const occurrence: ShiftOccurrence = {
    shiftSlotId: 'slot-fri',
    date: '2026-11-06',
    startsAt: new Date('2026-11-06T17:00:00.000Z'),
    endsAt: new Date('2026-11-06T21:00:00.000Z'),
    startTime: '19:00',
    endTime: '23:00',
    riderCap: 3,
    placesTaken: 1,
    myBookingId: null,
    openSwap: { bookingId: 'swap-1' },
  }

  beforeEach(() => {
    service = {
      schedule: jest.fn().mockResolvedValue({ serverNow: new Date(), occurrences: [occurrence], myBookings: [mine] }),
      book: jest.fn().mockResolvedValue(mine),
      drop: jest.fn().mockResolvedValue(mine),
      offerSwap: jest.fn().mockResolvedValue(mine),
      withdrawSwap: jest.fn().mockResolvedValue(mine),
      take: jest.fn().mockResolvedValue(mine),
    }
    controller = new ShiftBookingCourierRestApiController(service as unknown as ShiftBookingService)
  })

  describe("each route passes the signed-in rider's id and the server's clock", () => {
    it('schedule', async () => {
      const result = await controller.schedule(courier)
      expect(service.schedule).toHaveBeenCalledWith('courier-7', expect.any(Date))
      expect(result).toBeInstanceOf(ShiftScheduleCourierDto)
      expect(result.occurrences[0]).toBeInstanceOf(ShiftOccurrenceCourierDto)
      expect(result.myBookings[0]).toBeInstanceOf(MyShiftBookingCourierDto)
    })

    it("book passes the body's slot and date", async () => {
      const result = await controller.book({ shiftSlotId: 'slot-fri', date: '2026-11-06' }, courier)
      expect(service.book).toHaveBeenCalledWith('courier-7', 'slot-fri', '2026-11-06', expect.any(Date))
      expect(result).toBeInstanceOf(MyShiftBookingCourierDto)
    })

    it.each([
      ['drop', 'drop'],
      ['swap', 'offerSwap'],
      ['withdraw', 'withdrawSwap'],
      ['take', 'take'],
    ] as const)('%s passes the path id to service.%s', async (method, serviceMethod) => {
      const result = await controller[method]('booking-9', courier)
      expect(service[serviceMethod]).toHaveBeenCalledWith('courier-7', 'booking-9', expect.any(Date))
      expect(result).toBeInstanceOf(MyShiftBookingCourierDto)
    })

    it("the clock is the server's now", async () => {
      const before = Date.now()
      await controller.drop('booking-9', courier)
      const at = (service.drop.mock.calls[0][2] as Date).getTime()
      expect(at).toBeGreaterThanOrEqual(before)
      expect(at).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('route metadata', () => {
    const proto = ShiftBookingCourierRestApiController.prototype as any
    const methods = ['schedule', 'book', 'drop', 'swap', 'withdraw', 'take'] as const

    it('is mounted under the courier namespace at shifts', () => {
      expect(Reflect.getMetadata(PATH_METADATA, ShiftBookingCourierRestApiController)).toBe(
        `${COURIER_API_V1_PREFIX}/shifts`
      )
    })

    it.each(methods)('%s carries @Roles(COURIER) and only COURIER, and is not public', (method) => {
      expect(Reflect.getMetadata(ROLES_KEY, proto[method])).toEqual([EnumUserRole.COURIER])
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto[method])).toBeUndefined()
    })

    it.each([
      ['schedule', RequestMethod.GET, '/'],
      ['book', RequestMethod.POST, 'bookings'],
      ['drop', RequestMethod.POST, 'bookings/:id/drop'],
      ['swap', RequestMethod.POST, 'bookings/:id/swap'],
      ['withdraw', RequestMethod.POST, 'bookings/:id/swap/withdraw'],
      ['take', RequestMethod.POST, 'bookings/:id/take'],
    ])('%s is method %s at %s', (method, httpMethod, path) => {
      expect(Reflect.getMetadata(METHOD_METADATA, proto[method])).toBe(httpMethod)
      expect(Reflect.getMetadata(PATH_METADATA, proto[method])).toBe(path)
    })

    it.each(['drop', 'swap', 'withdraw', 'take'])('%s answers 200, not 201', (method) => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto[method])).toBe(200)
    })

    it.each([
      ['schedule', 0],
      ['book', 1],
      ['drop', 1],
      ['swap', 1],
      ['withdraw', 1],
      ['take', 1],
    ])(
      "%s takes parameter %i from the request's currentCourier (@CurrentUserCourier), never the body",
      (method, index) => {
        const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, ShiftBookingCourierRestApiController, method) as Record<
          string,
          { index: number; factory?: (data: unknown, ctx: ExecutionContext) => unknown }
        >
        const custom = Object.entries(args).find(
          ([key, arg]) => key.includes('__customRouteArgs__') && arg.index === index
        )
        expect(custom).toBeDefined()

        const currentCourier = { id: 'courier-from-token' }
        const ctx = {
          getType: () => 'http',
          switchToHttp: () => ({
            getRequest: () => ({ currentCourier, currentUser: { id: 'user-x' }, body: { courierId: 'forged' } }),
          }),
        } as unknown as ExecutionContext
        expect(custom![1].factory!(undefined, ctx)).toBe(currentCourier)
      }
    )
  })

  describe('module wiring', () => {
    it('is registered in the courier API tree only', () => {
      expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ShiftBookingCourierRestApiModule)).toEqual([
        ShiftBookingCourierRestApiController,
      ])
      expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, CourierRestApiModule)).toContain(
        ShiftBookingCourierRestApiModule
      )
      expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, AdminRestApiModule) || []).not.toContain(
        ShiftBookingCourierRestApiModule
      )
      expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, PartnerRestApiModule) || []).not.toContain(
        ShiftBookingCourierRestApiModule
      )
    })
  })

  describe('value 5: no answer names a rider', () => {
    const riderish = /courier|rider(?!Cap)|giver|taker|user|offeredBy|name|email|phone/i

    it("an occurrence has exactly the spec's fields, none naming a rider", () => {
      const dto = new ShiftOccurrenceCourierDto(occurrence)
      expect(Object.keys(dto).sort()).toEqual(
        [
          'date',
          'endTime',
          'endsAt',
          'myBookingId',
          'openSwap',
          'placesTaken',
          'riderCap',
          'shiftSlotId',
          'startTime',
          'startsAt',
        ].sort()
      )
      for (const key of Object.keys(dto)) {
        expect(key).not.toMatch(riderish)
      }
    })

    it('an open swap carries its booking id only, even if the service object held more', () => {
      const leaky = { ...occurrence, openSwap: { bookingId: 'swap-1', courierId: 'giver-1', name: 'Giver' } }
      const dto = new ShiftOccurrenceCourierDto(leaky as unknown as ShiftOccurrence)
      expect(dto.openSwap).toEqual({ bookingId: 'swap-1' })
      expect(JSON.stringify(dto)).not.toContain('giver-1')
    })

    it('an occurrence built from an object carrying rider ids drops them', () => {
      const leaky = { ...occurrence, courierId: 'x-courier', courierIds: ['a'], bookedBy: ['b'] }
      const dto = new ShiftOccurrenceCourierDto(leaky as unknown as ShiftOccurrence)
      expect(JSON.stringify(dto)).not.toMatch(/x-courier|courierIds|bookedBy/)
    })

    it("a booking answer has exactly the spec's fields, none naming a rider", () => {
      const dto = new MyShiftBookingCourierDto({ ...mine, courierId: 'me' } as unknown as MyShiftBooking)
      expect(Object.keys(dto).sort()).toEqual(
        [
          'date',
          'dropUntil',
          'dropUntilText',
          'endTime',
          'endsAt',
          'id',
          'shiftSlotId',
          'slotRemoved',
          'startTime',
          'startsAt',
          'swapOfferedAt',
        ].sort()
      )
    })

    it('the schedule answer has serverNow, occurrences and myBookings only', () => {
      const dto = new ShiftScheduleCourierDto({ serverNow: new Date(), occurrences: [occurrence], myBookings: [mine] })
      expect(Object.keys(dto).sort()).toEqual(['myBookings', 'occurrences', 'serverNow'])
    })
  })
})
