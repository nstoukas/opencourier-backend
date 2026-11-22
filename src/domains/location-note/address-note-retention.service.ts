import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { TaskBusService } from 'src/services/taskBus/taskBus.service'
import { LocationNoteDomainService } from './location-note.domain.service'

const ADDRESS_NOTE_RETENTION_JOB_NAME = 'address-note-retention'
// Every night at 03:30 Volos time (AC-6), before the other retention jobs, when nobody is working.
const ADDRESS_NOTE_RETENTION_JOB_PATTERN = '30 3 * * *'

// Spec 0053 (AC-6): deletes courier notes no rider upvoted within addressNoteRetentionDays. Logs the
// count only, never a note's text or point.
// `implements OnModuleInit` promises Nest an onModuleInit() method, which Nest calls once at startup.
@Injectable()
export class AddressNoteRetentionService implements OnModuleInit {
  private readonly logger = new Logger(AddressNoteRetentionService.name)

  constructor(
    private readonly locationNoteDomainService: LocationNoteDomainService,
    private readonly configDomainService: ConfigDomainService,
    private readonly bullMQService: BullMQService,
    private readonly taskBusService: TaskBusService
  ) {
    // When the job comes due, BullMQProcessor hands it to the task bus by name, which calls this.
    this.taskBusService.registerTaskHandler(ADDRESS_NOTE_RETENTION_JOB_NAME, async () => {
      await this.deleteExpired()
    })
  }

  // Not awaited, like the other retention jobs: startup must not wait for Redis.
  onModuleInit(): void {
    void this.schedule()
  }

  // A fixed id, and any older schedule of this name at another time removed first (cross check 10).
  async schedule(): Promise<void> {
    try {
      await this.bullMQService.replaceRepeatableJob(
        ADDRESS_NOTE_RETENTION_JOB_NAME,
        {},
        ADDRESS_NOTE_RETENTION_JOB_PATTERN,
        INSTANCE_TIMEZONE
      )
    } catch (error) {
      this.logger.error(`Could not schedule the address note retention job: ${error}`)
    }
  }

  async deleteExpired(now: Date = new Date()): Promise<number> {
    const days = await this.configDomainService.instanceConfig.getAddressNoteRetentionDays()
    const deleted = await this.locationNoteDomainService.deleteExpired(days, now)
    this.logger.log(`Deleted ${deleted} address note(s) no rider upvoted in ${days} days`)
    return deleted
  }
}
