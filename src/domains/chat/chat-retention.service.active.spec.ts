import { INSTANCE_TIMEZONE } from 'src/constants'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { ChatRepository } from 'src/persistence/repositories/chat.repository'
import { TaskBusService } from 'src/services/taskBus/taskBus.service'
import { ChatRetentionService } from './chat-retention.service'

describe('ChatRetentionService (spec 0034, AC-18)', () => {
  let service: ChatRetentionService
  let mockChatRepo: jest.Mocked<ChatRepository>
  let mockConfigService: jest.Mocked<ConfigDomainService>
  let mockBullMQService: jest.Mocked<BullMQService>
  let mockTaskBusService: jest.Mocked<TaskBusService>
  let registeredHandler: () => Promise<void>

  beforeEach(() => {
    mockChatRepo = {
      deleteMessagesOlderThan: jest.fn().mockResolvedValue(15),
    } as unknown as jest.Mocked<ChatRepository>

    mockConfigService = {
      instanceConfig: {
        getChatRetentionDays: jest.fn().mockResolvedValue(90),
      },
    } as unknown as jest.Mocked<ConfigDomainService>

    mockBullMQService = {
      addRepeatableJob: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<BullMQService>

    mockTaskBusService = {
      registerTaskHandler: jest.fn((name, handler) => {
        if (name === 'chat-retention') {
          registeredHandler = handler
        }
      }),
    } as unknown as jest.Mocked<TaskBusService>

    service = new ChatRetentionService(
      mockChatRepo,
      mockConfigService,
      mockBullMQService,
      mockTaskBusService
    )
  })

  test('registers task handler for chat-retention on construction', () => {
    expect(mockTaskBusService.registerTaskHandler).toHaveBeenCalledWith(
      'chat-retention',
      expect.any(Function)
    )
    expect(registeredHandler).toBeDefined()
  })

  test('schedules repeatable job chat-retention at "20 4 * * *" in INSTANCE_TIMEZONE', async () => {
    await service.schedule()

    expect(mockBullMQService.addRepeatableJob).toHaveBeenCalledWith(
      'chat-retention',
      {},
      '20 4 * * *',
      INSTANCE_TIMEZONE
    )
  })

  test('onModuleInit triggers schedule', () => {
    const scheduleSpy = jest.spyOn(service, 'schedule').mockResolvedValue(undefined)
    service.onModuleInit()
    expect(scheduleSpy).toHaveBeenCalled()
    scheduleSpy.mockRestore()
  })

  test('deleteOld calculates cutoff as now minus chatRetentionDays and calls chatRepository.deleteMessagesOlderThan', async () => {
    const fixedNow = new Date('2026-11-17T04:20:00.000Z')
    ;(mockConfigService.instanceConfig.getChatRetentionDays as jest.Mock).mockResolvedValue(90)

    const expectedCutoff = new Date(fixedNow.getTime() - 90 * 24 * 60 * 60 * 1000)

    const deleted = await service.deleteOld(fixedNow)

    expect(mockConfigService.instanceConfig.getChatRetentionDays).toHaveBeenCalled()
    expect(mockChatRepo.deleteMessagesOlderThan).toHaveBeenCalledWith(expectedCutoff)
    expect(deleted).toBe(15)
  })

  test('task handler executes deleteOld', async () => {
    const deleteOldSpy = jest.spyOn(service, 'deleteOld').mockResolvedValue(10)
    await registeredHandler()
    expect(deleteOldSpy).toHaveBeenCalled()
    deleteOldSpy.mockRestore()
  })
})
