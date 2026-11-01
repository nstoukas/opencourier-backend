import { ConflictException } from '@nestjs/common'
import {
  DispatchStop,
  EnumCourierCompensationReason,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumDispatchStopReason,
  EnumEventActor,
} from '@prisma/types'
import { DispatchStopService } from './dispatch-stop.service'
import { BadRequestException, NotFoundException } from 'src/errors'
import { dayjs } from 'src/core/utils/time'
import { INSTANCE_TIMEZONE } from 'src/constants'

describe('DispatchStopService (Spec 0014, AC-1, AC-2, AC-3, AC-5, AC-10, AC-11)', () => {
  let service: DispatchStopService

  let mockDispatchStopRepository: any
  let mockDeliveryRepository: any
  let mockDeliveryEventService: any
  let mockCourierCompensationRepository: any
  let mockConfigDomainService: any
  let mockBullMQService: any
  let mockTaskBusService: any

  const adminUserId = 'admin-user-1'

  beforeEach(() => {
    mockDispatchStopRepository = {
      createIfNoOverlap: jest.fn(),
      findById: jest.fn(),
      endOrCancel: jest.fn(),
      findOn: jest.fn().mockResolvedValue(null),
      findScheduled: jest.fn().mockResolvedValue([]),
      findHistory: jest.fn().mockResolvedValue([]),
      findDueToStart: jest.fn().mockResolvedValue([]),
      findDueToEnd: jest.fn().mockResolvedValue([]),
      markStarted: jest.fn().mockResolvedValue(true),
      markEndWorkDone: jest.fn().mockResolvedValue(true),
    }

    mockDeliveryRepository = {
      findAllHeldBeforePickup: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      countOpenOffersAndHeldBeforePickup: jest.fn().mockResolvedValue({ offersToEnd: 1, deliveriesToReturn: 2 }),
    }

    mockDeliveryEventService = {
      endAllOpenOffersForDispatchStop: jest.fn().mockResolvedValue(1),
      matchAllWaitingDeliveriesAfterStop: jest.fn().mockResolvedValue(undefined),
      processDeliveryEvent: jest.fn().mockResolvedValue(undefined),
      returnToWaitingForDispatchStop: jest.fn().mockResolvedValue({
        returned: true,
        totalCompensation: 800,
        currencyCode: 'EUR',
      }),
    }

    mockCourierCompensationRepository = {
      create: jest.fn().mockResolvedValue({ id: 'comp-1' }),
    }

    mockConfigDomainService = {
      instanceConfig: {
        getReassignmentPayoutPolicies: jest.fn().mockResolvedValue({
          FULL_COMPENSATION: 100,
          NO_COMPENSATION: 0,
        }),
        getReassignmentPayoutDefaultPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
      },
    }

    mockBullMQService = {
      addRepeatableJob: jest.fn().mockResolvedValue(undefined),
    }

    mockTaskBusService = {
      registerTaskHandler: jest.fn(),
    }

    service = new DispatchStopService(
      mockDispatchStopRepository,
      mockDeliveryRepository,
      mockDeliveryEventService,
      mockCourierCompensationRepository,
      mockConfigDomainService,
      mockBullMQService,
      mockTaskBusService
    )
  })

  describe('create (AC-1, AC-2)', () => {
    test('stop now (no startsOn) runs startWork inline with actor ADMIN before returning', async () => {
      const createdStop: DispatchStop = {
        id: 'stop-now-1',
        reason: EnumDispatchStopReason.HEAT,
        startsAt: new Date(),
        endsAt: null,
        startedAt: null,
        endedAt: null,
        cancelledAt: null,
        createdByUserId: adminUserId,
        createdAt: new Date(),
        endedByUserId: null,
        cancelledByUserId: null,
        endWorkDoneAt: null,
      }
      mockDispatchStopRepository.createIfNoOverlap.mockResolvedValue(createdStop)
      mockDispatchStopRepository.findById.mockResolvedValue({ ...createdStop, startedAt: new Date() })

      const result = await service.create({ reason: EnumDispatchStopReason.HEAT }, adminUserId)

      expect(mockDispatchStopRepository.createIfNoOverlap).toHaveBeenCalledWith(
        expect.objectContaining({ reason: EnumDispatchStopReason.HEAT }),
        { stopNow: true }
      )
      // startWork ran inline!
      expect(mockDispatchStopRepository.markStarted).toHaveBeenCalledWith('stop-now-1', expect.any(Date))
      expect(mockDeliveryEventService.endAllOpenOffersForDispatchStop).toHaveBeenCalledWith('Ended: dispatch stopped (heat)')
      expect(result.id).toBe('stop-now-1')
    })

    test('scheduled stop requires startsOn in the future and an endsOn', async () => {
      // Past startsOn
      await expect(
        service.create(
          {
            reason: EnumDispatchStopReason.STORM,
            startsOn: { date: '2020-01-01', time: '12:00' },
            endsOn: { date: '2020-01-01', time: '17:00' },
          },
          adminUserId
        )
      ).rejects.toThrow(new BadRequestException('A scheduled stop must start in the future.'))

      // Missing endsOn
      const futureDate = dayjs().add(2, 'day').format('YYYY-MM-DD')
      await expect(
        service.create(
          {
            reason: EnumDispatchStopReason.STORM,
            startsOn: { date: futureDate, time: '12:00' },
          },
          adminUserId
        )
      ).rejects.toThrow(new BadRequestException('A scheduled stop needs an end time.'))
    })

    test('refuses end before start', async () => {
      const futureDate = dayjs().add(2, 'day').format('YYYY-MM-DD')
      await expect(
        service.create(
          {
            reason: EnumDispatchStopReason.HEAT,
            startsOn: { date: futureDate, time: '15:00' },
            endsOn: { date: futureDate, time: '12:00' },
          },
          adminUserId
        )
      ).rejects.toThrow(new BadRequestException('The end must come after the start.'))
    })

    test('refuses nonexistent Athens time with 400 naming start or end', async () => {
      // 2027-03-28 03:30 is the skipped spring forward hour
      await expect(
        service.create(
          {
            reason: EnumDispatchStopReason.HEAT,
            startsOn: { date: '2027-03-28', time: '03:30' },
            endsOn: { date: '2027-03-28', time: '05:00' },
          },
          adminUserId
        )
      ).rejects.toThrow(new BadRequestException('The start time does not exist in Athens time.'))

      const futureDate = dayjs().add(2, 'day').format('YYYY-MM-DD')
      await expect(
        service.create(
          {
            reason: EnumDispatchStopReason.HEAT,
            startsOn: { date: futureDate, time: '12:00' },
            endsOn: { date: '2027-03-28', time: '03:30' },
          },
          adminUserId
        )
      ).rejects.toThrow(new BadRequestException('The end time does not exist in Athens time.'))
    })

    test('stop now (no startsOn) calls createIfNoOverlap with { stopNow: true } and throws 409 naming restart when repository returns null (Decision 29.6)', async () => {
      mockDispatchStopRepository.createIfNoOverlap.mockResolvedValue(null)

      await expect(
        service.create({ reason: EnumDispatchStopReason.HEAT }, adminUserId)
      ).rejects.toThrow(new ConflictException('Dispatch is already stopped. Restart it first, or change that stop.'))

      expect(mockDispatchStopRepository.createIfNoOverlap).toHaveBeenCalledWith(
        expect.objectContaining({ reason: EnumDispatchStopReason.HEAT }),
        { stopNow: true }
      )
    })

    test('scheduled stop (with startsOn) calls createIfNoOverlap with { stopNow: false } and throws 409 naming time overlap when repository returns null (Decision 29.6)', async () => {
      mockDispatchStopRepository.createIfNoOverlap.mockResolvedValue(null)
      const futureDate = dayjs().add(2, 'day').format('YYYY-MM-DD')

      await expect(
        service.create(
          {
            reason: EnumDispatchStopReason.STORM,
            startsOn: { date: futureDate, time: '12:00' },
            endsOn: { date: futureDate, time: '17:00' },
          },
          adminUserId
        )
      ).rejects.toThrow(new ConflictException('Another dispatch stop already covers part of that time.'))

      expect(mockDispatchStopRepository.createIfNoOverlap).toHaveBeenCalledWith(
        expect.objectContaining({ reason: EnumDispatchStopReason.STORM }),
        { stopNow: false }
      )
    })

    test('scheduled stop does NOT run startWork inline', async () => {
      const futureDate = dayjs().add(2, 'day').format('YYYY-MM-DD')
      const scheduledStop: DispatchStop = {
        id: 'stop-sched-1',
        reason: EnumDispatchStopReason.STORM,
        startsAt: new Date('2026-08-01T12:00:00Z'),
        endsAt: new Date('2026-08-01T17:00:00Z'),
        startedAt: null,
        endedAt: null,
        cancelledAt: null,
        createdByUserId: adminUserId,
        createdAt: new Date(),
        endedByUserId: null,
        cancelledByUserId: null,
        endWorkDoneAt: null,
      }
      mockDispatchStopRepository.createIfNoOverlap.mockResolvedValue(scheduledStop)
      mockDispatchStopRepository.findById.mockResolvedValue(scheduledStop)

      const result = await service.create(
        {
          reason: EnumDispatchStopReason.STORM,
          startsOn: { date: futureDate, time: '12:00' },
          endsOn: { date: futureDate, time: '17:00' },
        },
        adminUserId
      )

      expect(mockDispatchStopRepository.createIfNoOverlap).toHaveBeenCalledWith(
        expect.objectContaining({ reason: EnumDispatchStopReason.STORM }),
        { stopNow: false }
      )
      expect(mockDispatchStopRepository.markStarted).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.endAllOpenOffersForDispatchStop).not.toHaveBeenCalled()
      expect(result.id).toBe('stop-sched-1')
    })
  })

  describe('endOrCancel (AC-2, AC-3)', () => {
    test('throws 404 NotFoundException when stop does not exist', async () => {
      mockDispatchStopRepository.findById.mockResolvedValue(null)

      await expect(service.endOrCancel('missing-id', adminUserId)).rejects.toThrow(
        new NotFoundException('Dispatch stop not found')
      )
    })

    test('throws 409 ConflictException when repository returns null (already ended or cancelled)', async () => {
      mockDispatchStopRepository.findById.mockResolvedValue({ id: 'stop-1' })
      mockDispatchStopRepository.endOrCancel.mockResolvedValue(null)

      await expect(service.endOrCancel('stop-1', adminUserId)).rejects.toThrow(
        new ConflictException('This dispatch stop has already ended or been cancelled.')
      )
    })

    test('a restart (stop has endedAt) runs endWork inline', async () => {
      const stoppedStop: DispatchStop = {
        id: 'stop-restarted',
        reason: EnumDispatchStopReason.HEAT,
        startsAt: new Date(),
        endsAt: null,
        startedAt: new Date(),
        endedAt: new Date(),
        cancelledAt: null,
        createdByUserId: adminUserId,
        createdAt: new Date(),
        endedByUserId: adminUserId,
        cancelledByUserId: null,
        endWorkDoneAt: null,
      }
      mockDispatchStopRepository.findById
        .mockResolvedValueOnce({ id: 'stop-restarted' }) // initial check
        .mockResolvedValueOnce({ ...stoppedStop, endWorkDoneAt: new Date() }) // reload check
      mockDispatchStopRepository.endOrCancel.mockResolvedValue(stoppedStop)

      await service.endOrCancel('stop-restarted', adminUserId)

      // endWork ran inline!
      expect(mockDispatchStopRepository.markEndWorkDone).toHaveBeenCalledWith('stop-restarted', expect.any(Date))
      expect(mockDeliveryEventService.matchAllWaitingDeliveriesAfterStop).toHaveBeenCalled()
    })

    test('a cancel (stop has cancelledAt) does NOT run endWork', async () => {
      const cancelledStop: DispatchStop = {
        id: 'stop-cancelled',
        reason: EnumDispatchStopReason.HEAT,
        startsAt: new Date('2026-08-01T12:00:00Z'),
        endsAt: new Date('2026-08-01T17:00:00Z'),
        startedAt: null,
        endedAt: null,
        cancelledAt: new Date(),
        createdByUserId: adminUserId,
        createdAt: new Date(),
        endedByUserId: null,
        cancelledByUserId: adminUserId,
        endWorkDoneAt: null,
      }
      mockDispatchStopRepository.findById
        .mockResolvedValueOnce({ id: 'stop-cancelled' })
        .mockResolvedValueOnce(cancelledStop)
      mockDispatchStopRepository.endOrCancel.mockResolvedValue(cancelledStop)

      await service.endOrCancel('stop-cancelled', adminUserId)

      expect(mockDispatchStopRepository.markEndWorkDone).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.matchAllWaitingDeliveriesAfterStop).not.toHaveBeenCalled()
    })
  })

  describe('startWork order, payout and idempotency (AC-5, AC-11, Decision 29.5)', () => {
    const testStop: DispatchStop = {
      id: 'stop-sw',
      reason: EnumDispatchStopReason.HEAT,
      startsAt: new Date(),
      endsAt: null,
      startedAt: null,
      endedAt: null,
      cancelledAt: null,
      createdByUserId: adminUserId,
      createdAt: new Date(),
      endedByUserId: null,
      cancelledByUserId: null,
      endWorkDoneAt: null,
    }

    test('ends open offers FIRST, returns held deliveries, and only THEN marks startedAt (AC-11)', async () => {
      const executionOrder: string[] = []

      mockDeliveryEventService.endAllOpenOffersForDispatchStop.mockImplementation(async () => {
        executionOrder.push('endOffers')
        return 1
      })
      mockDeliveryRepository.findAllHeldBeforePickup.mockImplementation(async () => {
        executionOrder.push('readHeld')
        return [{ id: 'del-return-1', courierId: 'courier-dropped' }]
      })
      mockDeliveryEventService.returnToWaitingForDispatchStop.mockImplementation(async () => {
        executionOrder.push('returnDelivery')
        return { returned: true, totalCompensation: 800, currencyCode: 'EUR' }
      })
      mockDispatchStopRepository.markStarted.mockImplementation(async () => {
        executionOrder.push('markStarted')
        return true
      })

      await service.startWork(testStop, EnumEventActor.ADMIN)

      // Work runs first and is marked AFTER, so crashes halfway can retry
      expect(executionOrder).toEqual(['endOffers', 'readHeld', 'returnDelivery', 'markStarted'])
      expect(mockDispatchStopRepository.markStarted).toHaveBeenCalledWith(testStop.id, expect.any(Date))
    })

    test('when start work throws halfway, startedAt is not marked so the next tick retries (AC-11)', async () => {
      mockDeliveryEventService.endAllOpenOffersForDispatchStop.mockResolvedValue(1)
      mockDeliveryRepository.findAllHeldBeforePickup.mockRejectedValue(new Error('DB failure halfway'))

      await expect(service.startWork(testStop, EnumEventActor.ADMIN)).rejects.toThrow('DB failure halfway')

      // startedAt is NOT marked if work failed halfway!
      expect(mockDispatchStopRepository.markStarted).not.toHaveBeenCalled()
    })

    test('a stop already started (startedAt set) does nothing (idempotent) (AC-11)', async () => {
      const alreadyStartedStop: DispatchStop = {
        ...testStop,
        startedAt: new Date(),
      }

      await service.startWork(alreadyStartedStop, EnumEventActor.ADMIN)

      expect(mockDeliveryEventService.endAllOpenOffersForDispatchStop).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.findAllHeldBeforePickup).not.toHaveBeenCalled()
      expect(mockDispatchStopRepository.markStarted).not.toHaveBeenCalled()
    })

    test('pays dropped rider only when returnToWaitingForDispatchStop returned true, from its totalCompensation and currencyCode (AC-5)', async () => {
      mockDeliveryEventService.endAllOpenOffersForDispatchStop.mockResolvedValue(0)

      const heldDelivery = {
        id: 'del-return-1',
        courierId: 'courier-dropped',
      }
      mockDeliveryRepository.findAllHeldBeforePickup.mockResolvedValue([heldDelivery])
      mockDeliveryEventService.returnToWaitingForDispatchStop.mockResolvedValue({
        returned: true,
        totalCompensation: 800,
        currencyCode: 'EUR',
      })

      const callOrder: string[] = []
      mockDeliveryEventService.returnToWaitingForDispatchStop.mockImplementation(async () => {
        callOrder.push('returnToWaiting')
        return { returned: true, totalCompensation: 800, currencyCode: 'EUR' }
      })
      mockCourierCompensationRepository.create.mockImplementation(async () => {
        callOrder.push('payCourier')
        return { id: 'comp-1' }
      })

      await service.startWork(testStop, EnumEventActor.ADMIN)

      expect(callOrder).toEqual(['returnToWaiting', 'payCourier'])
      expect(mockDeliveryEventService.returnToWaitingForDispatchStop).toHaveBeenCalledWith(
        'del-return-1',
        'courier-dropped',
        EnumEventActor.ADMIN,
        'Dispatch stopped (heat)'
      )
      expect(mockCourierCompensationRepository.create).toHaveBeenCalledWith({
        amount: 800,
        currencyCode: 'EUR',
        reason: EnumCourierCompensationReason.REASSIGNMENT,
        policy: 'FULL_COMPENSATION',
        message: 'Dispatch stopped (heat): delivery returned to waiting',
        courierId: 'courier-dropped',
        deliveryId: 'del-return-1',
      })
    })

    test('when return was refused (e.g. pickup won race and returned is false), no payment is written (AC-5)', async () => {
      mockDeliveryEventService.endAllOpenOffersForDispatchStop.mockResolvedValue(0)

      mockDeliveryRepository.findAllHeldBeforePickup.mockResolvedValue([
        { id: 'del-pickup-won', courierId: 'courier-1' },
      ])
      mockDeliveryEventService.returnToWaitingForDispatchStop.mockResolvedValue({ returned: false })

      await service.startWork(testStop, EnumEventActor.SYSTEM)

      expect(mockCourierCompensationRepository.create).not.toHaveBeenCalled()
    })

    test('two runs over the same delivery write one payment (AC-5)', async () => {
      mockDeliveryEventService.endAllOpenOffersForDispatchStop.mockResolvedValue(0)

      const heldDelivery = {
        id: 'del-return-1',
        courierId: 'courier-1',
      }
      mockDeliveryRepository.findAllHeldBeforePickup.mockResolvedValue([heldDelivery])
      // Even if findById returns ASSIGNING_COURIER with no courier on both runs, it must not pay from a post-read
      mockDeliveryRepository.findById.mockResolvedValue({
        id: 'del-return-1',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        totalCompensation: 800,
        currencyCode: 'EUR',
      })

      // Run 1: return succeeds
      mockDeliveryEventService.returnToWaitingForDispatchStop.mockResolvedValueOnce({
        returned: true,
        totalCompensation: 800,
        currencyCode: 'EUR',
      })
      await service.startWork(testStop, EnumEventActor.ADMIN)

      // Run 2: return misses because delivery is already ASSIGNING_COURIER or no longer held
      mockDeliveryEventService.returnToWaitingForDispatchStop.mockResolvedValueOnce({
        returned: false,
      })
      await service.startWork(testStop, EnumEventActor.ADMIN)

      // Exactly ONE compensation row is created across both runs
      expect(mockCourierCompensationRepository.create).toHaveBeenCalledTimes(1)
    })

    test('payment failure is logged with DISPATCH_STOP_PAYOUT_FAILED and does not throw', async () => {
      mockDeliveryEventService.endAllOpenOffersForDispatchStop.mockResolvedValue(0)

      mockDeliveryRepository.findAllHeldBeforePickup.mockResolvedValue([
        { id: 'del-payout-fail', courierId: 'courier-1' },
      ])
      mockDeliveryEventService.returnToWaitingForDispatchStop.mockResolvedValue({
        returned: true,
        totalCompensation: 500,
        currencyCode: 'EUR',
      })

      mockCourierCompensationRepository.create.mockRejectedValue(
        new Error('DB connection dropped during compensation write')
      )

      // Must not throw!
      await expect(service.startWork(testStop, EnumEventActor.ADMIN)).resolves.toBeUndefined()
    })
  })

  describe('endWork (AC-4, AC-11)', () => {
    const testStop: DispatchStop = {
      id: 'stop-ew',
      reason: EnumDispatchStopReason.STORM,
      startsAt: new Date(),
      endsAt: new Date(),
      startedAt: new Date(),
      endedAt: new Date(),
      cancelledAt: null,
      createdByUserId: adminUserId,
      createdAt: new Date(),
      endedByUserId: adminUserId,
      cancelledByUserId: null,
      endWorkDoneAt: null,
    }

    test('matches all waiting deliveries and only THEN marks endWorkDoneAt (AC-11)', async () => {
      const callOrder: string[] = []
      mockDispatchStopRepository.findOn.mockResolvedValue(null)
      mockDeliveryEventService.matchAllWaitingDeliveriesAfterStop.mockImplementation(async () => {
        callOrder.push('matchWaiting')
      })
      mockDispatchStopRepository.markEndWorkDone.mockImplementation(async () => {
        callOrder.push('markDone')
        return true
      })

      await service.endWork(testStop)

      expect(callOrder).toEqual(['matchWaiting', 'markDone'])
      expect(mockDispatchStopRepository.markEndWorkDone).toHaveBeenCalledWith('stop-ew', expect.any(Date))
    })

    test('when end work throws halfway, endWorkDoneAt is not marked (AC-11)', async () => {
      mockDispatchStopRepository.findOn.mockResolvedValue(null)
      mockDeliveryEventService.matchAllWaitingDeliveriesAfterStop.mockRejectedValue(new Error('Match failed'))

      await expect(service.endWork(testStop)).rejects.toThrow('Match failed')

      expect(mockDispatchStopRepository.markEndWorkDone).not.toHaveBeenCalled()
    })

    test('a stop whose end work was already done (endWorkDoneAt set) does nothing (idempotent) (AC-11)', async () => {
      const alreadyDoneStop: DispatchStop = {
        ...testStop,
        endWorkDoneAt: new Date(),
      }

      await service.endWork(alreadyDoneStop)

      expect(mockDeliveryEventService.matchAllWaitingDeliveriesAfterStop).not.toHaveBeenCalled()
      expect(mockDispatchStopRepository.markEndWorkDone).not.toHaveBeenCalled()
    })

    test('does nothing more if another stop is on', async () => {
      mockDispatchStopRepository.findOn.mockResolvedValue({ id: 'another-stop-active' })

      await service.endWork(testStop)

      expect(mockDeliveryEventService.matchAllWaitingDeliveriesAfterStop).not.toHaveBeenCalled()
      expect(mockDispatchStopRepository.markEndWorkDone).toHaveBeenCalledWith('stop-ew', expect.any(Date))
    })

    test('with a stop now on and a scheduled stop that starts later and ends earlier, when the scheduled stop end passes, endWork does not match waiting deliveries (another stop is still on) but marks end work done; when the stop now is restarted, endWork matches them (Decision 29.6)', async () => {
      // Stop now: started earlier, no scheduled end (endsAt null), still on (endedAt null)
      const stopNow: DispatchStop = {
        id: 'stop-now-active',
        reason: EnumDispatchStopReason.STORM,
        startsAt: new Date('2026-07-15T10:00:00.000Z'),
        endsAt: null,
        startedAt: new Date('2026-07-15T10:00:00.000Z'),
        endedAt: null,
        cancelledAt: null,
        createdByUserId: adminUserId,
        createdAt: new Date('2026-07-15T10:00:00.000Z'),
        endedByUserId: null,
        cancelledByUserId: null,
        endWorkDoneAt: null,
      }

      // Scheduled stop that started later (12:00) and ended earlier (14:00):
      const scheduledStop: DispatchStop = {
        id: 'stop-sched-subsumed',
        reason: EnumDispatchStopReason.HEAT,
        startsAt: new Date('2026-07-15T12:00:00.000Z'),
        endsAt: new Date('2026-07-15T14:00:00.000Z'),
        startedAt: new Date('2026-07-15T12:00:00.000Z'),
        endedAt: null,
        cancelledAt: null,
        createdByUserId: adminUserId,
        createdAt: new Date('2026-07-14T08:00:00.000Z'),
        endedByUserId: null,
        cancelledByUserId: null,
        endWorkDoneAt: null,
      }

      // 1. When the scheduled stop's end passes (14:00), endWork runs for scheduledStop.
      // Another stop (stopNow) is still on at this moment:
      mockDispatchStopRepository.findOn.mockResolvedValue(stopNow)

      await service.endWork(scheduledStop)

      // endWork does NOT match waiting deliveries because stopNow is still on...
      expect(mockDeliveryEventService.matchAllWaitingDeliveriesAfterStop).not.toHaveBeenCalled()
      // ...but marks scheduledStop's end work as done!
      expect(mockDispatchStopRepository.markEndWorkDone).toHaveBeenCalledWith('stop-sched-subsumed', expect.any(Date))

      // 2. Later, admin restarts stopNow (ends it)
      const restartedStopNow: DispatchStop = {
        ...stopNow,
        endedAt: new Date('2026-07-15T16:00:00.000Z'),
        endedByUserId: adminUserId,
      }
      mockDispatchStopRepository.findById
        .mockResolvedValueOnce(stopNow) // initial check in endOrCancel
        .mockResolvedValueOnce({ ...restartedStopNow, endWorkDoneAt: new Date('2026-07-15T16:00:00.000Z') }) // reload check
      mockDispatchStopRepository.endOrCancel.mockResolvedValue(restartedStopNow)
      // When stopNow ends, no stop is on anymore
      mockDispatchStopRepository.findOn.mockResolvedValue(null)

      await service.endOrCancel('stop-now-active', adminUserId)

      // When stop now is restarted, endWork matches them!
      expect(mockDeliveryEventService.matchAllWaitingDeliveriesAfterStop).toHaveBeenCalledTimes(1)
      expect(mockDispatchStopRepository.markEndWorkDone).toHaveBeenCalledWith('stop-now-active', expect.any(Date))
    })
  })

  describe('state and lookahead (AC-10)', () => {
    const now = new Date('2026-07-15T09:00:00.000Z') // 12:00 Athens

    test('returns current stop and next scheduled stop within 12 hours with audience sentences and hides createdByUserId', async () => {
      const currentStop: DispatchStop = {
        id: 'stop-curr',
        reason: EnumDispatchStopReason.HEAT,
        startsAt: now,
        endsAt: new Date('2026-07-15T14:00:00.000Z'), // 17:00 Athens
        startedAt: now,
        endedAt: null,
        cancelledAt: null,
        createdByUserId: 'secret-admin',
        createdAt: now,
        endedByUserId: null,
        cancelledByUserId: null,
        endWorkDoneAt: null,
      }

      // Next stop starts 4 hours from now (within 12h)
      const nextStop: DispatchStop = {
        id: 'stop-next',
        reason: EnumDispatchStopReason.STORM,
        startsAt: new Date('2026-07-15T15:00:00.000Z'), // 18:00 Athens
        endsAt: new Date('2026-07-15T18:00:00.000Z'), // 21:00 Athens
        startedAt: null,
        endedAt: null,
        cancelledAt: null,
        createdByUserId: 'secret-admin',
        createdAt: now,
        endedByUserId: null,
        cancelledByUserId: null,
        endWorkDoneAt: null,
      }

      mockDispatchStopRepository.findOn.mockResolvedValue(currentStop)
      mockDispatchStopRepository.findScheduled.mockResolvedValue([nextStop])

      // Courier view
      const courierState = await service.state('courier', now)
      expect(courierState.current).toEqual({
        reason: EnumDispatchStopReason.HEAT,
        startsAt: currentStop.startsAt,
        endsAt: currentStop.endsAt,
        message: 'Dispatch is stopped until 17:00 (heat).',
      })
      expect(courierState.next).toEqual({
        reason: EnumDispatchStopReason.STORM,
        startsAt: nextStop.startsAt,
        endsAt: nextStop.endsAt,
        message: 'Dispatch stops today 18:00 to 21:00 (storm).',
      })
      // Verify createdByUserId was NEVER leaked in either view!
      expect((courierState.current as any)?.createdByUserId).toBeUndefined()
      expect((courierState.next as any)?.createdByUserId).toBeUndefined()

      // Partner view
      const partnerState = await service.state('partner', now)
      expect(partnerState.current?.message).toBe('Delivery is stopped until 17:00 (heat).')
      expect(partnerState.next?.message).toBe('Delivery stops today 18:00 to 21:00 (storm).')
      expect((partnerState.current as any)?.createdByUserId).toBeUndefined()
      expect((partnerState.next as any)?.createdByUserId).toBeUndefined()
    })

    test('omits next stop when it is beyond the 12 hour lookahead window', async () => {
      // Starts 14 hours from now
      const farNextStop: DispatchStop = {
        id: 'stop-far',
        reason: EnumDispatchStopReason.HEAT,
        startsAt: new Date(now.getTime() + 14 * 3600 * 1000),
        endsAt: new Date(now.getTime() + 18 * 3600 * 1000),
        startedAt: null,
        endedAt: null,
        cancelledAt: null,
        createdByUserId: 'admin-1',
        createdAt: now,
        endedByUserId: null,
        cancelledByUserId: null,
        endWorkDoneAt: null,
      }
      mockDispatchStopRepository.findOn.mockResolvedValue(null)
      mockDispatchStopRepository.findScheduled.mockResolvedValue([farNextStop])

      const state = await service.state('courier', now)
      expect(state.current).toBeNull()
      expect(state.next).toBeNull()
    })
  })

  describe('tick (AC-11)', () => {
    test('runs start work with SYSTEM actor for due starts and end work for due ends, and never throws on failure', async () => {
      const dueToStart: DispatchStop = {
        id: 'stop-start-due',
        reason: EnumDispatchStopReason.HEAT,
        startsAt: new Date(),
        endsAt: null,
        startedAt: null,
        endedAt: null,
        cancelledAt: null,
        createdByUserId: adminUserId,
        createdAt: new Date(),
        endedByUserId: null,
        cancelledByUserId: null,
        endWorkDoneAt: null,
      }
      const dueToEnd: DispatchStop = {
        id: 'stop-end-due',
        reason: EnumDispatchStopReason.STORM,
        startsAt: new Date(),
        endsAt: new Date(),
        startedAt: new Date(),
        endedAt: new Date(),
        cancelledAt: null,
        createdByUserId: adminUserId,
        createdAt: new Date(),
        endedByUserId: null,
        cancelledByUserId: null,
        endWorkDoneAt: null,
      }

      mockDispatchStopRepository.findDueToStart.mockResolvedValue([dueToStart])
      mockDispatchStopRepository.findDueToEnd.mockResolvedValue([dueToEnd])
      mockDispatchStopRepository.markStarted.mockResolvedValue(true)
      mockDispatchStopRepository.markEndWorkDone.mockResolvedValue(true)

      await service.tick(new Date())

      expect(mockDeliveryEventService.endAllOpenOffersForDispatchStop).toHaveBeenCalled()
      expect(mockDeliveryEventService.matchAllWaitingDeliveriesAfterStop).toHaveBeenCalled()

      // Error resilience: repository throws, tick does not throw!
      mockDispatchStopRepository.findDueToStart.mockRejectedValueOnce(new Error('DB down'))
      await expect(service.tick(new Date())).resolves.toBeUndefined()
    })
  })
})
