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
      throw describedError(error, summary, stack)
    }
  }
}

// An Error carrying only the described parts: the summary as its message, the frames as its stack, and the
// original's name, which BullMQ reads as a signal (an `UnrecoverableError` is never retried; row 141 review).
function describedError(error: unknown, summary: string, frames: string | undefined): Error {
  const described = new Error(summary)
  described.name = error instanceof Error ? error.name : 'Error'
  described.stack = frames ? `${described.name}: ${summary}\n${frames}` : `${described.name}: ${summary}`
  return described
}
