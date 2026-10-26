import { Queue } from 'bullmq'
import { BullMQService } from './bullMQ.service'

describe('BullMQService - Spec 0003 R3 BullMQ Job Options', () => {
  let service: BullMQService
  let mockQueue: {
    add: jest.Mock
  }

  beforeEach(() => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    }
    service = new BullMQService(mockQueue as unknown as Queue)
  })

  describe('addJob', () => {
    test('forwards removeOnFail: true and options to queue.add along with removeOnComplete: true', async () => {
      await service.addJob(
        'offer-insist',
        { deliveryId: 'del-1' },
        { delay: 120000, jobId: 'offer-insist-del-1', removeOnFail: true }
      )

      expect(mockQueue.add).toHaveBeenCalledWith(
        'offer-insist',
        { deliveryId: 'del-1' },
        {
          delay: 120000,
          jobId: 'offer-insist-del-1',
          removeOnFail: true,
          removeOnComplete: true,
        }
      )
    })

    test('adds removeOnComplete: true when options are omitted', async () => {
      await service.addJob('simple-task', { foo: 'bar' })

      expect(mockQueue.add).toHaveBeenCalledWith(
        'simple-task',
        { foo: 'bar' },
        { removeOnComplete: true }
      )
    })
  })

  describe('addRepeatableJob (Spec 0005, AC-7)', () => {
    test('passes tz into repeat options when provided', async () => {
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
          jobId: 'saved-customer-retention',
          repeat: {
            pattern: '0 4 * * *',
            jobId: 'saved-customer-retention',
            tz: 'Europe/Athens',
          },
        }
      )
    })

    test('adds repeatable job without tz when tz is omitted', async () => {
      await service.addRepeatableJob('daily-job', { data: 1 }, '0 0 * * *')

      expect(mockQueue.add).toHaveBeenCalledWith(
        'daily-job',
        { data: 1 },
        {
          jobId: 'daily-job',
          repeat: {
            pattern: '0 0 * * *',
            jobId: 'daily-job',
            tz: undefined,
          },
        }
      )
    })
  })
})
