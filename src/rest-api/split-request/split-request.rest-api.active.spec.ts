import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { RequestMethod, ValidationPipe, BadRequestException } from '@nestjs/common'
import { EnumSplitRequestStatus, EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX, COURIER_API_V1_PREFIX } from 'src/constants'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { splitLeaveFrom } from 'src/domains/split/split'
import { SplitRequestAdminRestApiController } from './admin/split-request.admin.rest-api.controller'
import { SplitRequestCourierRestApiController } from './courier/split-request.courier.rest-api.controller'
import {
  SplitConfirmAdminInput,
  SplitRefuseAdminInput,
  SplitRequestAdminDto,
  SplitRequestCourierDto,
  SplitRequestCourierInput,
} from './dtos/split-request.dto'

// Spec 0047 (row 11): the split request routes. Riders in the courier namespace, admins in the admin
// namespace, never mixed (AGENTS.md: "never mix audiences").
describe('split request routes (spec 0047)', () => {
  const FLAGGED_AT = new Date('2026-11-21T12:00:00.000Z')

  // The route a controller method answers: its HTTP verb and its path under the controller's prefix.
  const routeOf = (controller: any, method: string) => {
    const handler = controller.prototype[method]
    const verb = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod
    return `${RequestMethod[verb]} ${Reflect.getMetadata(PATH_METADATA, controller)}/${Reflect.getMetadata(PATH_METADATA, handler)}`.replace(/\/+$/, '')
  }
  const rolesOf = (controller: any, method: string) => Reflect.getMetadata(ROLES_KEY, controller.prototype[method])

  describe('who may call what (security model)', () => {
    it('the rider routes are in the courier namespace, for the COURIER role only', () => {
      expect(routeOf(SplitRequestCourierRestApiController, 'request')).toBe(`POST ${COURIER_API_V1_PREFIX}/deliveries/:deliveryId/split-requests`)
      expect(routeOf(SplitRequestCourierRestApiController, 'leave')).toBe(`POST ${COURIER_API_V1_PREFIX}/deliveries/:deliveryId/split-requests/leave`)
      expect(rolesOf(SplitRequestCourierRestApiController, 'request')).toEqual([EnumUserRole.COURIER])
      expect(rolesOf(SplitRequestCourierRestApiController, 'leave')).toEqual([EnumUserRole.COURIER])
    })

    it('the queue routes are in the admin namespace, for the ADMIN role only', () => {
      expect(routeOf(SplitRequestAdminRestApiController, 'list')).toBe(`GET ${ADMIN_API_V1_PREFIX}/split-requests`)
      expect(routeOf(SplitRequestAdminRestApiController, 'count')).toBe(`GET ${ADMIN_API_V1_PREFIX}/split-requests/count`)
      expect(routeOf(SplitRequestAdminRestApiController, 'confirm')).toBe(`POST ${ADMIN_API_V1_PREFIX}/split-requests/:id/confirm`)
      expect(routeOf(SplitRequestAdminRestApiController, 'refuse')).toBe(`POST ${ADMIN_API_V1_PREFIX}/split-requests/:id/refuse`)
      for (const method of ['list', 'count', 'confirm', 'refuse']) {
        expect(rolesOf(SplitRequestAdminRestApiController, method)).toEqual([EnumUserRole.ADMIN])
      }
    })
  })

  describe('the rider controller', () => {
    const courier = { id: 'rider-1' } as any
    const created = {
      id: 'split-1',
      deliveryId: 'del-1',
      courierId: 'rider-1',
      status: EnumSplitRequestStatus.OPEN,
      proposedLegs: [{ boxSize: 'LARGE' }, { boxSize: 'SMALL' }],
      finalLegs: null,
      createdAt: FLAGGED_AT,
      adminNote: null,
      answeredByUserId: null,
    }

    function setup(minutes = 10) {
      const splitRequestService = { request: jest.fn().mockResolvedValue(created), leave: jest.fn().mockResolvedValue(undefined) }
      const config = { instanceConfig: { getSplitAnswerMinutes: jest.fn().mockResolvedValue(minutes) } }
      const controller = new SplitRequestCourierRestApiController(splitRequestService as any, config as any)
      return { controller, splitRequestService }
    }

    it('request: acts as the signed in rider, never an id from the body, and answers the request with when they may leave', async () => {
      const { controller, splitRequestService } = setup(10)
      const legs = [{ boxSize: 'LARGE' }, { boxSize: 'SMALL' }] as any

      const dto = await controller.request('del-1', { legs }, courier)

      expect(splitRequestService.request).toHaveBeenCalledWith('rider-1', 'del-1', legs)
      expect(dto).toMatchObject({ id: 'split-1', deliveryId: 'del-1', status: EnumSplitRequestStatus.OPEN, proposedLegs: legs })
      // AC-2: the flag time plus the co-op's setting, on the server's clock.
      expect(dto.leaveFrom).toEqual(new Date('2026-11-21T12:10:00.000Z'))
    })

    it('request: leaveFrom follows the setting', async () => {
      const { controller } = setup(25)
      const dto = await controller.request('del-1', { legs: [] as any }, courier)
      expect(dto.leaveFrom).toEqual(new Date('2026-11-21T12:25:00.000Z'))
    })

    it('leave: acts as the signed in rider and answers LEFT', async () => {
      const { controller, splitRequestService } = setup()
      await expect(controller.leave('del-1', courier)).resolves.toEqual({ status: 'LEFT' })
      expect(splitRequestService.leave).toHaveBeenCalledWith('rider-1', 'del-1')
    })

    it("a refusal from the service (409 before the limit) reaches the rider as it is", async () => {
      const { controller, splitRequestService } = setup()
      splitRequestService.leave.mockRejectedValue(new Error('You can leave after 10 minutes without an answer from dispatch.'))
      await expect(controller.leave('del-1', courier)).rejects.toThrow('You can leave after 10 minutes')
    })
  })

  describe('the admin controller', () => {
    const admin = { id: 'admin-user-9' } as any

    function setup() {
      const splitRequestService = {
        listOpen: jest.fn().mockResolvedValue([]),
        countOpen: jest.fn().mockResolvedValue(4),
        confirm: jest.fn().mockResolvedValue(undefined),
        refuse: jest.fn().mockResolvedValue(undefined),
        // The co-op's answer limit in minutes (row 11 review: the queue shows when the rider may leave).
        answerMinutes: jest.fn().mockResolvedValue(10),
      }
      return { controller: new SplitRequestAdminRestApiController(splitRequestService as any), splitRequestService }
    }

    it('count answers { open } for the sidebar', async () => {
      const { controller } = setup()
      await expect(controller.count()).resolves.toEqual({ open: 4 })
    })

    it('confirm with no body legs confirms as proposed, naming the signed in admin', async () => {
      const { controller, splitRequestService } = setup()
      await expect(controller.confirm('split-1', {}, admin)).resolves.toEqual({ status: 'CONFIRMED' })
      expect(splitRequestService.confirm).toHaveBeenCalledWith({ id: 'admin-user-9' }, 'split-1', undefined)
    })

    it("confirm with legs passes the admin's changed boxes", async () => {
      const { controller, splitRequestService } = setup()
      const legs = [{ boxSize: 'MEDIUM' }, { boxSize: 'MEDIUM' }] as any
      await controller.confirm('split-1', { legs }, admin)
      expect(splitRequestService.confirm).toHaveBeenCalledWith({ id: 'admin-user-9' }, 'split-1', legs)
    })

    it('refuse passes the optional sentence, or null when none was typed', async () => {
      const { controller, splitRequestService } = setup()
      await expect(controller.refuse('split-1', { note: 'It fits' }, admin)).resolves.toEqual({ status: 'REFUSED' })
      await controller.refuse('split-1', {}, admin)
      expect(splitRequestService.refuse).toHaveBeenNthCalledWith(1, { id: 'admin-user-9' }, 'split-1', 'It fits')
      expect(splitRequestService.refuse).toHaveBeenNthCalledWith(2, { id: 'admin-user-9' }, 'split-1', null)
    })

    it('list shows each open request with the restaurant, the rider, the proposal and the wait so far (AC-4)', async () => {
      const { controller, splitRequestService } = setup()
      jest.useFakeTimers()
      jest.setSystemTime(new Date('2026-11-21T12:06:40.000Z'))
      splitRequestService.listOpen.mockResolvedValue([
        {
          id: 'split-1',
          deliveryId: 'del-1',
          courierId: 'rider-1',
          proposedLegs: [{ boxSize: 'LARGE' }, { boxSize: 'SMALL' }],
          createdAt: FLAGGED_AT,
          courier: { firstName: 'Nikos', lastName: 'Rider' },
          delivery: { orderReference: 'ORDER-77', pickupBusinessName: 'Volos Test Kitchen', boxSize: 'LARGE', legNumber: null, legCount: null, status: 'COURIER_ARRIVED_AT_PICKUP_LOCATION' },
        },
      ])

      const rows = await controller.list()
      jest.useRealTimers()

      expect(rows).toEqual([
        {
          id: 'split-1',
          deliveryId: 'del-1',
          courierId: 'rider-1',
          courierName: 'Nikos Rider',
          restaurantName: 'Volos Test Kitchen',
          orderReference: 'ORDER-77',
          currentBoxSize: 'LARGE',
          legNumber: null,
          legCount: null,
          proposedLegs: [{ boxSize: 'LARGE' }, { boxSize: 'SMALL' }],
          createdAt: FLAGGED_AT,
          // 6 min 40 s since the flag: whole minutes, rounded down, as the wait is paid.
          waitedMinutes: 6,
          // Row 11 review: the flag time plus the co-op's 10 minutes.
          leaveFrom: new Date('2026-11-21T12:10:00.000Z'),
        },
      ])
    })

    // Row 11 review: each row of the queue says when the rider may leave without an answer.
    it("list: each row's leave time is its own flag time plus the co-op's answer minutes (a setting, not a fixed 10)", async () => {
      const { controller, splitRequestService } = setup()
      splitRequestService.answerMinutes.mockResolvedValue(4)
      const queueRow = (id: string, createdAt: Date) => ({
        id,
        deliveryId: `del-${id}`,
        courierId: 'rider-1',
        proposedLegs: [],
        createdAt,
        courier: { firstName: 'Nikos', lastName: 'Rider' },
        delivery: { orderReference: null, pickupBusinessName: 'Kitchen', boxSize: 'LARGE', legNumber: null, legCount: null, status: 'X' },
      })
      splitRequestService.listOpen.mockResolvedValue([
        queueRow('a', FLAGGED_AT),
        queueRow('b', new Date('2026-11-21T12:03:30.000Z')),
      ])

      const rows = await controller.list()

      expect(rows.map((row) => row.leaveFrom)).toEqual([new Date('2026-11-21T12:04:00.000Z'), new Date('2026-11-21T12:07:30.000Z')])
    })
  })

  describe('SplitRequestCourierDto: what the rider sees of their own request (AC-2, AC-7)', () => {
    const stored = {
      id: 'split-1',
      deliveryId: 'del-1',
      courierId: 'rider-1',
      status: EnumSplitRequestStatus.REFUSED,
      proposedLegs: [{ boxSize: 'LARGE', somethingElse: true }, { boxSize: 'SMALL' }],
      finalLegs: null,
      openFor: null,
      createdAt: FLAGGED_AT,
      answeredAt: new Date('2026-11-21T12:04:00.000Z'),
      answeredByUserId: 'admin-user-9',
      adminNote: 'It fits if you turn the platter',
    } as any

    it("carries the admin's sentence, the proposal and the leave time", () => {
      const dto = new SplitRequestCourierDto(stored, new Date('2026-11-21T12:10:00.000Z'))
      expect(dto).toMatchObject({
        id: 'split-1',
        deliveryId: 'del-1',
        status: EnumSplitRequestStatus.REFUSED,
        proposedLegs: [{ boxSize: 'LARGE' }, { boxSize: 'SMALL' }],
        finalLegs: null,
        adminNote: 'It fits if you turn the platter',
      })
      expect(dto.leaveFrom).toEqual(new Date('2026-11-21T12:10:00.000Z'))
    })

    it('never carries which admin answered', () => {
      const dto = new SplitRequestCourierDto(stored, new Date())
      expect(JSON.stringify(dto)).not.toContain('admin-user-9')
      expect(dto).not.toHaveProperty('answeredByUserId')
    })

    it('carries the final legs once confirmed', () => {
      const dto = new SplitRequestCourierDto(
        { ...stored, status: EnumSplitRequestStatus.CONFIRMED, finalLegs: [{ boxSize: 'MEDIUM' }, { boxSize: 'SMALL' }], adminNote: null },
        new Date()
      )
      expect(dto.finalLegs).toEqual([{ boxSize: 'MEDIUM' }, { boxSize: 'SMALL' }])
    })
  })

  describe('SplitRequestAdminDto.waitedMinutes', () => {
    const row = {
      id: 'split-1',
      deliveryId: 'del-1',
      courierId: 'rider-1',
      proposedLegs: [],
      createdAt: FLAGGED_AT,
      courier: { firstName: 'Nikos', lastName: 'Rider' },
      delivery: { orderReference: null, pickupBusinessName: 'Kitchen', boxSize: 'LARGE', legNumber: 1, legCount: 2, status: 'X' },
    } as any

    it('is 0 in the first minute and never negative', () => {
      expect(new SplitRequestAdminDto(row, new Date('2026-11-21T12:00:59.000Z'), 10).waitedMinutes).toBe(0)
      expect(new SplitRequestAdminDto(row, new Date('2026-11-21T11:59:00.000Z'), 10).waitedMinutes).toBe(0)
    })

    it('shows the leg labels of a delivery that is already a leg', () => {
      const dto = new SplitRequestAdminDto(row, new Date('2026-11-21T12:11:00.000Z'), 10)
      expect(dto).toMatchObject({ legNumber: 1, legCount: 2, waitedMinutes: 11 })
    })

    // Row 11 review.
    describe('leaveFrom: when the rider may leave without an answer', () => {
      it('is the flag time plus the answer minutes', () => {
        expect(new SplitRequestAdminDto(row, new Date('2026-11-21T12:02:00.000Z'), 10).leaveFrom).toEqual(
          new Date('2026-11-21T12:10:00.000Z')
        )
        expect(new SplitRequestAdminDto(row, new Date('2026-11-21T12:02:00.000Z'), 3).leaveFrom).toEqual(
          new Date('2026-11-21T12:03:00.000Z')
        )
      })

      it('does not move with the time the queue is read: it counts from the flag, not from now', () => {
        const early = new SplitRequestAdminDto(row, new Date('2026-11-21T12:01:00.000Z'), 10)
        const late = new SplitRequestAdminDto(row, new Date('2026-11-21T12:25:00.000Z'), 10)
        expect(early.leaveFrom).toEqual(late.leaveFrom)
      })

      it("is the same moment the rider is told (the domain's splitLeaveFrom), so the two screens agree", () => {
        expect(new SplitRequestAdminDto(row, new Date(), 7).leaveFrom).toEqual(splitLeaveFrom(FLAGGED_AT, 7))
      })
    })
  })

  describe('request bodies are checked before the service runs (AC-1, AC-4)', () => {
    // The same pipe main.ts installs globally: it builds the class and runs its decorators.
    const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } })
    const check = (metatype: any, body: unknown) => pipe.transform(body, { type: 'body', metatype })
    const box = (boxSize: unknown) => ({ boxSize })

    it.each([2, 3, 4])("accepts a rider's proposal of %i boxes", async (count) => {
      const legs = Array.from({ length: count }, () => box('MEDIUM'))
      await expect(check(SplitRequestCourierInput, { legs })).resolves.toMatchObject({ legs })
    })

    it.each([
      ['one box', { legs: [box('LARGE')] }],
      ['five boxes', { legs: [box('LARGE'), box('SMALL'), box('SMALL'), box('SMALL'), box('SMALL')] }],
      ['an unknown size', { legs: [box('LARGE'), box('GIANT')] }],
      ['a box with no size', { legs: [box('LARGE'), {}] }],
      ['no legs', {}],
      ['legs that are not a list', { legs: 'LARGE,SMALL' }],
    ])("refuses a rider's proposal with %s (400)", async (_name, body) => {
      await expect(check(SplitRequestCourierInput, body)).rejects.toBeInstanceOf(BadRequestException)
    })

    it('an admin may confirm with no legs (as proposed) or with 2 to 4 boxes', async () => {
      await expect(check(SplitConfirmAdminInput, {})).resolves.toBeDefined()
      await expect(check(SplitConfirmAdminInput, { legs: [box('LARGE'), box('SMALL')] })).resolves.toBeDefined()
    })

    it.each([
      ['one box', { legs: [box('LARGE')] }],
      ['five boxes', { legs: [box('LARGE'), box('SMALL'), box('SMALL'), box('SMALL'), box('SMALL')] }],
      ['an unknown size', { legs: [box('LARGE'), box('GIANT')] }],
    ])("refuses an admin's confirm with %s (400)", async (_name, body) => {
      await expect(check(SplitConfirmAdminInput, body)).rejects.toBeInstanceOf(BadRequestException)
    })

    it("an admin's sentence is optional, text, and at most 300 characters", async () => {
      await expect(check(SplitRefuseAdminInput, {})).resolves.toBeDefined()
      await expect(check(SplitRefuseAdminInput, { note: 'It fits' })).resolves.toMatchObject({ note: 'It fits' })
      await expect(check(SplitRefuseAdminInput, { note: 'x'.repeat(301) })).rejects.toBeInstanceOf(BadRequestException)
    })
  })
})
