import { INSTANCE_TIMEZONE } from 'src/constants'
import { AddressNoteRetentionService } from './address-note-retention.service'
import { LocationNoteDomainService } from './location-note.domain.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { TaskBusService } from 'src/services/taskBus/taskBus.service'

describe('AddressNoteRetentionService (Spec 0053 AC-6, AC-9, cross check 10)', () => {
  let service: AddressNoteRetentionService
  let mockLocationNoteDomainService: jest.Mocked<LocationNoteDomainService>
  let mockConfigDomainService: any
  let mockBullMQService: jest.Mocked<BullMQService>
  let mockTaskBusService: jest.Mocked<TaskBusService>
  let registeredHandler: (() => Promise<void>) | undefined

  beforeEach(() => {
    mockLocationNoteDomainService = {
      deleteExpired: jest.fn().mockResolvedValue(5),
    } as unknown as jest.Mocked<LocationNoteDomainService>

    mockConfigDomainService = {
      instanceConfig: {
        getAddressNoteRetentionDays: jest.fn().mockResolvedValue(182),
      },
    }

    mockBullMQService = {
      replaceRepeatableJob: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<BullMQService>

    mockTaskBusService = {
      registerTaskHandler: jest.fn().mockImplementation((name, handler) => {
        if (name === 'address-note-retention') {
          registeredHandler = handler
        }
      }),
    } as unknown as jest.Mocked<TaskBusService>

    service = new AddressNoteRetentionService(
      mockLocationNoteDomainService,
      mockConfigDomainService as unknown as ConfigDomainService,
      mockBullMQService,
      mockTaskBusService
    )
  })

  it('registers task handler for "address-note-retention" on startup', () => {
    expect(mockTaskBusService.registerTaskHandler).toHaveBeenCalledWith(
      'address-note-retention',
      expect.any(Function)
    )
    expect(registeredHandler).toBeDefined()
  })

  it('schedules repeatable job at 03:30 Athens time idempotently (cross check 10)', async () => {
    await service.schedule()

    expect(mockBullMQService.replaceRepeatableJob).toHaveBeenCalledWith(
      'address-note-retention',
      {},
      '30 3 * * *',
      INSTANCE_TIMEZONE
    )
  })

  it('calls deleteExpired with the configured retention days and returns count deleted', async () => {
    const fixedNow = new Date('2026-11-20T03:30:00Z')
    const count = await service.deleteExpired(fixedNow)

    expect(mockConfigDomainService.instanceConfig.getAddressNoteRetentionDays).toHaveBeenCalled()
    expect(mockLocationNoteDomainService.deleteExpired).toHaveBeenCalledWith(182, fixedNow)
    expect(count).toBe(5)
  })

  it('calls deleteExpired with non-default configured retention days (e.g. 90 days, not hardcoded 182)', async () => {
    mockConfigDomainService.instanceConfig.getAddressNoteRetentionDays.mockResolvedValue(90)
    const fixedNow = new Date('2026-11-20T03:30:00Z')
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {})

    const count = await service.deleteExpired(fixedNow)

    expect(mockConfigDomainService.instanceConfig.getAddressNoteRetentionDays).toHaveBeenCalled()
    expect(mockLocationNoteDomainService.deleteExpired).toHaveBeenCalledWith(90, fixedNow)
    expect(count).toBe(5)
    expect(logSpy).toHaveBeenCalledWith(
      'Deleted 5 address note(s) no rider upvoted in 90 days'
    )
    logSpy.mockRestore()
  })

  it('calls deleteExpired with another non-default setting (e.g. 30 days) and logs 30 days', async () => {
    mockConfigDomainService.instanceConfig.getAddressNoteRetentionDays.mockResolvedValue(30)
    const fixedNow = new Date('2026-11-20T03:30:00Z')
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {})

    await service.deleteExpired(fixedNow)

    expect(mockLocationNoteDomainService.deleteExpired).toHaveBeenCalledWith(30, fixedNow)
    expect(logSpy).toHaveBeenCalledWith(
      'Deleted 5 address note(s) no rider upvoted in 30 days'
    )
    logSpy.mockRestore()
  })

  it('logs count and days only, never any note text or coordinates (value 5, AC-6)', async () => {
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {})

    await service.deleteExpired()

    expect(logSpy).toHaveBeenCalledWith(
      'Deleted 5 address note(s) no rider upvoted in 182 days'
    )
    logSpy.mockRestore()
  })

  it('invoking the registered task bus handler runs deleteExpired', async () => {
    expect(registeredHandler).toBeDefined()
    await registeredHandler!()

    expect(mockLocationNoteDomainService.deleteExpired).toHaveBeenCalled()
  })
})
