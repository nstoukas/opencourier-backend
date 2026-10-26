import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { TaskBusService } from 'src/services/taskBus/taskBus.service'
import { SavedCustomerDomainService } from './saved-customer.domain.service'
import { SavedCustomerRetentionService } from './saved-customer-retention.service'

describe('SavedCustomerRetentionService (AC-7)', () => {
  let service: SavedCustomerRetentionService
  let savedCustomerDomainService: jest.Mocked<SavedCustomerDomainService>
  let bullMQService: jest.Mocked<BullMQService>
  let taskBusService: jest.Mocked<TaskBusService>
  let registeredTaskHandler: (() => Promise<void>) | undefined

  beforeEach(() => {
    savedCustomerDomainService = {
      deleteUnused: jest.fn().mockResolvedValue(2),
    } as any

    bullMQService = {
      addRepeatableJob: jest.fn().mockResolvedValue(undefined),
    } as any

    taskBusService = {
      registerTaskHandler: jest.fn((name: string, handler: any) => {
        if (name === 'saved-customer-retention') {
          registeredTaskHandler = handler
        }
      }),
    } as any

    service = new SavedCustomerRetentionService(
      savedCustomerDomainService,
      bullMQService,
      taskBusService
    )
  })

  it('registers the saved-customer-retention task handler on the task bus', async () => {
    expect(taskBusService.registerTaskHandler).toHaveBeenCalledWith(
      'saved-customer-retention',
      expect.any(Function)
    )

    expect(registeredTaskHandler).toBeDefined()
    await registeredTaskHandler!()
    expect(savedCustomerDomainService.deleteUnused).toHaveBeenCalledTimes(1)
  })

  it('onModuleInit returns at once even while addRepeatableJob never resolves', () => {
    // A promise that never settles (simulating Redis down / waiting on offline queue)
    bullMQService.addRepeatableJob.mockReturnValue(new Promise(() => {}))

    // onModuleInit is synchronous (void), does not await schedule()
    const result = service.onModuleInit()
    expect(result).toBeUndefined()
    expect(bullMQService.addRepeatableJob).toHaveBeenCalledWith(
      'saved-customer-retention',
      {},
      '0 4 * * *',
      'Europe/Athens'
    )
  })

  it('schedule() logs a failure instead of throwing', async () => {
    bullMQService.addRepeatableJob.mockRejectedValue(new Error('Redis connection lost'))
    const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

    await expect(service.schedule()).resolves.toBeUndefined()
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not schedule the saved customer retention job')
    )

    loggerSpy.mockRestore()
  })
})
