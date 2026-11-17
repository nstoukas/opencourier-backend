import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { ChatRepository } from 'src/persistence/repositories/chat.repository'
import { TaskBusService } from 'src/services/taskBus/taskBus.service'

const CHAT_RETENTION_JOB_NAME = 'chat-retention'
// Every day at 04:20 Volos time, after the saved customer job, when nobody is working.
const CHAT_RETENTION_JOB_PATTERN = '20 4 * * *'

const DAY_MS = 24 * 60 * 60 * 1000

// Spec 0034 (chat), AC-18: chat messages are personal data, kept for chatRetentionDays and then deleted.
// A thread left with no message drops out of the admin list until someone writes again.
// `implements OnModuleInit` promises Nest an onModuleInit() method, which Nest calls once at startup.
@Injectable()
export class ChatRetentionService implements OnModuleInit {
  private readonly logger = new Logger(ChatRetentionService.name)

  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly configDomainService: ConfigDomainService,
    private readonly bullMQService: BullMQService,
    private readonly taskBusService: TaskBusService
  ) {
    // When the job comes due, BullMQProcessor hands it to the task bus by name, which calls this.
    this.taskBusService.registerTaskHandler(CHAT_RETENTION_JOB_NAME, async () => {
      await this.deleteOld()
    })
  }

  // Not awaited, like the saved customer job: startup must not wait for Redis.
  onModuleInit(): void {
    void this.schedule()
  }

  // A fixed id, so every backend instance that starts adds the same one schedule.
  async schedule(): Promise<void> {
    try {
      await this.bullMQService.addRepeatableJob(CHAT_RETENTION_JOB_NAME, {}, CHAT_RETENTION_JOB_PATTERN, INSTANCE_TIMEZONE)
    } catch (error) {
      this.logger.error(`Could not schedule the chat retention job: ${error}`)
    }
  }

  async deleteOld(now: Date = new Date()): Promise<number> {
    const days = await this.configDomainService.instanceConfig.getChatRetentionDays()
    const cutoff = new Date(now.getTime() - days * DAY_MS)
    const deleted = await this.chatRepository.deleteMessagesOlderThan(cutoff)
    this.logger.log(`Deleted ${deleted} chat message(s) older than ${days} days`)
    return deleted
  }
}
