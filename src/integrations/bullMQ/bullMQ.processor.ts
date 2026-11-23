import { Processor, WorkerHost } from '@nestjs/bullmq'
import { MESSAGE_BUS_QUEUE } from '../../constants'
import { Job } from 'bullmq'
import { EventBusService } from '../../services/eventBus/eventBus.service'
import { Logger } from '@nestjs/common'
import { describeErrorForLog } from '../../utils/errorForLog'

@Processor(MESSAGE_BUS_QUEUE)
export class BullMQProcessor extends WorkerHost {
  private readonly logger = new Logger(BullMQProcessor.name)

  constructor(private eventBusService: EventBusService) {
    super()
  }

  async process(job: Job) {
    // Row 139: the job's name and the error's summary only, never the job's data or the whole error.
    // Row 141: then the job fails, and BullMQ tries it again with the retry options every job is added
    // with (JOB_RETRY_OPTIONS), keeping it in the failed list after the last try. It fails with the
    // described error, not the thrown one: BullMQ stores the message and stack in Redis, and a Prisma
    // error's message can repeat the call's data (a name, a phone).
    try {
      await this.eventBusService.emit(job.name, job.data)
    } catch (error) {
      const { summary, stack } = describeErrorForLog(error)
      const tries = `try ${job.attemptsMade + 1} of ${job.opts.attempts ?? 1}`
      this.logger.error(`Job ${job.name} failed (${tries}): ${summary}`, stack)
      throw describedError(summary, stack)
    }
  }
}

// An Error carrying only the described parts: the summary as its message, the frames as its stack.
function describedError(summary: string, frames: string | undefined): Error {
  const described = new Error(summary)
  described.stack = frames ? `Error: ${summary}\n${frames}` : `Error: ${summary}`
  return described
}
