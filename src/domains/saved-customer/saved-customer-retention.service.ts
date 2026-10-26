import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { TaskBusService } from 'src/services/taskBus/taskBus.service'
import { SavedCustomerDomainService } from './saved-customer.domain.service'

const RETENTION_JOB_NAME = 'saved-customer-retention'
// Every day at 04:00 Volos time, when no restaurant is ordering.
const RETENTION_JOB_PATTERN = '0 4 * * *'
const RETENTION_JOB_TIME_ZONE = 'Europe/Athens'

// Deletes saved customers nobody has ordered for in savedCustomerRetentionMonths (spec 0005, AC-7).
// `implements OnModuleInit` promises Nest an onModuleInit() method, which Nest calls once at startup.
@Injectable()
export class SavedCustomerRetentionService implements OnModuleInit {
  private readonly logger = new Logger(SavedCustomerRetentionService.name)

  constructor(
    private readonly savedCustomerDomainService: SavedCustomerDomainService,
    private readonly bullMQService: BullMQService,
    private readonly taskBusService: TaskBusService
  ) {
    // When the job comes due, BullMQProcessor hands it to the task bus by name, which calls this.
    this.taskBusService.registerTaskHandler(RETENTION_JOB_NAME, async () => {
      await this.savedCustomerDomainService.deleteUnused()
    })
  }

  async onModuleInit(): Promise<void> {
    // The schedule has a fixed id, so every backend instance that starts adds the same one schedule.
    // Without Redis the server still starts; the job is scheduled on the next start.
    try {
      await this.bullMQService.addRepeatableJob(RETENTION_JOB_NAME, {}, RETENTION_JOB_PATTERN, RETENTION_JOB_TIME_ZONE)
    } catch (error) {
      this.logger.error(`Could not schedule the saved customer retention job: ${error}`)
    }
  }
}
