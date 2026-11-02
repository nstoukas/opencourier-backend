import { Logger } from '@nestjs/common'
import { EnumSosOutcome } from '@prisma/types'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { SOS_SENTENCES } from 'src/domains/sos/sos-incident-state'
import { NotFoundException, SosClosedException, SosNotActiveException } from 'src/errors'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { SosIncidentRepository } from 'src/persistence/repositories/sos-incident.repository'
import { TaskBusService } from 'src/services/taskBus/taskBus.service'
import { SosService } from './sos.service'

describe('SosService', () => {
  let service: SosService
  let mockSosIncidentRepository: jest.Mocked<SosIncidentRepository>
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>
  let mockConfigDomainService: any
  let mockBullMQService: jest.Mocked<BullMQService>
  let mockTaskBusService: jest.Mocked<TaskBusService>

  const courierId = 'courier-1'
  const incidentId = 'sos-inc-1'

  beforeEach(() => {
    mockSosIncidentRepository = {
      startOrReturn: jest.fn(),
      findById: jest.fn(),
      findActiveForCourier: jest.fn(),
      addPointsIfActive: jest.fn(),
      endByRiderIfActive: jest.fn(),
      closeIfOpen: jest.fn(),
      findCurrentWithPeople: jest.fn(),
      findClosedPageWithPeople: jest.fn(),
      findByIdWithPeople: jest.fn(),
      findPoints: jest.fn(),
      deleteOldPoints: jest.fn(),
    } as unknown as jest.Mocked<SosIncidentRepository>

    mockDeliveryRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockConfigDomainService = {
      instanceConfig: {
        getSosLocationRetentionDays: jest.fn().mockResolvedValue(30),
      },
    }

    mockBullMQService = {
      addRepeatableJob: jest.fn().mockResolvedValue(undefined as any),
    } as unknown as jest.Mocked<BullMQService>

    mockTaskBusService = {
      registerTaskHandler: jest.fn(),
    } as unknown as jest.Mocked<TaskBusService>

    service = new SosService(
      mockSosIncidentRepository,
      mockDeliveryRepository,
      mockConfigDomainService as ConfigDomainService,
      mockBullMQService,
      mockTaskBusService
    )
  })

  describe('Initialization and repeatable retention scheduling (Pin 8, AC-11)', () => {
    test('registers task handler for "sos-location-retention" on construction', () => {
      expect(mockTaskBusService.registerTaskHandler).toHaveBeenCalledWith(
        'sos-location-retention',
        expect.any(Function)
      )
    })

    test('task handler executes deleteOldPoints with current date', async () => {
      const handler = mockTaskBusService.registerTaskHandler.mock.calls[0]![1]
      const deleteSpy = jest.spyOn(service, 'deleteOldPoints').mockResolvedValue(0)

      await handler({} as any)

      expect(deleteSpy).toHaveBeenCalledWith(expect.any(Date))
      deleteSpy.mockRestore()
    })

    test('onModuleInit schedules repeatable job at 04:00 Europe/Athens', async () => {
      service.onModuleInit()

      expect(mockBullMQService.addRepeatableJob).toHaveBeenCalledWith(
        'sos-location-retention',
        {},
        '0 4 * * *',
        INSTANCE_TIMEZONE
      )
    })

    test('scheduleRetention logs error and does not throw when BullMQ fails', async () => {
      mockBullMQService.addRepeatableJob.mockRejectedValueOnce(new Error('Redis connection refused'))
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation()

      await expect(service.scheduleRetention()).resolves.toBeUndefined()
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not schedule the SOS location retention job')
      )
      errorSpy.mockRestore()
    })
  })

  describe('start (Pin 2, AC-4)', () => {
    const receivedAt = new Date('2026-11-03T10:00:10.000Z')

    test('computes startedAt as receivedAt minus tapAgeMs', async () => {
      mockSosIncidentRepository.startOrReturn.mockResolvedValueOnce({
        incident: { id: 'sos-1', courierId, startedAt: new Date('2026-11-03T10:00:05.000Z') } as any,
        created: true,
      })

      await service.start(
        courierId,
        { clientId: 'client-1', tapAgeMs: 5000 },
        receivedAt
      )

      expect(mockSosIncidentRepository.startOrReturn).toHaveBeenCalledWith({
        courierId,
        clientId: 'client-1',
        deliveryId: null,
        startedAt: new Date('2026-11-03T10:00:05.000Z'),
      })
    })

    test('uses receivedAt as startedAt when tapAgeMs is absent', async () => {
      mockSosIncidentRepository.startOrReturn.mockResolvedValueOnce({
        incident: { id: 'sos-1', courierId, startedAt: receivedAt } as any,
        created: false,
      })

      await service.start(
        courierId,
        { clientId: 'client-1' },
        receivedAt
      )

      expect(mockSosIncidentRepository.startOrReturn).toHaveBeenCalledWith({
        courierId,
        clientId: 'client-1',
        deliveryId: null,
        startedAt: receivedAt,
      })
    })

    test('throws NotFoundException with SOS_SENTENCES.deliveryNotYours when deliveryId does not exist', async () => {
      mockDeliveryRepository.findById.mockResolvedValueOnce(null)

      await expect(
        service.start(courierId, { clientId: 'client-1', deliveryId: 'del-nonexistent' }, receivedAt)
      ).rejects.toThrow(new NotFoundException(SOS_SENTENCES.deliveryNotYours))

      expect(mockSosIncidentRepository.startOrReturn).not.toHaveBeenCalled()
    })

    test('throws NotFoundException with SOS_SENTENCES.deliveryNotYours when deliveryId belongs to another rider', async () => {
      mockDeliveryRepository.findById.mockResolvedValueOnce({
        id: 'del-other',
        courierId: 'another-courier',
      } as any)

      await expect(
        service.start(courierId, { clientId: 'client-1', deliveryId: 'del-other' }, receivedAt)
      ).rejects.toThrow(new NotFoundException(SOS_SENTENCES.deliveryNotYours))

      expect(mockSosIncidentRepository.startOrReturn).not.toHaveBeenCalled()
    })

    test('passes valid deliveryId when it belongs to calling courier', async () => {
      mockDeliveryRepository.findById.mockResolvedValueOnce({
        id: 'del-own',
        courierId,
      } as any)
      mockSosIncidentRepository.startOrReturn.mockResolvedValueOnce({
        incident: { id: 'sos-1', courierId, deliveryId: 'del-own' } as any,
        created: true,
      })

      const incident = await service.start(
        courierId,
        { clientId: 'client-1', deliveryId: 'del-own' },
        receivedAt
      )

      expect(incident.deliveryId).toBe('del-own')
      expect(mockSosIncidentRepository.startOrReturn).toHaveBeenCalledWith({
        courierId,
        clientId: 'client-1',
        deliveryId: 'del-own',
        startedAt: receivedAt,
      })
    })
  })

  describe('addPoints and AC-13 privacy (Pins 4 & 9)', () => {
    const startedAt = new Date('2026-11-03T10:00:00.000Z')
    const receivedAt = new Date('2026-11-03T10:01:00.000Z')

    test('throws NotFoundException when incident is not found or belongs to another rider', async () => {
      mockSosIncidentRepository.findById.mockResolvedValueOnce(null)
      await expect(
        service.addPoints(courierId, 'sos-missing', [], receivedAt)
      ).rejects.toThrow(new NotFoundException(SOS_SENTENCES.notFound))

      mockSosIncidentRepository.findById.mockResolvedValueOnce({
        id: 'sos-other',
        courierId: 'another-courier',
      } as any)
      await expect(
        service.addPoints(courierId, 'sos-other', [], receivedAt)
      ).rejects.toThrow(new NotFoundException(SOS_SENTENCES.notFound))
    })

    test('throws SosNotActiveException (409 SOS_NOT_ACTIVE) when repository returns null', async () => {
      mockSosIncidentRepository.findById.mockResolvedValueOnce({
        id: incidentId,
        courierId,
        startedAt,
      } as any)
      mockSosIncidentRepository.addPointsIfActive.mockResolvedValueOnce(null)

      await expect(
        service.addPoints(
          courierId,
          incidentId,
          [{ latitude: 39.36, longitude: 22.95, ageMs: 5000 }],
          receivedAt
        )
      ).rejects.toThrow(SosNotActiveException)
    })

    test('converts missing accuracyMetres to null and computes recordedAt through sosPointRecordedAt', async () => {
      mockSosIncidentRepository.findById.mockResolvedValueOnce({
        id: incidentId,
        courierId,
        startedAt,
      } as any)
      mockSosIncidentRepository.addPointsIfActive.mockResolvedValueOnce(1)

      const result = await service.addPoints(
        courierId,
        incidentId,
        [{ latitude: 39.362, longitude: 22.945, ageMs: 10000 }],
        receivedAt
      )

      expect(result).toEqual({ accepted: 1 })
      expect(mockSosIncidentRepository.addPointsIfActive).toHaveBeenCalledWith(
        incidentId,
        [
          {
            latitude: 39.362,
            longitude: 22.945,
            accuracyMetres: null,
            recordedAt: new Date(receivedAt.getTime() - 10000),
          },
        ]
      )
    })

    test('Pin 9 (AC-13): logger never outputs coordinates sent during addPoints', async () => {
      mockSosIncidentRepository.findById.mockResolvedValueOnce({
        id: incidentId,
        courierId,
        startedAt,
      } as any)
      mockSosIncidentRepository.addPointsIfActive.mockResolvedValueOnce(1)

      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation()
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation()

      await service.addPoints(
        courierId,
        incidentId,
        [{ latitude: 39.362145, longitude: 22.945123, ageMs: 5000 }],
        receivedAt
      )

      const allCalls = [
        ...logSpy.mock.calls.flat(),
        ...warnSpy.mock.calls.flat(),
        ...errorSpy.mock.calls.flat(),
      ]

      for (const callArg of allCalls) {
        expect(String(callArg)).not.toContain('39.362145')
        expect(String(callArg)).not.toContain('22.945123')
      }

      logSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    })
  })

  describe('endByRider (Pin 5, AC-6)', () => {
    const startedAt = new Date('2026-11-03T10:00:00.000Z')
    const receivedAt = new Date('2026-11-03T10:02:00.000Z')

    test('throws NotFoundException when incident is not found or belongs to another rider', async () => {
      mockSosIncidentRepository.findById.mockResolvedValueOnce(null)
      await expect(
        service.endByRider(courierId, 'missing', 'safe', undefined, receivedAt)
      ).rejects.toThrow(NotFoundException)

      mockSosIncidentRepository.findById.mockResolvedValueOnce({
        id: 'other',
        courierId: 'someone-else',
      } as any)
      await expect(
        service.endByRider(courierId, 'other', 'safe', undefined, receivedAt)
      ).rejects.toThrow(NotFoundException)
    })

    test('throws SosClosedException (409) when incident is already closed', async () => {
      mockSosIncidentRepository.findById.mockResolvedValueOnce({
        id: incidentId,
        courierId,
        closedAt: new Date('2026-11-03T10:01:00.000Z'),
      } as any)

      await expect(
        service.endByRider(courierId, incidentId, 'safe', undefined, receivedAt)
      ).rejects.toThrow(SosClosedException)

      expect(mockSosIncidentRepository.endByRiderIfActive).not.toHaveBeenCalled()
    })

    test('returns incident unchanged and performs no write when already safe or false alarm', async () => {
      const alreadySafe = {
        id: incidentId,
        courierId,
        startedAt,
        safeAt: new Date('2026-11-03T10:01:00.000Z'),
        falseAlarmAt: null,
        closedAt: null,
      } as any
      mockSosIncidentRepository.findById.mockResolvedValueOnce(alreadySafe)

      const result = await service.endByRider(courierId, incidentId, 'falseAlarm', undefined, receivedAt)

      expect(result).toBe(alreadySafe)
      expect(mockSosIncidentRepository.endByRiderIfActive).not.toHaveBeenCalled()
    })

    test('updates safeAt with tap time and returns updated incident on success', async () => {
      mockSosIncidentRepository.findById.mockResolvedValueOnce({
        id: incidentId,
        courierId,
        startedAt,
        safeAt: null,
        falseAlarmAt: null,
        closedAt: null,
      } as any)
      mockSosIncidentRepository.endByRiderIfActive.mockResolvedValueOnce(true)
      const after = {
        id: incidentId,
        courierId,
        safeAt: new Date(receivedAt.getTime() - 2000),
      } as any
      mockSosIncidentRepository.findById.mockResolvedValueOnce(after)

      const result = await service.endByRider(courierId, incidentId, 'safe', 2000, receivedAt)

      expect(result).toBe(after)
      expect(mockSosIncidentRepository.endByRiderIfActive).toHaveBeenCalledWith(
        incidentId,
        'safeAt',
        new Date(receivedAt.getTime() - 2000)
      )
    })

    test('throws SosClosedException when lost race with an admin close', async () => {
      mockSosIncidentRepository.findById.mockResolvedValueOnce({
        id: incidentId,
        courierId,
        startedAt,
        safeAt: null,
        falseAlarmAt: null,
        closedAt: null,
      } as any)
      mockSosIncidentRepository.endByRiderIfActive.mockResolvedValueOnce(false)
      mockSosIncidentRepository.findById.mockResolvedValueOnce({
        id: incidentId,
        courierId,
        closedAt: new Date(),
      } as any)

      await expect(
        service.endByRider(courierId, incidentId, 'safe', 1000, receivedAt)
      ).rejects.toThrow(SosClosedException)
    })
  })

  describe('close (Pin 6, AC-10)', () => {
    const adminUserId = 'admin-user-42'
    const now = new Date('2026-11-03T10:15:00.000Z')

    test('throws NotFoundException when incident does not exist', async () => {
      mockSosIncidentRepository.findById.mockResolvedValueOnce(null)

      await expect(
        service.close('missing', adminUserId, { outcome: EnumSosOutcome.RIDER_SAFE }, now)
      ).rejects.toThrow(NotFoundException)
    })

    test('trims whitespace note to null, stores valid note, and records admin details', async () => {
      mockSosIncidentRepository.findById.mockResolvedValueOnce({ id: incidentId } as any)
      mockSosIncidentRepository.closeIfOpen.mockResolvedValueOnce(true)
      const closedIncident = {
        id: incidentId,
        closedAt: now,
        closedByUserId: adminUserId,
        outcome: EnumSosOutcome.RIDER_SAFE,
        note: null,
      } as any
      mockSosIncidentRepository.findByIdWithPeople.mockResolvedValueOnce(closedIncident)

      // Test with whitespace-only note
      const res1 = await service.close(
        incidentId,
        adminUserId,
        { outcome: EnumSosOutcome.RIDER_SAFE, note: '   ' },
        now
      )

      expect(res1).toBe(closedIncident)
      expect(mockSosIncidentRepository.closeIfOpen).toHaveBeenCalledWith(incidentId, {
        closedAt: now,
        closedByUserId: adminUserId,
        outcome: EnumSosOutcome.RIDER_SAFE,
        note: null,
      })
    })

    test('throws SosClosedException (409) when incident was already closed (closeIfOpen returns false)', async () => {
      mockSosIncidentRepository.findById.mockResolvedValueOnce({ id: incidentId } as any)
      mockSosIncidentRepository.closeIfOpen.mockResolvedValueOnce(false)

      await expect(
        service.close(
          incidentId,
          adminUserId,
          { outcome: EnumSosOutcome.HELP_ARRIVED, note: 'Arrived' },
          now
        )
      ).rejects.toThrow(SosClosedException)
    })
  })

  describe('deleteOldPoints (Pin 8, AC-11)', () => {
    test('computes cutoff as now minus days*24h and delegates to repository', async () => {
      mockConfigDomainService.instanceConfig.getSosLocationRetentionDays.mockResolvedValueOnce(30)
      mockSosIncidentRepository.deleteOldPoints.mockResolvedValueOnce(5)
      const now = new Date('2026-11-03T04:00:00.000Z')
      const expectedCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

      const deleted = await service.deleteOldPoints(now)

      expect(deleted).toBe(5)
      expect(mockSosIncidentRepository.deleteOldPoints).toHaveBeenCalledWith(expectedCutoff, now)
    })
  })
})
