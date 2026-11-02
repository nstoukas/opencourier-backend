import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { EnumSosOutcome } from '@prisma/types'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { SosService } from 'src/services/sos/sos.service'
import { SosAdminRestApiController } from './sos.admin.rest-api.controller'
import {
  SosIncidentAdminDto,
  SosIncidentDetailAdminDto,
  SosIncidentPageAdminDto,
} from './dtos/sos-incident.admin.dto'
import { SosCloseAdminInput } from './queries/sos-close.admin.input'
import { SosListAdminArgs } from './queries/sos-list.admin.args'

describe('SosAdminRestApiController & Inputs (Pin 6, AC-9, AC-10)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  describe('SosCloseAdminInput validation (Pin 6, AC-10)', () => {
    test('accepts valid outcome and optional note', async () => {
      const valid = await pipe.transform(
        { outcome: EnumSosOutcome.RIDER_SAFE, note: 'Rider contacted directly' },
        { type: 'body', metatype: SosCloseAdminInput }
      )
      expect(valid.outcome).toBe(EnumSosOutcome.RIDER_SAFE)
      expect(valid.note).toBe('Rider contacted directly')
    })

    test('accepts absent or null note', async () => {
      const absentNote = await pipe.transform(
        { outcome: EnumSosOutcome.HELP_ARRIVED },
        { type: 'body', metatype: SosCloseAdminInput }
      )
      expect(absentNote.note).toBeUndefined()

      const nullNote = await pipe.transform(
        { outcome: EnumSosOutcome.FALSE_ALARM, note: null },
        { type: 'body', metatype: SosCloseAdminInput }
      )
      expect(nullNote.note).toBeNull()
    })

    test('refuses invalid outcome not in EnumSosOutcome', async () => {
      await expect(
        pipe.transform(
          { outcome: 'INVALID_OUTCOME' },
          { type: 'body', metatype: SosCloseAdminInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    test('refuses note exceeding 500 characters', async () => {
      const longNote = 'x'.repeat(501)
      await expect(
        pipe.transform(
          { outcome: EnumSosOutcome.OTHER, note: longNote },
          { type: 'body', metatype: SosCloseAdminInput }
        )
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('SosListAdminArgs validation (Pin 6, AC-9)', () => {
    test('accepts status "current" and "closed"', async () => {
      const current = await pipe.transform(
        { status: 'current' },
        { type: 'query', metatype: SosListAdminArgs }
      )
      expect(current.status).toBe('current')

      const closed = await pipe.transform(
        { status: 'closed', page: 2, limit: 25 },
        { type: 'query', metatype: SosListAdminArgs }
      )
      expect(closed.status).toBe('closed')
      expect(closed.page).toBe(2)
      expect(closed.limit).toBe(25)
    })

    test('refuses status outside "current" and "closed"', async () => {
      await expect(
        pipe.transform({ status: 'all' }, { type: 'query', metatype: SosListAdminArgs })
      ).rejects.toThrow(BadRequestException)

      await expect(
        pipe.transform({ status: 'active' }, { type: 'query', metatype: SosListAdminArgs })
      ).rejects.toThrow(BadRequestException)
    })

    test('refuses page < 1 and limit outside 1..100', async () => {
      await expect(
        pipe.transform({ status: 'closed', page: 0 }, { type: 'query', metatype: SosListAdminArgs })
      ).rejects.toThrow(BadRequestException)

      await expect(
        pipe.transform({ status: 'closed', limit: 0 }, { type: 'query', metatype: SosListAdminArgs })
      ).rejects.toThrow(BadRequestException)

      await expect(
        pipe.transform({ status: 'closed', limit: 101 }, { type: 'query', metatype: SosListAdminArgs })
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('SosAdminRestApiController endpoints & DTO mapping (Pin 6, AC-9, AC-10)', () => {
    let controller: SosAdminRestApiController
    let mockSosService: jest.Mocked<SosService>
    const sampleAdmin = { id: 'admin-user-7' } as UserEntity

    const sampleIncidentWithPeople = {
      id: 'sos-1',
      courierId: 'courier-1',
      deliveryId: null,
      startedAt: new Date('2026-11-03T10:00:00.000Z'),
      createdAt: new Date('2026-11-03T10:00:02.000Z'),
      safeAt: null,
      falseAlarmAt: null,
      closedAt: null,
      closedBy: null,
      outcome: null,
      note: null,
      pointsDeletedAt: null,
      courier: {
        id: 'courier-1',
        firstName: 'Nikos',
        lastName: 'Dimas',
      },
    } as any

    beforeEach(() => {
      mockSosService = {
        listCurrent: jest.fn().mockResolvedValue([sampleIncidentWithPeople]),
        listClosed: jest.fn().mockResolvedValue({
          data: [{ ...sampleIncidentWithPeople, closedAt: new Date(), outcome: EnumSosOutcome.RIDER_SAFE }],
          total: 25,
        }),
        findForAdmin: jest.fn().mockResolvedValue({
          incident: sampleIncidentWithPeople,
          points: [
            {
              id: 'pt-1',
              incidentId: 'sos-1',
              latitude: 39.36,
              longitude: 22.95,
              accuracyMetres: 10,
              recordedAt: new Date('2026-11-03T10:00:05.000Z'),
            },
          ],
        }),
        close: jest.fn().mockResolvedValue({
          ...sampleIncidentWithPeople,
          closedAt: new Date(),
          closedBy: { id: sampleAdmin.id, email: 'admin@coop.gr', username: 'admin' },
          outcome: EnumSosOutcome.RIDER_SAFE,
          note: 'Handled',
        }),
      } as unknown as jest.Mocked<SosService>

      controller = new SosAdminRestApiController(mockSosService)
    })

    test('list(status: "current") returns all current incidents unpaginated as array', async () => {
      const result = await controller.list({ status: 'current' })

      expect(mockSosService.listCurrent).toHaveBeenCalled()
      expect(Array.isArray(result)).toBe(true)
      const list = result as SosIncidentAdminDto[]
      expect(list).toHaveLength(1)
      expect(list[0]!.id).toBe('sos-1')
      expect(list[0]!.state).toBe('ACTIVE')
      expect(list[0]!.courier).toEqual({ id: 'courier-1', firstName: 'Nikos', lastName: 'Dimas' })
    })

    test('list(status: "closed") returns paged SosIncidentPageAdminDto with ceiling totalPages', async () => {
      // 25 total with limit 10 -> ceil(25/10) = 3 pages
      const result = (await controller.list({
        status: 'closed',
        page: 1,
        limit: 10,
      })) as SosIncidentPageAdminDto

      expect(mockSosService.listClosed).toHaveBeenCalledWith(1, 10)
      expect(result.data).toHaveLength(1)
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        totalItems: 25,
        totalPages: 3,
      })
    })

    test('list(status: "closed") uses default page 1 and limit 20 when omitted', async () => {
      await controller.list({ status: 'closed' })
      expect(mockSosService.listClosed).toHaveBeenCalledWith(1, 20)
    })

    test('findOne returns SosIncidentDetailAdminDto including trail points', async () => {
      const detail = await controller.findOne('sos-1')

      expect(mockSosService.findForAdmin).toHaveBeenCalledWith('sos-1')
      expect(detail).toBeInstanceOf(SosIncidentDetailAdminDto)
      expect(detail.id).toBe('sos-1')
      expect(detail.points).toHaveLength(1)
      expect(detail.points[0]!.latitude).toBe(39.36)
      expect(detail.points[0]!.longitude).toBe(22.95)
    })

    test('close calls sosService.close with admin id and returns SosIncidentAdminDto', async () => {
      const closeInput: SosCloseAdminInput = {
        outcome: EnumSosOutcome.RIDER_SAFE,
        note: 'All good',
      }
      const result = await controller.close('sos-1', closeInput, sampleAdmin)

      expect(mockSosService.close).toHaveBeenCalledWith(
        'sos-1',
        sampleAdmin.id,
        closeInput,
        expect.any(Date)
      )
      expect(result).toBeInstanceOf(SosIncidentAdminDto)
      expect(result.outcome).toBe(EnumSosOutcome.RIDER_SAFE)
      expect(result.note).toBe('Handled')
    })

    test('SosIncidentAdminDto NEVER carries a count of a rider’s incidents (binding value 5)', () => {
      const dto = new SosIncidentAdminDto(sampleIncidentWithPeople)

      expect(dto.courier).toEqual({ id: 'courier-1', firstName: 'Nikos', lastName: 'Dimas' })
      expect((dto as any).incidentCount).toBeUndefined()
      expect((dto as any).courierIncidentCount).toBeUndefined()
      expect((dto.courier as any).incidentCount).toBeUndefined()
      expect((dto.courier as any).sosCount).toBeUndefined()
    })
  })
})
