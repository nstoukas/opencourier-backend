import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Job, Queue } from 'bullmq'
import { MESSAGE_BUS_QUEUE } from '../../constants'
import dayjs from 'dayjs'

@Injectable()
export class BullMQService {
  constructor(@InjectQueue(MESSAGE_BUS_QUEUE) private queue: Queue) {}

  // `jobId` names the job so it can be found and removed later (spec 0002). BullMQ ignores an add
  // whose jobId already exists, and refuses ids containing ':', so callers build ids with '-'.
  // `removeOnFail: true` deletes a job from Redis when it fails instead of keeping it in the failed list.
  async addJob<T>(
    name: string,
    data: T,
    options?: { delay?: number; attempts?: number; backoff?: number; jobId?: string; removeOnFail?: boolean }
  ) {
    await this.queue.add(name, data, { ...options, removeOnComplete: true })
  }

  async addScheduledJob<T>(name: string, scheduleAt: Date, data: T) {
    const delay = dayjs(scheduleAt).diff(dayjs(), 'millisecond')
    await this.addJob(name, data, { delay, attempts: 3, backoff: 180000 })
  }

  // `tz` (an IANA zone such as 'Europe/Athens') makes the cron pattern read local time, so a daily
  // job keeps its hour across summer time. Left out, the pattern reads the server's zone.
  async addRepeatableJob<T>(name: string, data: T, pattern: string, tz?: string) {
    await this.queue.add(name, data, { jobId: name, repeat: { pattern, jobId: name, tz } })
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
