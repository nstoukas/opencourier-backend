import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GcpTaskScheduler, WEBHOOK_NAME, WEBHOOK_PATH } from './gcpTask.scheduler'
import {
  GCP_LOCATION,
  GCP_PROJECT_NAME,
  PUBLIC_API_URL,
  TASK_RUNNER_SECRET,
} from '../../constants'
import { TASK_RUNNER_SECRET_HEADER } from '../../services/taskBus/task-runner-secret.guard'

describe('GcpTaskScheduler (Row 94, Decision 94.1)', () => {
  let scheduler: GcpTaskScheduler
  let mockConfigService: {
    get: jest.Mock
  }
  let mockCreateTask: jest.Mock
  let mockQueuePath: jest.Mock
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  const FAKE_CONFIG: Record<string, string> = {
    [PUBLIC_API_URL]: 'https://api.opencourier.example.com',
    [GCP_PROJECT_NAME]: 'opencourier-prod',
    [GCP_LOCATION]: 'europe-west1',
    [TASK_RUNNER_SECRET]: 'fake-gcp-runner-secret-key-xyz-789',
  }

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => FAKE_CONFIG[key]),
    }

    scheduler = new GcpTaskScheduler(mockConfigService as unknown as ConfigService)

    mockCreateTask = jest.fn().mockResolvedValue([{}])
    mockQueuePath = jest
      .fn()
      .mockImplementation((proj, loc, name) => `projects/${proj}/locations/${loc}/queues/${name}`)

    ;(scheduler as any).cloudTasksClient = {
      createTask: mockCreateTask,
      queuePath: mockQueuePath,
    }

    logSpy = jest.spyOn((scheduler as any).logger, 'log').mockImplementation(() => {})
    errorSpy = jest.spyOn((scheduler as any).logger, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Header configuration on scheduled tasks (Clause 1 & PIN)', () => {
    it('sets x-task-secret header with configured TASK_RUNNER_SECRET on created task request', async () => {
      const scheduleTime = new Date('2026-11-18T10:00:00.000Z')
      const payload = { deliveryId: 'del-12345', testField: 'some-value' }

      await scheduler.scheduleTask('offer-expiry', scheduleTime, payload)

      expect(mockCreateTask).toHaveBeenCalledTimes(1)
      const passedRequest = mockCreateTask.mock.calls[0][0]

      expect(passedRequest).toBeDefined()
      expect(passedRequest.task).toBeDefined()
      expect(passedRequest.task.httpRequest).toBeDefined()

      const headers = passedRequest.task.httpRequest.headers
      expect(headers).toBeDefined()
      // Crucial: x-task-secret header must exist and carry configured secret
      expect(headers[TASK_RUNNER_SECRET_HEADER]).toBe(FAKE_CONFIG[TASK_RUNNER_SECRET])
      expect(headers['Content-Type']).toBe('application/json')

      // Verify URL and method
      expect(passedRequest.task.httpRequest.url).toBe(
        `https://api.opencourier.example.com/${WEBHOOK_PATH}/${WEBHOOK_NAME}`
      )
      expect(passedRequest.task.httpRequest.httpMethod).toBe('POST')

      // Verify payload is encoded in base64
      const decodedBody = JSON.parse(
        Buffer.from(passedRequest.task.httpRequest.body, 'base64').toString('utf-8')
      )
      expect(decodedBody).toEqual({
        deliveryId: 'del-12345',
        testField: 'some-value',
        taskName: 'offer-expiry',
      })
    })

    it('defaults x-task-secret header to empty string when TASK_RUNNER_SECRET is unset in config', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === TASK_RUNNER_SECRET) return undefined
        return FAKE_CONFIG[key]
      })

      const scheduleTime = new Date('2026-11-18T10:00:00.000Z')
      await scheduler.scheduleTask('no-courier-retry', scheduleTime, { id: 'test' })

      expect(mockCreateTask).toHaveBeenCalledTimes(1)
      const passedRequest = mockCreateTask.mock.calls[0][0]
      const headers = passedRequest.task.httpRequest.headers

      expect(headers).toHaveProperty(TASK_RUNNER_SECRET_HEADER)
      expect(headers[TASK_RUNNER_SECRET_HEADER]).toBe('')
    })
  })

  describe('Logging privacy: never logs secret, headers, or payload (Decision 94.1 & PIN)', () => {
    const sensitivePayload = {
      customerPhone: '+306912345678',
      secretNote: 'doorbell broken ask for Nikos',
      riderPayoutEur: 6.5,
    }
    const scheduleTime = new Date('2026-11-18T10:00:00.000Z')

    it('success path logs only taskName and scheduleAt; never logs secret, headers, request, or payload', async () => {
      await scheduler.scheduleTask('offer-expiry', scheduleTime, sensitivePayload)

      expect(logSpy).toHaveBeenCalledTimes(1)
      const logMessage = logSpy.mock.calls[0][0]

      // Log must match the safe format
      expect(logMessage).toBe(`Submitting task offer-expiry for ${scheduleTime.toISOString()}`)

      // Must never log the secret
      expect(logMessage).not.toContain(FAKE_CONFIG[TASK_RUNNER_SECRET])

      // Must never log sensitive payload contents
      expect(logMessage).not.toContain('+306912345678')
      expect(logMessage).not.toContain('doorbell broken')
      expect(logMessage).not.toContain('riderPayoutEur')

      // Must never log raw request JSON or httpRequest
      expect(logMessage).not.toContain('httpRequest')
      expect(logMessage).not.toContain('headers')
      expect(logMessage).not.toContain(TASK_RUNNER_SECRET_HEADER)
      expect(logMessage).not.toContain('Submitting new task')

      // Check all log calls and arguments comprehensively
      for (const callArgs of logSpy.mock.calls) {
        const fullArgText = JSON.stringify(callArgs)
        expect(fullArgText).not.toContain(FAKE_CONFIG[TASK_RUNNER_SECRET])
        expect(fullArgText).not.toContain('+306912345678')
        expect(fullArgText).not.toContain('doorbell broken')
      }
    })

    it('failure path logs only taskName and scheduleAt; never logs secret, headers, request, or payload', async () => {
      const gcpError = new Error('GCP Cloud Tasks API quota exceeded')
      mockCreateTask.mockRejectedValueOnce(gcpError)

      await expect(
        scheduler.scheduleTask('offer-expiry', scheduleTime, sensitivePayload)
      ).rejects.toThrow('GCP Cloud Tasks API quota exceeded')

      expect(errorSpy).toHaveBeenCalledTimes(1)
      const [errorMessage, errorArg] = errorSpy.mock.calls[0]

      // Error log message must match safe format
      expect(errorMessage).toBe(`Failed to schedule task offer-expiry for ${scheduleTime.toISOString()}`)
      expect(errorArg).toBe(gcpError)

      // Must never log the secret in the error message
      expect(errorMessage).not.toContain(FAKE_CONFIG[TASK_RUNNER_SECRET])

      // Must never log sensitive payload in error message
      expect(errorMessage).not.toContain('+306912345678')
      expect(errorMessage).not.toContain('doorbell broken')
      expect(errorMessage).not.toContain('riderPayoutEur')

      // Must never log raw request JSON or httpRequest
      expect(errorMessage).not.toContain('httpRequest')
      expect(errorMessage).not.toContain('headers')
      expect(errorMessage).not.toContain(TASK_RUNNER_SECRET_HEADER)
      expect(errorMessage).not.toContain('Failed to schedule task {"parent"')

      // Check all error call arguments comprehensively
      for (const callArgs of errorSpy.mock.calls) {
        const messageArg = callArgs[0]
        if (typeof messageArg === 'string') {
          expect(messageArg).not.toContain(FAKE_CONFIG[TASK_RUNNER_SECRET])
          expect(messageArg).not.toContain('+306912345678')
          expect(messageArg).not.toContain('doorbell broken')
        }
      }
    })
  })
})
