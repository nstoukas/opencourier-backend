import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { SosService } from 'src/services/sos/sos.service'
import { SosCourierRestApiController } from './sos.courier.rest-api.controller'
import { SosIncidentCourierDto } from './dtos/sos-incident.courier.dto'
import {
  SOS_POINTS_PER_REQUEST_MAX,
  SosPointCourierInput,
  SosPointsCourierInput,
} from './queries/sos-points.courier.input'
import { SosStartCourierInput } from './queries/sos-start.courier.input'

describe('SosCourierRestApiController & Inputs (Pins 3, 4, 5, 6)', () => {
  // Global pipe options as configured in NestJS main.ts
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  describe('SosStartCourierInput validation (Pin 3, AC-4)', () => {
    test('accepts valid clientId (8 to 64 chars of [A-Za-z0-9_-]), optional deliveryId, and tapAgeMs', async () => {
      const validPayload = {
        clientId: 'Sos_Client-1234',
        deliveryId: 'del-1',
        tapAgeMs: 3000,
      }

      const instance = await pipe.transform(validPayload, {
        type: 'body',
        metatype: SosStartCourierInput,
      })
      expect(instance.clientId).toBe('Sos_Client-1234')
      expect(instance.deliveryId).toBe('del-1')
      expect(instance.tapAgeMs).toBe(3000)
    })

    test('refuses clientId shorter than 8 chars ("x")', async () => {
      await expect(
        pipe.transform({ clientId: 'x' }, { type: 'body', metatype: SosStartCourierInput })
      ).rejects.toThrow(BadRequestException)
    })

    test('refuses clientId longer than 64 chars', async () => {
      const tooLong = 'a'.repeat(65)
      await expect(
        pipe.transform({ clientId: tooLong }, { type: 'body', metatype: SosStartCourierInput })
      ).rejects.toThrow(BadRequestException)
    })

    test('refuses clientId with disallowed characters ("a b c d e", spaces, symbols)', async () => {
      await expect(
        pipe.transform({ clientId: 'a b c d e' }, { type: 'body', metatype: SosStartCourierInput })
      ).rejects.toThrow(BadRequestException)

      await expect(
        pipe.transform({ clientId: 'client@123!' }, { type: 'body', metatype: SosStartCourierInput })
      ).rejects.toThrow(BadRequestException)
    })

    test('accepts deliveryId absent, but refuses deliveryId when explicitly sent as null', async () => {
      const absentResult = await pipe.transform(
        { clientId: 'valid-client-id' },
        { type: 'body', metatype: SosStartCourierInput }
      )
      expect(absentResult.deliveryId).toBeUndefined()

      await expect(
        pipe.transform(
          { clientId: 'valid-client-id', deliveryId: null },
          { type: 'body', metatype: SosStartCourierInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    test('refuses tapAgeMs when not sent as a JSON number ("5", true, false, "")', async () => {
      for (const badValue of ['5', true, false, '']) {
        await expect(
          pipe.transform(
            { clientId: 'valid-client-id', tapAgeMs: badValue },
            { type: 'body', metatype: SosStartCourierInput }
          )
        ).rejects.toThrow(BadRequestException)
      }
    })

    test('refuses negative tapAgeMs (-1) and tapAgeMs exceeding 7 days (604800001)', async () => {
      await expect(
        pipe.transform(
          { clientId: 'valid-client-id', tapAgeMs: -1 },
          { type: 'body', metatype: SosStartCourierInput }
        )
      ).rejects.toThrow(BadRequestException)

      await expect(
        pipe.transform(
          { clientId: 'valid-client-id', tapAgeMs: 604800001 },
          { type: 'body', metatype: SosStartCourierInput }
        )
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('SosPointsCourierInput validation and AC-13 error leak protection (Pin 3)', () => {
    const validPoint = {
      latitude: 39.362,
      longitude: 22.945,
      accuracyMetres: 15,
      ageMs: 5000,
    }

    test('accepts 1 to 120 points', async () => {
      const onePoint = await pipe.transform(
        { points: [validPoint] },
        { type: 'body', metatype: SosPointsCourierInput }
      )
      expect(onePoint.points).toHaveLength(1)

      const maxPoints = Array.from({ length: SOS_POINTS_PER_REQUEST_MAX }, () => ({ ...validPoint }))
      const maxResult = await pipe.transform(
        { points: maxPoints },
        { type: 'body', metatype: SosPointsCourierInput }
      )
      expect(maxResult.points).toHaveLength(120)
    })

    test('refuses empty points array (0 points)', async () => {
      await expect(
        pipe.transform({ points: [] }, { type: 'body', metatype: SosPointsCourierInput })
      ).rejects.toThrow(BadRequestException)
    })

    test('refuses more than 120 points (121 points)', async () => {
      const tooMany = Array.from({ length: 121 }, () => ({ ...validPoint }))
      await expect(
        pipe.transform({ points: tooMany }, { type: 'body', metatype: SosPointsCourierInput })
      ).rejects.toThrow(BadRequestException)
    })

    test('refuses coordinates sent as strings ("39.1")', async () => {
      await expect(
        pipe.transform(
          { points: [{ ...validPoint, latitude: '39.1' }] },
          { type: 'body', metatype: SosPointsCourierInput }
        )
      ).rejects.toThrow(BadRequestException)

      await expect(
        pipe.transform(
          { points: [{ ...validPoint, longitude: '22.9' }] },
          { type: 'body', metatype: SosPointsCourierInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    test('refuses out-of-range coordinates (latitude > 90 or < -90, longitude > 180 or < -180)', async () => {
      await expect(
        pipe.transform(
          { points: [{ ...validPoint, latitude: 90.001 }] },
          { type: 'body', metatype: SosPointsCourierInput }
        )
      ).rejects.toThrow(BadRequestException)

      await expect(
        pipe.transform(
          { points: [{ ...validPoint, latitude: -90.001 }] },
          { type: 'body', metatype: SosPointsCourierInput }
        )
      ).rejects.toThrow(BadRequestException)

      await expect(
        pipe.transform(
          { points: [{ ...validPoint, longitude: 180.001 }] },
          { type: 'body', metatype: SosPointsCourierInput }
        )
      ).rejects.toThrow(BadRequestException)

      await expect(
        pipe.transform(
          { points: [{ ...validPoint, longitude: -180.001 }] },
          { type: 'body', metatype: SosPointsCourierInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    test('refuses invalid accuracyMetres (< 0 or > 100000)', async () => {
      await expect(
        pipe.transform(
          { points: [{ ...validPoint, accuracyMetres: -1 }] },
          { type: 'body', metatype: SosPointsCourierInput }
        )
      ).rejects.toThrow(BadRequestException)

      await expect(
        pipe.transform(
          { points: [{ ...validPoint, accuracyMetres: 100001 }] },
          { type: 'body', metatype: SosPointsCourierInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    test('refuses ageMs when negative or exceeding 7 days', async () => {
      await expect(
        pipe.transform(
          { points: [{ ...validPoint, ageMs: -1 }] },
          { type: 'body', metatype: SosPointsCourierInput }
        )
      ).rejects.toThrow(BadRequestException)

      await expect(
        pipe.transform(
          { points: [{ ...validPoint, ageMs: 604800001 }] },
          { type: 'body', metatype: SosPointsCourierInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    test('validation error message NEVER contains the sensitive coordinate value sent (AC-13)', async () => {
      const sensitiveLatitude = 91.123456
      const sensitiveLongitude = 195.654321

      try {
        await pipe.transform(
          { points: [{ ...validPoint, latitude: sensitiveLatitude, longitude: sensitiveLongitude }] },
          { type: 'body', metatype: SosPointsCourierInput }
        )
        fail('Expected validation pipe to throw BadRequestException')
      } catch (err: any) {
        expect(err).toBeInstanceOf(BadRequestException)
        const response = err.getResponse()
        const messages = Array.isArray(response.message) ? response.message.join(' ') : String(response.message)

        expect(messages).not.toContain(String(sensitiveLatitude))
        expect(messages).not.toContain(String(sensitiveLongitude))
      }
    })
  })

  describe('SosCourierRestApiController endpoints & SosIncidentCourierDto (Pins 4, 5, 6)', () => {
    let controller: SosCourierRestApiController
    let mockSosService: jest.Mocked<SosService>
    const sampleCourier = { id: 'courier-1' } as CourierEntity

    const sampleIncident = {
      id: 'sos-1',
      courierId: 'courier-1',
      deliveryId: 'del-1',
      startedAt: new Date('2026-11-03T10:00:00.000Z'),
      safeAt: null,
      falseAlarmAt: null,
      closedAt: null,
      closedByUserId: 'admin-1',
      outcome: 'RIDER_SAFE' as any,
      note: 'Admin closed',
    } as any

    beforeEach(() => {
      mockSosService = {
        start: jest.fn().mockResolvedValue(sampleIncident),
        findActive: jest.fn().mockResolvedValue(sampleIncident),
        addPoints: jest.fn().mockResolvedValue({ accepted: 3 }),
        endByRider: jest.fn().mockResolvedValue(sampleIncident),
      } as unknown as jest.Mocked<SosService>

      controller = new SosCourierRestApiController(mockSosService)
    })

    test('start delegates to sosService.start and returns SosIncidentCourierDto', async () => {
      const body: SosStartCourierInput = { clientId: 'client-uuid-1', deliveryId: 'del-1', tapAgeMs: 2000 }
      const res = await controller.start(body, sampleCourier)

      expect(mockSosService.start).toHaveBeenCalledWith(
        sampleCourier.id,
        body,
        expect.any(Date)
      )
      expect(res).toBeInstanceOf(SosIncidentCourierDto)
      expect(res.id).toBe('sos-1')
      expect(res.state).toBe('ACTIVE')
    })

    test('active delegates to sosService.findActive and returns DTO or null', async () => {
      const activeDto = await controller.active(sampleCourier)
      expect(activeDto).toBeInstanceOf(SosIncidentCourierDto)
      expect(mockSosService.findActive).toHaveBeenCalledWith(sampleCourier.id)

      mockSosService.findActive.mockResolvedValueOnce(null)
      const nullDto = await controller.active(sampleCourier)
      expect(nullDto).toBeNull()
    })

    test('points delegates to sosService.addPoints and returns accepted count', async () => {
      const body: SosPointsCourierInput = { points: [{ latitude: 39, longitude: 22, ageMs: 1000 }] }
      const res = await controller.points('sos-1', body, sampleCourier)

      expect(mockSosService.addPoints).toHaveBeenCalledWith(
        sampleCourier.id,
        'sos-1',
        body.points,
        expect.any(Date)
      )
      expect(res).toEqual({ accepted: 3 })
    })

    test('safe delegates to sosService.endByRider with how "safe"', async () => {
      const res = await controller.safe('sos-1', { tapAgeMs: 500 }, sampleCourier)

      expect(mockSosService.endByRider).toHaveBeenCalledWith(
        sampleCourier.id,
        'sos-1',
        'safe',
        500,
        expect.any(Date)
      )
      expect(res).toBeInstanceOf(SosIncidentCourierDto)
    })

    test('falseAlarm delegates to sosService.endByRider with how "falseAlarm"', async () => {
      const res = await controller.falseAlarm('sos-1', { tapAgeMs: 1500 }, sampleCourier)

      expect(mockSosService.endByRider).toHaveBeenCalledWith(
        sampleCourier.id,
        'sos-1',
        'falseAlarm',
        1500,
        expect.any(Date)
      )
      expect(res).toBeInstanceOf(SosIncidentCourierDto)
    })

    test('SosIncidentCourierDto NEVER exposes note, outcome, closedBy, or closedByUserId (Pin 6)', () => {
      const dto = new SosIncidentCourierDto(sampleIncident)

      expect((dto as any).note).toBeUndefined()
      expect((dto as any).outcome).toBeUndefined()
      expect((dto as any).closedBy).toBeUndefined()
      expect((dto as any).closedByUserId).toBeUndefined()

      expect(dto.id).toBe('sos-1')
      expect(dto.state).toBe('ACTIVE')
      expect(dto.deliveryId).toBe('del-1')
      expect(dto.startedAt).toEqual(sampleIncident.startedAt)
    })
  })
})
