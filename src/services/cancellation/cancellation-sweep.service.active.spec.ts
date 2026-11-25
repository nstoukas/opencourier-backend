import { CancellationSweepService } from './cancellation-sweep.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { TaskBusService } from 'src/services/taskBus/taskBus.service'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types'

describe('CancellationSweepService (Spec 0015 AC-10)', () => {
  let service: CancellationSweepService
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>
  let mockDeliveryEventService: jest.Mocked<DeliveryEventService>
  let mockBullMQService: jest.Mocked<BullMQService>
  let mockTaskBusService: jest.Mocked<TaskBusService>
  let mockRemovalRequestRepository: { findApprovedUnsettled: jest.Mock }
  let mockRemovalRequestService: { sweepApprovedUnsettled: jest.Mock }

  let registeredHandler: (() => Promise<void>) | undefined

  beforeEach(() => {
    mockDeliveryRepository = {
      findCancellationsToSettle: jest.fn().mockResolvedValue(['del-1', 'del-2', 'del-3']),
      findWaitPayToSettle: jest.fn().mockResolvedValue(['del-wait-1', 'del-wait-2']),
      findReturnTripsToSettle: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockDeliveryEventService = {
      settleCancellation: jest.fn().mockResolvedValue(undefined),
      settleWaitPay: jest.fn().mockResolvedValue(undefined),
      settleReturnTrip: jest.fn().mockResolvedValue(undefined),
      // Spec 0048 (cross check 8), row 172: the minute sweep completes accepts of taken orders.
      completeTakenAccepts: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<DeliveryEventService>

    mockBullMQService = {
      addRepeatableJob: jest.fn().mockResolvedValue(undefined as any),
    } as unknown as jest.Mocked<BullMQService>

    mockTaskBusService = {
      registerTaskHandler: jest.fn().mockImplementation((name, handler) => {
        if (name === 'cancellation-award-sweep') {
          registeredHandler = handler
        }
      }),
    } as unknown as jest.Mocked<TaskBusService>

    mockRemovalRequestRepository = {
      findApprovedUnsettled: jest.fn().mockResolvedValue([]),
    }
    mockRemovalRequestService = {
      sweepApprovedUnsettled: jest.fn().mockResolvedValue(undefined),
    }

    service = new CancellationSweepService(
      mockDeliveryRepository,
      mockDeliveryEventService,
      mockBullMQService,
      mockTaskBusService,
      mockRemovalRequestRepository as any,
      mockRemovalRequestService as any
    )
  })

  describe('Startup & Registration', () => {
    it('registers task handler for "cancellation-award-sweep" in constructor', () => {
      expect(mockTaskBusService.registerTaskHandler).toHaveBeenCalledWith(
        'cancellation-award-sweep',
        expect.any(Function)
      )
      expect(registeredHandler).toBeDefined()
    })

    it('schedules repeatable job every minute ("* * * * *") on module init', async () => {
      service.onModuleInit()

      expect(mockBullMQService.addRepeatableJob).toHaveBeenCalledWith(
        'cancellation-award-sweep',
        {},
        '* * * * *'
      )
    })

    it('handles scheduling failure cleanly without throwing', async () => {
      mockBullMQService.addRepeatableJob.mockRejectedValueOnce(new Error('Redis connection refused'))

      await expect(service.schedule()).resolves.toBeUndefined()
    })
  })

  describe('sweep execution (AC-10)', () => {
    it('reads deliveries cancelled between 24h ago and 1 min ago and calls settleCancellation for each', async () => {
      const fixedNow = new Date('2026-11-01T12:00:00.000Z')
      const expectedFrom = new Date(fixedNow.getTime() - 24 * 60 * 60 * 1000)
      const expectedTo = new Date(fixedNow.getTime() - 60 * 1000)

      await service.sweep(fixedNow)

      // Margin of 1 minute leaves inline settlement alone
      expect(mockDeliveryRepository.findCancellationsToSettle).toHaveBeenCalledWith(
        expectedFrom,
        expectedTo,
        DELIVERY_ONGOING_STATUSES
      )

      expect(mockDeliveryEventService.settleCancellation).toHaveBeenCalledTimes(3)
      expect(mockDeliveryEventService.settleCancellation).toHaveBeenNthCalledWith(1, 'del-1')
      expect(mockDeliveryEventService.settleCancellation).toHaveBeenNthCalledWith(2, 'del-2')
      expect(mockDeliveryEventService.settleCancellation).toHaveBeenNthCalledWith(3, 'del-3')
    })

    it('one delivery throwing in settleCancellation does NOT stop the others', async () => {
      mockDeliveryEventService.settleCancellation
        .mockRejectedValueOnce(new Error('Transient DB timeout on del-1'))
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)

      await service.sweep(new Date())

      // del-2 and del-3 are still processed
      expect(mockDeliveryEventService.settleCancellation).toHaveBeenCalledWith('del-1')
      expect(mockDeliveryEventService.settleCancellation).toHaveBeenCalledWith('del-2')
      expect(mockDeliveryEventService.settleCancellation).toHaveBeenCalledWith('del-3')
    })

    it('a read failure from findCancellationsToSettle is logged and does NOT throw', async () => {
      mockDeliveryRepository.findCancellationsToSettle.mockRejectedValueOnce(new Error('Postgres query failure'))

      await expect(service.sweep(new Date())).resolves.toBeUndefined()
      expect(mockDeliveryEventService.settleCancellation).not.toHaveBeenCalled()
    })
  })

  describe('wait pay sweep execution (Spec 0033 AC-8, decision 23.9)', () => {
    it('reads deliveries with waitPayOwedAt between 24h ago and 1 min ago and calls settleWaitPay for each', async () => {
      const fixedNow = new Date('2026-11-01T12:00:00.000Z')
      const expectedFrom = new Date(fixedNow.getTime() - 24 * 60 * 60 * 1000)
      const expectedTo = new Date(fixedNow.getTime() - 60 * 1000)

      await service.sweep(fixedNow)

      // Margin of 1 minute leaves inline settlement alone
      expect(mockDeliveryRepository.findWaitPayToSettle).toHaveBeenCalledWith(
        expectedFrom,
        expectedTo
      )

      expect(mockDeliveryEventService.settleWaitPay).toHaveBeenCalledTimes(2)
      expect(mockDeliveryEventService.settleWaitPay).toHaveBeenNthCalledWith(1, 'del-wait-1')
      expect(mockDeliveryEventService.settleWaitPay).toHaveBeenNthCalledWith(2, 'del-wait-2')
    })

    it('a half-written payment is completed by the sweep calling settleWaitPay', async () => {
      mockDeliveryRepository.findWaitPayToSettle.mockResolvedValueOnce(['del-half-paid'])

      await service.sweep(new Date())

      expect(mockDeliveryEventService.settleWaitPay).toHaveBeenCalledWith('del-half-paid')
    })

    it('processes each delivery in the batch even when multiple ids are returned', async () => {
      mockDeliveryRepository.findWaitPayToSettle.mockResolvedValueOnce(['del-wait-1', 'del-wait-2', 'del-wait-3'])

      await service.sweep(new Date())

      expect(mockDeliveryEventService.settleWaitPay).toHaveBeenCalledWith('del-wait-1')
      expect(mockDeliveryEventService.settleWaitPay).toHaveBeenCalledWith('del-wait-2')
      expect(mockDeliveryEventService.settleWaitPay).toHaveBeenCalledWith('del-wait-3')
    })

    it('a read failure from findWaitPayToSettle is logged and does NOT throw or abort cancellation sweep', async () => {
      mockDeliveryRepository.findWaitPayToSettle.mockRejectedValueOnce(new Error('Postgres query failure'))

      await expect(service.sweep(new Date())).resolves.toBeUndefined()
      expect(mockDeliveryEventService.settleWaitPay).not.toHaveBeenCalled()
      // Cancellation sweep still ran
      expect(mockDeliveryEventService.settleCancellation).toHaveBeenCalled()
    })
  })

  describe('removal sweep execution (Spec 0035 AC-18)', () => {
    it('reads approved unsettled removal requests between 24h and 1 min ago and calls sweepApprovedUnsettled for each', async () => {
      const fixedNow = new Date('2026-11-01T12:00:00.000Z')
      const expectedFrom = new Date(fixedNow.getTime() - 24 * 60 * 60 * 1000)
      const expectedTo = new Date(fixedNow.getTime() - 60 * 1000)

      const mockRequests = [{ id: 'req-1' }, { id: 'req-2' }] as any
      mockRemovalRequestRepository.findApprovedUnsettled.mockResolvedValueOnce(mockRequests)

      await service.sweep(fixedNow)

      expect(mockRemovalRequestRepository.findApprovedUnsettled).toHaveBeenCalledWith(expectedFrom, expectedTo)
      expect(mockRemovalRequestService.sweepApprovedUnsettled).toHaveBeenCalledTimes(2)
      expect(mockRemovalRequestService.sweepApprovedUnsettled).toHaveBeenNthCalledWith(1, mockRequests[0], fixedNow)
      expect(mockRemovalRequestService.sweepApprovedUnsettled).toHaveBeenNthCalledWith(2, mockRequests[1], fixedNow)
    })

    it('one request failing in sweepApprovedUnsettled does not stop the others', async () => {
      const mockRequests = [{ id: 'req-fail' }, { id: 'req-ok' }] as any
      mockRemovalRequestRepository.findApprovedUnsettled.mockResolvedValueOnce(mockRequests)
      mockRemovalRequestService.sweepApprovedUnsettled
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockResolvedValueOnce(undefined)

      await service.sweep(new Date())

      expect(mockRemovalRequestService.sweepApprovedUnsettled).toHaveBeenCalledWith(mockRequests[0], expect.any(Date))
      expect(mockRemovalRequestService.sweepApprovedUnsettled).toHaveBeenCalledWith(mockRequests[1], expect.any(Date))
    })

    it('a read failure from findApprovedUnsettled is logged and does NOT throw or abort other sweeps', async () => {
      mockRemovalRequestRepository.findApprovedUnsettled.mockRejectedValueOnce(new Error('DB read error'))

      await expect(service.sweep(new Date())).resolves.toBeUndefined()
      expect(mockRemovalRequestService.sweepApprovedUnsettled).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.settleCancellation).toHaveBeenCalled()
    })
  })

  describe('return trip sweep execution (Spec 0035 AC-16, AC-18)', () => {
    it('reads deliveries with return trips to settle between 24h and 1 min ago and calls settleReturnTrip for each', async () => {
      const fixedNow = new Date('2026-11-01T12:00:00.000Z')
      const expectedFrom = new Date(fixedNow.getTime() - 24 * 60 * 60 * 1000)
      const expectedTo = new Date(fixedNow.getTime() - 60 * 1000)

      mockDeliveryRepository.findReturnTripsToSettle.mockResolvedValueOnce(['del-ret-1', 'del-ret-2'])

      await service.sweep(fixedNow)

      expect(mockDeliveryRepository.findReturnTripsToSettle).toHaveBeenCalledWith(expectedFrom, expectedTo)
      expect(mockDeliveryEventService.settleReturnTrip).toHaveBeenCalledTimes(2)
      expect(mockDeliveryEventService.settleReturnTrip).toHaveBeenNthCalledWith(1, 'del-ret-1')
      expect(mockDeliveryEventService.settleReturnTrip).toHaveBeenNthCalledWith(2, 'del-ret-2')
    })

    it('processes each delivery in the batch when multiple return trips are found', async () => {
      mockDeliveryRepository.findReturnTripsToSettle.mockResolvedValueOnce(['del-ret-1', 'del-ret-2', 'del-ret-3'])

      await service.sweep(new Date())

      expect(mockDeliveryEventService.settleReturnTrip).toHaveBeenCalledWith('del-ret-1')
      expect(mockDeliveryEventService.settleReturnTrip).toHaveBeenCalledWith('del-ret-2')
      expect(mockDeliveryEventService.settleReturnTrip).toHaveBeenCalledWith('del-ret-3')
    })

    it('a read failure from findReturnTripsToSettle is logged and does NOT throw', async () => {
      mockDeliveryRepository.findReturnTripsToSettle.mockRejectedValueOnce(new Error('DB read error'))

      await expect(service.sweep(new Date())).resolves.toBeUndefined()
      expect(mockDeliveryEventService.settleReturnTrip).not.toHaveBeenCalled()
    })
  })

  describe('safe to run twice (row 141, pay and assignment)', () => {
    it('running sweep twice settles each cancellation, wait, removal, and return trip once', async () => {
      const fixedNow = new Date('2026-11-01T12:00:00.000Z')

      // First run finds unsettled items
      mockDeliveryRepository.findCancellationsToSettle.mockResolvedValueOnce(['del-cancel-1'])
      mockDeliveryRepository.findWaitPayToSettle.mockResolvedValueOnce(['del-wait-1'])
      const mockReq = { id: 'req-1' } as any
      mockRemovalRequestRepository.findApprovedUnsettled.mockResolvedValueOnce([mockReq])
      mockDeliveryRepository.findReturnTripsToSettle.mockResolvedValueOnce(['del-ret-1'])

      // Second run finds nothing (items were settled in the first run)
      mockDeliveryRepository.findCancellationsToSettle.mockResolvedValueOnce([])
      mockDeliveryRepository.findWaitPayToSettle.mockResolvedValueOnce([])
      mockRemovalRequestRepository.findApprovedUnsettled.mockResolvedValueOnce([])
      mockDeliveryRepository.findReturnTripsToSettle.mockResolvedValueOnce([])

      // Run 1
      await service.sweep(fixedNow)

      // Run 2
      await service.sweep(fixedNow)

      // Settle calls were invoked exactly once across both runs
      expect(mockDeliveryEventService.settleCancellation).toHaveBeenCalledTimes(1)
      expect(mockDeliveryEventService.settleCancellation).toHaveBeenCalledWith('del-cancel-1')

      expect(mockDeliveryEventService.settleWaitPay).toHaveBeenCalledTimes(1)
      expect(mockDeliveryEventService.settleWaitPay).toHaveBeenCalledWith('del-wait-1')

      expect(mockRemovalRequestService.sweepApprovedUnsettled).toHaveBeenCalledTimes(1)
      expect(mockRemovalRequestService.sweepApprovedUnsettled).toHaveBeenCalledWith(mockReq, fixedNow)

      expect(mockDeliveryEventService.settleReturnTrip).toHaveBeenCalledTimes(1)
      expect(mockDeliveryEventService.settleReturnTrip).toHaveBeenCalledWith('del-ret-1')
    })
  })

  describe('completeTakenAccepts sweep (spec 0048 cross check 8, widened by row 172)', () => {
    it('calls completeTakenAccepts with now minus LEAVE_THE_INLINE_STEP_MS (1 minute)', async () => {
      const fixedNow = new Date('2026-11-01T12:00:00.000Z')
      const expectedBefore = new Date(fixedNow.getTime() - 60 * 1000)

      await service.sweep(fixedNow)

      expect(mockDeliveryEventService.completeTakenAccepts).toHaveBeenCalledWith(expectedBefore)
    })
  })
})
