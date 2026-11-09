import { Logger, RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { EnumCourierStatus, EnumDeliveryStatus, EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { DispatchBoardService } from 'src/services/dispatch-board/dispatch-board.service'
import { DispatchBoardAdminRestApiController } from './dispatch-board.admin.rest-api.controller'
import { DispatchAttentionRowAdminDto, DispatchBoardAdminDto } from './dtos/dispatch-board.admin.dto'

describe('DispatchBoardAdminRestApiController (spec 0034, AC-13, AC-17)', () => {
  let controller: DispatchBoardAdminRestApiController
  let mockDispatchBoardService: jest.Mocked<DispatchBoardService>

  const NOW = new Date('2026-11-09T14:00:00.000Z')

  const sampleBoard = {
    generatedAt: NOW,
    cards: {
      active: { total: 2, toPickup: 1, toDropoff: 1 },
      waiting: { total: 1, oldestWaitingMinutes: 15 },
      couriers: { total: 3, busy: 1, free: 1, lastCall: 1 },
      deliveredToday: { total: 5, medianMinutes: 22 },
    },
    attention: [
      {
        id: 'OFFER_UNANSWERED:del-1',
        kind: 'OFFER_UNANSWERED',
        since: null, // AC-5: deadline running -> since is null
        sortAt: new Date('2026-11-09T13:58:00.000Z'), // Internal sort field
        deliveryId: 'del-1',
        sosId: null,
        issueId: null,
        threadId: null,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        orderReference: 'ORD-123',
        restaurantName: 'Souvlaki tou Nikou',
        riderName: 'Giorgos',
        customerLabel: 'Maria',
        detail: 'Offered to Giorgos, unanswered',
        held: false,
      },
    ],
    attentionMore: 0,
    map: {
      couriers: [
        {
          id: 'c-1',
          name: 'Giorgos Alexiou',
          latitude: 39.362,
          longitude: 22.942,
          state: 'BUSY' as const,
          carrying: [{ deliveryId: 'del-1', orderReference: 'ORD-123', offered: true }],
        },
      ],
      waitingDeliveries: [],
    },
    dispatchStop: { active: false, until: null },
  }

  beforeEach(() => {
    mockDispatchBoardService = {
      getBoard: jest.fn().mockResolvedValue(sampleBoard),
    } as unknown as jest.Mocked<DispatchBoardService>

    controller = new DispatchBoardAdminRestApiController(mockDispatchBoardService)
  })

  // AC-17: Access and route guards
  describe('Routing, Roles, and SkipThrottle (AC-17)', () => {
    test('controller is mapped under admin API prefix at "dispatch"', () => {
      const controllerPath = Reflect.getMetadata(PATH_METADATA, DispatchBoardAdminRestApiController)
      expect(controllerPath).toBe(`${ADMIN_API_V1_PREFIX}/dispatch`)
    })

    test('getBoard handler is mapped at GET "board"', () => {
      const path = Reflect.getMetadata(PATH_METADATA, controller.getBoard)
      const method = Reflect.getMetadata(METHOD_METADATA, controller.getBoard)
      expect(path).toBe('board')
      expect(method).toBe(RequestMethod.GET)
    })

    test('getBoard carries @Roles(ADMIN) (a test fails if removed)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.getBoard)
      expect(roles).toEqual([EnumUserRole.ADMIN])
    })

    test('getBoard carries @SkipThrottle() (a test fails if removed)', () => {
      // @SkipThrottle() sets 'THROTTLER:SKIPdefault' metadata to true
      const skipThrottle = Reflect.getMetadata('THROTTLER:SKIPdefault', controller.getBoard)
      expect(skipThrottle).toBe(true)
    })
  })

  // AC-13 & AC-5: DTO contracts and leaks prevention
  describe('DTO contract and privacy (AC-5, AC-13, AC-17)', () => {
    test('returns DispatchBoardAdminDto wrapping the service output', async () => {
      const result = await controller.getBoard()

      expect(result).toBeInstanceOf(DispatchBoardAdminDto)
      expect(result.generatedAt).toEqual(NOW)
      expect(result.cards).toEqual(sampleBoard.cards)
      expect(result.attention).toHaveLength(1)
      expect(result.attention[0]).toBeInstanceOf(DispatchAttentionRowAdminDto)
      expect(result.attention[0]?.id).toBe('OFFER_UNANSWERED:del-1')
      expect(result.attention[0]?.since).toBeNull()
      expect(result.dispatchStop).toEqual({ active: false, until: null })
    })

    test('internal sortAt is NEVER exposed on DispatchAttentionRowAdminDto (AC-5, AC-13)', async () => {
      const result = await controller.getBoard()
      const rowDto = result.attention[0] as any

      // 1. Property does not exist on DTO instance
      expect('sortAt' in rowDto).toBe(false)
      expect(rowDto.sortAt).toBeUndefined()

      // 2. Not in Object.keys
      expect(Object.keys(rowDto)).not.toContain('sortAt')

      // 3. Not in serialized JSON
      const json = JSON.stringify(result)
      expect(json).not.toContain('sortAt')
    })

    test('currentLocationAt, position age and position history are NEVER exposed in DTO or map (AC-13)', async () => {
      const result = await controller.getBoard()
      const courier = result.map.couriers[0] as any

      expect('currentLocationAt' in courier).toBe(false)
      expect(courier.currentLocationAt).toBeUndefined()
      expect('history' in courier).toBe(false)
      expect('trail' in courier).toBe(false)
      expect('positionAge' in courier).toBe(false)

      const json = JSON.stringify(result)
      expect(json).not.toContain('currentLocationAt')
      expect(json).not.toContain('positionAge')
    })

    test('positions and coordinates are never written to logger (AC-17)', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined)

      try {
        await controller.getBoard()

        for (const spy of [logSpy, warnSpy, errorSpy, consoleLog]) {
          for (const call of spy.mock.calls) {
            const message = JSON.stringify(call)
            expect(message).not.toContain('39.362')
            expect(message).not.toContain('22.942')
          }
        }
      } finally {
        logSpy.mockRestore()
        warnSpy.mockRestore()
        errorSpy.mockRestore()
        consoleLog.mockRestore()
      }
    })
  })
})
