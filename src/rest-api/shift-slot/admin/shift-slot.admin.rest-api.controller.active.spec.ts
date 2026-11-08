import { ExecutionContext, ValidationPipe } from '@nestjs/common'
import { MODULE_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common/enums/request-method.enum'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { ShiftSlotService } from 'src/services/shift-slot/shift-slot.service'
import { AdminRestApiModule } from '../../admin.rest-api.module'
import { CourierRestApiModule } from '../../courier.rest-api.module'
import { PartnerRestApiModule } from '../../partner.rest-api.module'
import { ShiftSlotAdminDto, ShiftSlotChangeAdminDto } from './dtos/shift-slot.admin.dto'
import { ShiftSlotAdminRestApiController } from './shift-slot.admin.rest-api.controller'
import { ShiftSlotAdminRestApiModule } from './shift-slot.admin.rest-api.module'

// Spec 0026 (row 77): the admin shift slot routes, called directly with the service mocked, plus the
// route metadata (roles, status codes, where the admin id comes from).
describe('ShiftSlotAdminRestApiController (spec 0026)', () => {
  let controller: ShiftSlotAdminRestApiController
  let service: jest.Mocked<Pick<ShiftSlotService, 'list' | 'create' | 'update' | 'remove' | 'changes'>>

  const admin = { id: 'admin-user-7' } as UserEntity
  const slot = {
    id: 'slot-1',
    weekday: 5,
    startMinute: 1140,
    endMinute: 1380,
    riderCap: 6,
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
    removedAt: null,
  }

  // The global pipe with src/main.ts's options, so a query reaches the method as it does live.
  const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } })

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue([slot]),
      create: jest.fn().mockResolvedValue(slot),
      update: jest.fn().mockResolvedValue(slot),
      remove: jest.fn().mockResolvedValue({ ...slot, removedAt: new Date('2026-11-03T08:00:00.000Z') }),
      changes: jest.fn().mockResolvedValue([]),
    }
    controller = new ShiftSlotAdminRestApiController(service as unknown as ShiftSlotService)
  })

  describe('GET list and includeRemoved', () => {
    // What the live pipe hands the method for a query value, using the method's declared parameter type.
    async function listWithQuery(raw: unknown) {
      const [metatype] = Reflect.getMetadata('design:paramtypes', ShiftSlotAdminRestApiController.prototype, 'list')
      const value = await pipe.transform(raw, { type: 'query', metatype, data: 'includeRemoved' })
      return controller.list(value)
    }

    it('declares includeRemoved as unknown (Object), so the pipe leaves the query text as sent', () => {
      const paramTypes = Reflect.getMetadata('design:paramtypes', ShiftSlotAdminRestApiController.prototype, 'list')
      expect(paramTypes).toEqual([Object])
    })

    it('asks for removed slots when the query is the text "true" (through the real pipe)', async () => {
      await listWithQuery('true')
      expect(service.list).toHaveBeenCalledWith(true)
    })

    it('asks for removed slots when the method gets the text "true" directly', async () => {
      await controller.list('true')
      expect(service.list).toHaveBeenCalledWith(true)
    })

    it.each([undefined, 'false', '', '1', 'yes', 'TRUE '])('lists only current slots for the query %p', async (raw) => {
      await listWithQuery(raw)
      expect(service.list).toHaveBeenCalledWith(false)
    })

    it('answers the slots as ShiftSlotAdminDto', async () => {
      const result = await controller.list(undefined)
      expect(result).toHaveLength(1)
      expect(result[0]).toBeInstanceOf(ShiftSlotAdminDto)
      expect(result[0]).toEqual({ ...slot })
    })
  })

  describe('the admin id comes from @CurrentUser', () => {
    it('create passes the body and admin.id', async () => {
      const body = { weekday: 5, startMinute: 1140, endMinute: 1380, riderCap: 6 }
      const result = await controller.create(body, admin)
      expect(service.create).toHaveBeenCalledWith(body, 'admin-user-7')
      expect(result).toBeInstanceOf(ShiftSlotAdminDto)
    })

    it('update passes the id, the body and admin.id', async () => {
      await controller.update('slot-1', { riderCap: 8 }, admin)
      expect(service.update).toHaveBeenCalledWith('slot-1', { riderCap: 8 }, 'admin-user-7')
    })

    it('remove passes the id and admin.id, and answers the removed slot', async () => {
      const result = await controller.remove('slot-1', admin)
      expect(service.remove).toHaveBeenCalledWith('slot-1', 'admin-user-7')
      expect(result).toBeInstanceOf(ShiftSlotAdminDto)
      expect(result.removedAt).toEqual(new Date('2026-11-03T08:00:00.000Z'))
    })

    it.each([
      ['create', 1],
      ['update', 2],
      ['remove', 1],
    ])('%s takes parameter %i from the request currentUser (the @CurrentUser decorator)', (method, index) => {
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, ShiftSlotAdminRestApiController, method) as Record<
        string,
        { index: number; factory?: (data: unknown, ctx: ExecutionContext) => unknown }
      >
      const custom = Object.entries(args).find(([key, arg]) => key.includes('__customRouteArgs__') && arg.index === index)
      expect(custom).toBeDefined()

      const currentUser = { id: 'admin-from-request' }
      const ctx = {
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => ({ currentUser, body: { changedByUserId: 'forged' } }) }),
      } as unknown as ExecutionContext
      expect(custom![1].factory!(undefined, ctx)).toBe(currentUser)
    })
  })

  describe('changes', () => {
    it('answers the record as ShiftSlotChangeAdminDto, in the order the service gives', async () => {
      const rows = [
        {
          id: 'c2',
          shiftSlotId: 'slot-1',
          action: 'REMOVED',
          changedByUserId: 'admin-user-7',
          before: { weekday: 5, startMinute: 1140, endMinute: 1380, riderCap: 6 },
          after: null,
          createdAt: new Date('2026-11-03T08:00:00.000Z'),
        },
        {
          id: 'c1',
          shiftSlotId: 'slot-1',
          action: 'CREATED',
          changedByUserId: 'admin-user-7',
          before: null,
          after: { weekday: 5, startMinute: 1140, endMinute: 1380, riderCap: 6 },
          createdAt: new Date('2026-11-01T10:00:00.000Z'),
        },
      ]
      service.changes.mockResolvedValue(rows as any)

      const result = await controller.changes('slot-1')

      expect(service.changes).toHaveBeenCalledWith('slot-1')
      expect(result.map((c) => c.id)).toEqual(['c2', 'c1'])
      expect(result[0]).toBeInstanceOf(ShiftSlotChangeAdminDto)
      expect(result[0]).toEqual({
        id: 'c2',
        action: 'REMOVED',
        changedByUserId: 'admin-user-7',
        before: { weekday: 5, startMinute: 1140, endMinute: 1380, riderCap: 6 },
        after: null,
        createdAt: new Date('2026-11-03T08:00:00.000Z'),
      })
    })
  })

  describe('route metadata', () => {
    const proto = ShiftSlotAdminRestApiController.prototype as any
    const methods = ['list', 'create', 'update', 'remove', 'changes'] as const

    it('is mounted under the admin namespace at shift-slots', () => {
      expect(Reflect.getMetadata(PATH_METADATA, ShiftSlotAdminRestApiController)).toBe(`${ADMIN_API_V1_PREFIX}/shift-slots`)
    })

    it.each(methods)('%s carries @Roles(ADMIN) and only ADMIN', (method) => {
      expect(Reflect.getMetadata(ROLES_KEY, proto[method])).toEqual([EnumUserRole.ADMIN])
    })

    it.each([
      ['list', RequestMethod.GET, '/'],
      ['create', RequestMethod.POST, '/'],
      ['update', RequestMethod.PATCH, ':id'],
      ['remove', RequestMethod.DELETE, ':id'],
      ['changes', RequestMethod.GET, ':id/changes'],
    ])('%s is method %s at %s', (method, httpMethod, path) => {
      expect(Reflect.getMetadata(METHOD_METADATA, proto[method])).toBe(httpMethod)
      expect(Reflect.getMetadata(PATH_METADATA, proto[method])).toBe(path)
    })

    it('DELETE answers 200 (with the slot), not 204', () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.remove)).toBe(200)
    })
  })

  describe('module wiring', () => {
    it('the module registers only this controller and is imported by the admin root module alone', () => {
      expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ShiftSlotAdminRestApiModule)).toEqual([
        ShiftSlotAdminRestApiController,
      ])
      expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, AdminRestApiModule)).toContain(ShiftSlotAdminRestApiModule)
      expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, CourierRestApiModule) || []).not.toContain(
        ShiftSlotAdminRestApiModule
      )
      expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, PartnerRestApiModule) || []).not.toContain(
        ShiftSlotAdminRestApiModule
      )
    })
  })
})
