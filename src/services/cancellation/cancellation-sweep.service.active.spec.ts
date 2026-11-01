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

  let registeredHandler: (() => Promise<void>) | undefined

  beforeEach(() => {
    mockDeliveryRepository = {
      findCancellationsToSettle: jest.fn().mockResolvedValue(['del-1', 'del-2', 'del-3']),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockDeliveryEventService = {
      settleCancellation: jest.fn().mockResolvedValue(undefined),
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

    service = new CancellationSweepService(
      mockDeliveryRepository,
      mockDeliveryEventService,
      mockBullMQService,
      mockTaskBusService
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
})
