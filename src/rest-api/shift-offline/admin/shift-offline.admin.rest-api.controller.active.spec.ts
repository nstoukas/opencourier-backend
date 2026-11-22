import { HTTP_CODE_METADATA, METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common/enums/request-method.enum'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { OfflineEventForAdmin } from 'src/persistence/repositories/shift-booking.repository'
import { ShiftOfflineService } from 'src/services/shift-offline/shift-offline.service'
import { AdminRestApiModule } from '../../admin.rest-api.module'
import { CourierRestApiModule } from '../../courier.rest-api.module'
import { PartnerRestApiModule } from '../../partner.rest-api.module'
import { ShiftOfflineEventAdminDto } from './dtos/shift-offline-event.admin.dto'
import { ShiftOfflineAdminRestApiController } from './shift-offline.admin.rest-api.controller'
import { ShiftOfflineAdminRestApiModule } from './shift-offline.admin.rest-api.module'

// Spec 0049 (row 79; AC-6, cross check 2 and 3): the admin routes for Offline during a booked shift, called
// directly with the service mocked, plus the route metadata (path, roles, status code, namespace).
describe('ShiftOfflineAdminRestApiController (spec 0049)', () => {
  let controller: ShiftOfflineAdminRestApiController
  let service: { adminList: jest.Mock; followUp: jest.Mock }

  const admin = { id: 'admin-user-7' } as UserEntity

  // Offline at 21:10 Athens on Fri 20 Nov, in a 20:00 to 24:00 shift.
  function item(overrides: Partial<OfflineEventForAdmin> = {}): OfflineEventForAdmin {
    return {
      id: 'event-1',
      offlineAt: new Date('2026-11-20T19:10:00.000Z'),
      cause: 'RIDER',
      followedUpAt: null,
      followedUpByEmail: null,
      courierId: 'rider-1',
      courierName: 'Maria Papadopoulou',
      shiftStartsAt: new Date('2026-11-20T18:00:00.000Z'),
      shiftEndsAt: new Date('2026-11-20T21:59:00.000Z'),
      shiftDate: '2026-11-20',
      ...overrides,
    }
  }

  beforeEach(() => {
    service = { adminList: jest.fn().mockResolvedValue([item()]), followUp: jest.fn().mockResolvedValue(undefined) }
    controller = new ShiftOfflineAdminRestApiController(service as unknown as ShiftOfflineService)
  })

  describe('the routes', () => {
    const prototype = ShiftOfflineAdminRestApiController.prototype

    it('live under admin/v1/shifts/offline-events', () => {
      expect(Reflect.getMetadata(PATH_METADATA, ShiftOfflineAdminRestApiController)).toBe(
        `${ADMIN_API_V1_PREFIX}/shifts/offline-events`
      )
      expect(`${ADMIN_API_V1_PREFIX}/shifts/offline-events`).toMatch(/admin\/v1\/shifts\/offline-events$/)
    })

    it('GET "" is the list, POST ":id/followed-up" answers 204', () => {
      expect(Reflect.getMetadata(METHOD_METADATA, prototype.list)).toBe(RequestMethod.GET)
      expect(Reflect.getMetadata(PATH_METADATA, prototype.list)).toMatch(/^\/?$/)
      expect(Reflect.getMetadata(METHOD_METADATA, prototype.followUp)).toBe(RequestMethod.POST)
      expect(Reflect.getMetadata(PATH_METADATA, prototype.followUp)).toBe(':id/followed-up')
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.followUp)).toBe(204)
    })

    it('both are for admins only (a rider token is refused)', () => {
      expect(Reflect.getMetadata(ROLES_KEY, prototype.list)).toEqual([EnumUserRole.ADMIN])
      expect(Reflect.getMetadata(ROLES_KEY, prototype.followUp)).toEqual([EnumUserRole.ADMIN])
    })

    it('has no other route: nothing by rider, no count, no search', () => {
      const routes = Object.getOwnPropertyNames(prototype).filter(
        (name) => name !== 'constructor' && Reflect.getMetadata(PATH_METADATA, (prototype as never)[name]) !== undefined
      )
      expect(routes.sort()).toEqual(['followUp', 'list'])
    })

    it('the list takes no query at all (no search, filter or sort by rider)', () => {
      expect(controller.list.length).toBe(0)
    })

    it('is registered in the admin API only, never the courier or partner one', () => {
      expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ShiftOfflineAdminRestApiModule)).toEqual([
        ShiftOfflineAdminRestApiController,
      ])
      expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, AdminRestApiModule)).toContain(ShiftOfflineAdminRestApiModule)
      expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, CourierRestApiModule) || []).not.toContain(
        ShiftOfflineAdminRestApiModule
      )
      expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, PartnerRestApiModule) || []).not.toContain(
        ShiftOfflineAdminRestApiModule
      )
    })
  })

  describe('GET list', () => {
    it("asks the service with the server's clock and answers DTOs in the service's order", async () => {
      service.adminList.mockResolvedValue([item({ id: 'event-2' }), item({ id: 'event-1' })])
      const result = await controller.list()
      expect(service.adminList).toHaveBeenCalledTimes(1)
      expect(service.adminList).toHaveBeenCalledWith(expect.any(Date))
      expect(result.map((dto) => dto.id)).toEqual(['event-2', 'event-1'])
      expect(result[0]).toBeInstanceOf(ShiftOfflineEventAdminDto)
    })

    it('answers a plain list: no total, no grouping', async () => {
      const result = await controller.list()
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('POST :id/followed-up', () => {
    it("passes the item id, the signed-in admin's id and the server's clock", async () => {
      await expect(controller.followUp('event-1', admin)).resolves.toBeUndefined()
      expect(service.followUp).toHaveBeenCalledWith('event-1', 'admin-user-7', expect.any(Date))
    })

    it("lets the service's refusal through (404, 409)", async () => {
      const refusal = new Error('This item was already followed up.')
      service.followUp.mockRejectedValue(refusal)
      await expect(controller.followUp('event-1', admin)).rejects.toBe(refusal)
    })
  })

  describe('the item an admin reads (AC-6)', () => {
    it('has the rider, the shift, the time and the cause, with the times as Athens text', () => {
      const dto = new ShiftOfflineEventAdminDto(item())
      expect(dto).toEqual({
        id: 'event-1',
        courierId: 'rider-1',
        courierName: 'Maria Papadopoulou',
        offlineAt: new Date('2026-11-20T19:10:00.000Z'),
        offlineTime: '21:10',
        shiftDate: '2026-11-20',
        shiftStartsAt: new Date('2026-11-20T18:00:00.000Z'),
        shiftEndsAt: new Date('2026-11-20T21:59:00.000Z'),
        shiftText: 'Fri 20 Nov, 20:00 to 23:59',
        cause: 'RIDER',
        causeText: 'The rider switched to Offline',
        followedUpAt: null,
        followedUpByEmail: null,
      })
    })

    // Review nit (2026-11-21): a shift ending at midnight reads "24:00", as the rider's sentence does.
    describe('the end of the shift in shiftText', () => {
      it('a shift ending at Athens midnight the day after its date reads "to 24:00"', () => {
        // 20:00 to 24:00 Athens on Fri 20 Nov: it ends at 00:00 on Sat 21 Nov (22:00Z, Athens is UTC+2).
        const dto = new ShiftOfflineEventAdminDto(
          item({ shiftEndsAt: new Date('2026-11-20T22:00:00.000Z'), shiftDate: '2026-11-20' })
        )
        expect(dto.shiftText).toBe('Fri 20 Nov, 20:00 to 24:00')
        expect(dto.shiftText).toMatch(/ to 24:00$/)
        expect(dto.shiftText).not.toContain('00:00')
      })

      it('the same in summer time (Athens UTC+3)', () => {
        const dto = new ShiftOfflineEventAdminDto(
          item({
            shiftStartsAt: new Date('2026-07-17T17:00:00.000Z'),
            shiftEndsAt: new Date('2026-07-17T21:00:00.000Z'),
            shiftDate: '2026-07-17',
          })
        )
        expect(dto.shiftText).toBe('Fri 17 Jul, 20:00 to 24:00')
      })

      it('a shift ending at 23:30 reads "to 23:30"', () => {
        const dto = new ShiftOfflineEventAdminDto(item({ shiftEndsAt: new Date('2026-11-20T21:30:00.000Z') }))
        expect(dto.shiftText).toBe('Fri 20 Nov, 20:00 to 23:30')
      })

      it('a shift ending after midnight reads its clock time, not 24:00', () => {
        const dto = new ShiftOfflineEventAdminDto(item({ shiftEndsAt: new Date('2026-11-20T22:30:00.000Z') }))
        expect(dto.shiftText).toBe('Fri 20 Nov, 20:00 to 00:30')
      })

      it('a shift starting at midnight keeps "00:00" as its start', () => {
        const dto = new ShiftOfflineEventAdminDto(
          item({
            shiftStartsAt: new Date('2026-11-20T22:00:00.000Z'),
            shiftEndsAt: new Date('2026-11-21T02:00:00.000Z'),
            shiftDate: '2026-11-21',
          })
        )
        expect(dto.shiftText).toBe('Sat 21 Nov, 00:00 to 04:00')
      })
    })

    it('has exactly those fields: no count, total or rank of the rider', () => {
      const dto = new ShiftOfflineEventAdminDto({
        ...item(),
        timesThisMonth: 3,
        total: 3,
      } as unknown as OfflineEventForAdmin)
      expect(Object.keys(dto).sort()).toEqual(
        [
          'cause',
          'causeText',
          'courierId',
          'courierName',
          'followedUpAt',
          'followedUpByEmail',
          'id',
          'offlineAt',
          'offlineTime',
          'shiftDate',
          'shiftEndsAt',
          'shiftStartsAt',
          'shiftText',
        ].sort()
      )
    })

    // Row 124: carries shiftStartsAt and shiftEndsAt for client localization, keeping English shiftText word for word.
    it('carries shiftStartsAt and shiftEndsAt from the shift and keeps shiftText unchanged in English (row 124)', () => {
      const starts = new Date('2026-11-20T18:00:00.000Z')
      const ends = new Date('2026-11-20T21:59:00.000Z')
      const dto = new ShiftOfflineEventAdminDto(item({ shiftStartsAt: starts, shiftEndsAt: ends }))
      expect(dto.shiftStartsAt).toBe(starts)
      expect(dto.shiftEndsAt).toBe(ends)
      expect(dto.shiftText).toBe('Fri 20 Nov, 20:00 to 23:59')
    })

    it.each([
      ['RIDER', 'The rider switched to Offline'],
      ['ADMIN', 'An admin set the rider Offline'],
      ['CUT_OFF', "A password change ended the rider's sessions"],
      ['LAST_CALL_ACCEPTED', 'Offline after a Last Call job'],
      ['SYSTEM_START', 'Set Offline by the system'],
    ])('words the cause %s plainly', (cause, words) => {
      const dto = new ShiftOfflineEventAdminDto(item({ cause: cause as OfflineEventForAdmin['cause'] }))
      expect(dto.cause).toBe(cause)
      expect(dto.causeText).toBe(words)
    })

    it('an admin caused item carries who followed it up and when', () => {
      const dto = new ShiftOfflineEventAdminDto(
        item({
          cause: 'ADMIN',
          followedUpAt: new Date('2026-11-20T19:41:00.000Z'),
          followedUpByEmail: 'admin@example.org',
        })
      )
      expect(dto.followedUpAt).toEqual(new Date('2026-11-20T19:41:00.000Z'))
      expect(dto.followedUpByEmail).toBe('admin@example.org')
    })

    it('an item with no time or cause recorded still reads', () => {
      const dto = new ShiftOfflineEventAdminDto(item({ offlineAt: null, cause: null }))
      expect(dto.offlineTime).toBeNull()
      expect(dto.causeText).toBe('Cause not recorded')
    })
  })
})
