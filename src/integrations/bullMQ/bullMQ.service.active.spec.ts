import { Queue, Job } from 'bullmq'
import { BullMQService, JOB_RETRY_OPTIONS } from './bullMQ.service'

describe('BullMQService (Row 141, Spec 0003 R3, Spec 0005 AC-7)', () => {
  let service: BullMQService
  let mockQueue: {
    add: jest.Mock
    getRepeatableJobs: jest.Mock
    removeRepeatableByKey: jest.Mock
    getJobs: jest.Mock
    getAllJobs?: jest.Mock
  }
  let loggerLogSpy: jest.SpyInstance

  beforeEach(() => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
      getJobs: jest.fn().mockResolvedValue([]),
    }
    service = new BullMQService(mockQueue as unknown as Queue)
    loggerLogSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('JOB_RETRY_OPTIONS constant', () => {
    it('defines standard retry parameters: 3 attempts, 5s exponential backoff, 7-day retention up to 20,000 jobs', () => {
      expect(JOB_RETRY_OPTIONS).toEqual({
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 20000 },
      })
      // 7 * 24 * 60 * 60 = 604800 seconds
      expect(JOB_RETRY_OPTIONS.removeOnFail.age).toBe(604800)
    })
  })

  describe('addJob', () => {
    it('passes JOB_RETRY_OPTIONS and removeOnComplete: true when options are omitted', async () => {
      await service.addJob('simple-task', { foo: 'bar' })

      expect(mockQueue.add).toHaveBeenCalledWith(
        'simple-task',
        { foo: 'bar' },
        {
          ...JOB_RETRY_OPTIONS,
          removeOnComplete: true,
        }
      )
    })

    it('merges caller delay and jobId on top of JOB_RETRY_OPTIONS without overriding retry options', async () => {
      await service.addJob(
        'offer-insist',
        { deliveryId: 'del-1' },
        { delay: 120000, jobId: 'offer-insist-del-1' }
      )

      expect(mockQueue.add).toHaveBeenCalledWith(
        'offer-insist',
        { deliveryId: 'del-1' },
        {
          ...JOB_RETRY_OPTIONS,
          delay: 120000,
          jobId: 'offer-insist-del-1',
          removeOnComplete: true,
        }
      )
    })

    it('adds offer-expiry, no-courier-retry, and offer-insist with JOB_RETRY_OPTIONS', async () => {
      await service.addJob('offer-expiry', { deliveryId: 'del-1' }, { delay: 20000, jobId: 'offer-expiry-del-1' })
      expect(mockQueue.add).toHaveBeenLastCalledWith(
        'offer-expiry',
        { deliveryId: 'del-1' },
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnFail: { age: 604800, count: 20000 },
          removeOnComplete: true,
          delay: 20000,
          jobId: 'offer-expiry-del-1',
        })
      )

      await service.addJob('no-courier-retry', { deliveryId: 'del-2' }, { delay: 30000, jobId: 'retry-del-2' })
      expect(mockQueue.add).toHaveBeenLastCalledWith(
        'no-courier-retry',
        { deliveryId: 'del-2' },
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnFail: { age: 604800, count: 20000 },
          removeOnComplete: true,
          delay: 30000,
          jobId: 'retry-del-2',
        })
      )
    })
  })

  describe('addScheduledJob', () => {
    it('converts schedule date to delay and adds job with JOB_RETRY_OPTIONS', async () => {
      const futureDate = new Date(Date.now() + 60000)
      await service.addScheduledJob('force-pickup', futureDate, { deliveryId: 'del-sched-1' })

      expect(mockQueue.add).toHaveBeenCalledWith(
        'force-pickup',
        { deliveryId: 'del-sched-1' },
        expect.objectContaining({
          ...JOB_RETRY_OPTIONS,
          removeOnComplete: true,
          delay: expect.any(Number),
        })
      )
      const callOptions = mockQueue.add.mock.calls[0]![2]
      expect(callOptions.delay).toBeGreaterThanOrEqual(59000)
      expect(callOptions.delay).toBeLessThanOrEqual(61000)
    })
  })

  describe('addRepeatableJob (Spec 0005 AC-7, Row 141)', () => {
    it('adds repeatable job with JOB_RETRY_OPTIONS, removeOnComplete: true, and repeat config', async () => {
      await service.addRepeatableJob('daily-job', { data: 1 }, '0 0 * * *')

      expect(mockQueue.add).toHaveBeenCalledWith(
        'daily-job',
        { data: 1 },
        {
          ...JOB_RETRY_OPTIONS,
          removeOnComplete: true,
          jobId: 'daily-job',
          repeat: {
            pattern: '0 0 * * *',
            jobId: 'daily-job',
            tz: undefined,
          },
        }
      )
    })

    it('passes tz into repeat options when provided', async () => {
      await service.addRepeatableJob(
        'saved-customer-retention',
        {},
        '0 4 * * *',
        'Europe/Athens'
      )

      expect(mockQueue.add).toHaveBeenCalledWith(
        'saved-customer-retention',
        {},
        {
          ...JOB_RETRY_OPTIONS,
          removeOnComplete: true,
          jobId: 'saved-customer-retention',
          repeat: {
            pattern: '0 4 * * *',
            jobId: 'saved-customer-retention',
            tz: 'Europe/Athens',
          },
        }
      )
    })

    describe('Startup replacement of schedules', () => {
      it('replaces schedule whose next delayed run was saved with no attempts, and logs replacement', async () => {
        mockQueue.getRepeatableJobs.mockResolvedValueOnce([
          { name: 'cancellation-award-sweep', key: 'repeat:key-1', pattern: '* * * * *' },
        ])
        // Delayed job has repeatJobKey but old opts without attempts
        mockQueue.getJobs.mockImplementation(async (types) => {
          if (Array.isArray(types) && types.includes('delayed')) {
            return [
              {
                name: 'cancellation-award-sweep',
                repeatJobKey: 'repeat:key-1',
                opts: {},
              },
            ]
          }
          return []
        })

        await service.addRepeatableJob('cancellation-award-sweep', {}, '* * * * *')

        expect(mockQueue.getJobs).toHaveBeenCalledWith(['delayed', 'waiting'])
        expect(mockQueue.removeRepeatableByKey).toHaveBeenCalledWith('repeat:key-1')
        expect(loggerLogSpy).toHaveBeenCalledWith(
          'Replaced the cancellation-award-sweep schedule: saved with other retry options'
        )
        expect(mockQueue.add).toHaveBeenCalledWith(
          'cancellation-award-sweep',
          {},
          expect.objectContaining({ ...JOB_RETRY_OPTIONS })
        )
      })

      it('replaces schedule whose next run is in waiting (e.g. caught at boundary) saved with other retry options', async () => {
        mockQueue.getRepeatableJobs.mockResolvedValueOnce([
          { name: 'cancellation-award-sweep', key: 'repeat:key-waiting', pattern: '* * * * *' },
        ])
        // Stale run exists in 'waiting' list only
        mockQueue.getJobs.mockImplementation(async (types) => {
          if (Array.isArray(types) && types.includes('waiting')) {
            return [
              {
                name: 'cancellation-award-sweep',
                repeatJobKey: 'repeat:key-waiting',
                opts: {},
              },
            ]
          }
          return []
        })

        await service.addRepeatableJob('cancellation-award-sweep', {}, '* * * * *')

        expect(mockQueue.getJobs).toHaveBeenCalledWith(['delayed', 'waiting'])
        expect(mockQueue.removeRepeatableByKey).toHaveBeenCalledWith('repeat:key-waiting')
        expect(loggerLogSpy).toHaveBeenCalledWith(
          'Replaced the cancellation-award-sweep schedule: saved with other retry options'
        )
      })

      it('does NOT replace schedule saved with today options, INCLUDING when Redis returns keys in another order', async () => {
        mockQueue.getRepeatableJobs.mockResolvedValueOnce([
          { name: 'cancellation-award-sweep', key: 'repeat:key-1', pattern: '* * * * *' },
        ])
        // Keys returned in reversed order as seen in Redis
        mockQueue.getJobs.mockImplementation(async (types) => {
          if (Array.isArray(types) && types.includes('delayed')) {
            return [
              {
                name: 'cancellation-award-sweep',
                repeatJobKey: 'repeat:key-1',
                opts: {
                  attempts: 3,
                  backoff: { delay: 5000, type: 'exponential' },
                  removeOnFail: { count: 20000, age: 604800 },
                },
              },
            ]
          }
          return []
        })

        await service.addRepeatableJob('cancellation-award-sweep', {}, '* * * * *')

        // Must NOT remove or log replacement
        expect(mockQueue.removeRepeatableByKey).not.toHaveBeenCalled()
        expect(loggerLogSpy).not.toHaveBeenCalled()
        expect(mockQueue.add).toHaveBeenCalledTimes(1)
      })

      it('replaces schedule when pattern or tz differs even if retries match', async () => {
        mockQueue.getRepeatableJobs.mockResolvedValueOnce([
          { name: 'saved-customer-retention', key: 'repeat:key-old', pattern: '0 3 * * *', tz: 'Europe/Athens' },
        ])
        mockQueue.getJobs.mockImplementation(async (types) => {
          if (Array.isArray(types) && types.includes('delayed')) {
            return [
              {
                name: 'saved-customer-retention',
                repeatJobKey: 'repeat:key-old',
                opts: {
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 5000 },
                  removeOnFail: { age: 604800, count: 20000 },
                },
              },
            ]
          }
          return []
        })

        // Pattern changed from 0 3 * * * to 0 4 * * *
        await service.addRepeatableJob('saved-customer-retention', {}, '0 4 * * *', 'Europe/Athens')

        expect(mockQueue.removeRepeatableByKey).toHaveBeenCalledWith('repeat:key-old')
        expect(loggerLogSpy).toHaveBeenCalledWith(
          'Replaced the saved-customer-retention schedule: its time or zone changed'
        )
        expect(mockQueue.add).toHaveBeenCalledWith(
          'saved-customer-retention',
          {},
          expect.objectContaining({ repeat: expect.objectContaining({ pattern: '0 4 * * *' }) })
        )
      })

      it('delayed jobs with different name or without repeatJobKey do NOT trigger replacement', async () => {
        mockQueue.getRepeatableJobs.mockResolvedValueOnce([
          { name: 'cancellation-award-sweep', key: 'repeat:key-1', pattern: '* * * * *' },
        ])
        mockQueue.getJobs.mockImplementation(async (types) => {
          if (Array.isArray(types) && types.includes('delayed')) {
            return [
              // Another job name
              { name: 'other-job', repeatJobKey: 'repeat:other:1', opts: {} },
              // One-off delayed job without repeatJobKey
              { name: 'cancellation-award-sweep', repeatJobKey: undefined, opts: {} },
            ]
          }
          return []
        })

        await service.addRepeatableJob('cancellation-award-sweep', {}, '* * * * *')

        expect(mockQueue.removeRepeatableByKey).not.toHaveBeenCalled()
        expect(loggerLogSpy).not.toHaveBeenCalled()
      })

      it('an undefined entry in getJobs(["delayed", "waiting"]) does not throw (Minor 1)', async () => {
        mockQueue.getRepeatableJobs.mockResolvedValueOnce([
          { name: 'daily-job', key: 'repeat:key-1', pattern: '0 0 * * *' },
        ])
        // Array contains undefined entries (Job.fromId returned undefined for removed job)
        mockQueue.getJobs.mockImplementation(async (types) => {
          if (Array.isArray(types)) {
            return [undefined, { name: 'other', repeatJobKey: 'k', opts: {} }]
          }
          return []
        })

        await expect(service.addRepeatableJob('daily-job', {}, '0 0 * * *')).resolves.not.toThrow()
      })
    })
  })

  describe('removeDelayedJobs and removeDelayedJobsWithIdPrefix', () => {
    it('removeDelayedJobs ignores undefined entries in delayed jobs without throwing', async () => {
      const mockRemove = jest.fn().mockResolvedValue(undefined)
      const validJob = { id: 'job-1', remove: mockRemove } as unknown as Job
      mockQueue.getJobs.mockResolvedValueOnce([undefined, validJob])

      await expect(
        service.removeDelayedJobs((job) => job.id === 'job-1')
      ).resolves.not.toThrow()

      expect(mockRemove).toHaveBeenCalledTimes(1)
    })

    it('removeDelayedJobsWithIdPrefix removes delayed jobs matching prefix (including retry backoff delays)', async () => {
      const remove1 = jest.fn().mockResolvedValue(undefined)
      const remove2 = jest.fn().mockResolvedValue(undefined)
      mockQueue.getJobs.mockResolvedValueOnce([
        { id: 'no-courier-retry-del-1', remove: remove1 },
        { id: 'offer-expiry-del-2', remove: remove2 },
      ])

      await service.removeDelayedJobsWithIdPrefix('no-courier-retry-')

      expect(remove1).toHaveBeenCalledTimes(1)
      expect(remove2).not.toHaveBeenCalled()
    })
  })
})
