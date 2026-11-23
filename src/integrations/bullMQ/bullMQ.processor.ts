import { Processor, WorkerHost } from '@nestjs/bullmq'
import { MESSAGE_BUS_QUEUE } from '../../constants'
import { Job } from 'bullmq'
import { EventBusService } from '../../services/eventBus/eventBus.service'
import { Logger } from '@nestjs/common'
import { describeErrorForLog, errorSummaryForLog } from '../../utils/errorForLog'

@Processor(MESSAGE_BUS_QUEUE)
export class BullMQProcessor extends WorkerHost {
  private readonly logger = new Logger(BullMQProcessor.name)

  constructor(private eventBusService: EventBusService) {
    super()
  }

  async process(job: Job) {
    // Row 139: the job's name and the error's summary only, never the job's data or the whole error.
    // Then the error goes on to BullMQ, which marks the job failed (and retries it only if it was added
    // with `attempts`). The old `.catch(this.logger.error)` failed the job too, by accident: Nest's
    // logger, called without its `this`, threw a TypeError and logged nothing (row 139 review).
    try {
      await this.eventBusService.emit(job.name, job.data)
    } catch (error) {
      this.logger.error(`Job ${job.name} failed: ${errorSummaryForLog(error)}`, describeErrorForLog(error).stack)
      throw error
    }
  }
}
