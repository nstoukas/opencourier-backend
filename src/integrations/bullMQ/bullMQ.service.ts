import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Job, Queue } from 'bullmq'
import { MESSAGE_BUS_QUEUE } from '../../constants'
import dayjs from 'dayjs'

// Row 141: how every job on this queue is retried when its handler throws. Three tries in all, the
// second 5 seconds after the first fails and the third 10 seconds after that ('exponential' doubles the
// wait each time). Then the job stays in the failed list for 7 days (at most 1000 of them), where its
// error is the summary BullMQProcessor gave it, never a Prisma message. Operational numbers, not pay or
// matching ones, so they live here rather than on Instance configuration (decision 141.1).
export const JOB_RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
} as const

@Injectable()
export class BullMQService {
  private readonly logger = new Logger(BullMQService.name)

  constructor(@InjectQueue(MESSAGE_BUS_QUEUE) private queue: Queue) {}

  // `jobId` names the job so it can be found and removed later (spec 0002). BullMQ ignores an add
  // whose jobId already exists, and refuses ids containing ':', so callers build ids with '-'.
  // Every job gets JOB_RETRY_OPTIONS (row 141); a caller's own options win over them.
  async addJob<T>(name: string, data: T, options?: { delay?: number; jobId?: string }) {
    await this.queue.add(name, data, { ...JOB_RETRY_OPTIONS, ...options, removeOnComplete: true })
  }

  // Row 141: retried like every other job; it had its own 3 tries, 3 minutes apart, before.
  async addScheduledJob<T>(name: string, scheduleAt: Date, data: T) {
    await this.addJob(name, data, { delay: dayjs(scheduleAt).diff(dayjs(), 'millisecond') })
  }

  // `tz` (an IANA zone such as 'Europe/Athens') makes the cron pattern read local time, so a daily
  // job keeps its hour across summer time. Left out, the pattern reads the server's zone.
  // A fixed id schedule, after removing any older schedule with this name that differs: another time or
  // zone (spec 0053, cross check 10: a changed pattern would otherwise add a second schedule beside the
  // first, the stray schedule AGENTS.md warns about), or a next run saved without the retry options.
  // Row 141: BullMQ makes each run of a schedule from the run before it, options included, so a schedule
  // saved before the retry options existed would never retry unless it is replaced once. The same
  // schedule again changes nothing.
  async addRepeatableJob<T>(name: string, data: T, pattern: string, tz?: string) {
    const schedules = (await this.queue.getRepeatableJobs()).filter((schedule) => schedule.name === name)
    const savedWithoutRetries = await this.hasRunWithoutRetryOptions(name)
    for (const schedule of schedules) {
      if (savedWithoutRetries || schedule.pattern !== pattern || (schedule.tz ?? undefined) !== tz) {
        await this.queue.removeRepeatableByKey(schedule.key)
      }
    }
    if (savedWithoutRetries) {
      this.logger.log(`Replaced the ${name} schedule, saved before failed jobs were retried`)
    }
    await this.queue.add(name, data, {
      ...JOB_RETRY_OPTIONS,
      removeOnComplete: true,
      jobId: name,
      repeat: { pattern, jobId: name, tz },
    })
  }

  // Whether the next run of a schedule with this name waits in the queue without the retry options.
  private async hasRunWithoutRetryOptions(name: string): Promise<boolean> {
    const delayed = await this.queue.getJobs('delayed')
    return delayed.some(
      (job) => job.name === name && Boolean(job.repeatJobKey) && job.opts.attempts !== JOB_RETRY_OPTIONS.attempts
    )
  }

  async getAllJobs() {
    return this.queue.getJobs()
  }

  async getFailedJobs() {
    return this.queue.getJobs('failed')
  }

  async removeAllJobs() {
    const failedJobs = await this.getAllJobs()
    await Promise.all(failedJobs.map((job) => job.remove()))
  }

  async removeDelayedJobs<T>(filter: (job: Job<T, unknown, string>) => boolean) {
    const pendingJobs = await this.queue.getJobs('delayed')
    const jobs = pendingJobs.filter(filter)
    return Promise.all(jobs.map((job) => job.remove()))
  }

  // Removes every job still waiting for its delay whose id starts with `prefix`. A job that is
  // already running is not delayed, so it is never touched here.
  async removeDelayedJobsWithIdPrefix(prefix: string) {
    return this.removeDelayedJobs((job) => typeof job.id === 'string' && job.id.startsWith(prefix))
  }

  async removeFailedJobs() {
    const failedJobs = await this.getFailedJobs()
    await Promise.all(failedJobs.map((job) => job.remove()))
  }
}
