import { GUARDS_METADATA } from '@nestjs/common/constants'
import { Job } from 'bullmq'
import { TaskBusService } from './taskBus.service'
import { EventBusService } from '../eventBus/eventBus.service'
import { BullMQProcessor } from '../../integrations/bullMQ/bullMQ.processor'
import { TaskName } from './models/TaskBusScheduler'

describe('TaskBusService & BullMQ Queue Execution (Row 94, Clause 2)', () => {
  let taskBusService: TaskBusService
  let eventBusService: EventBusService
  let bullMQProcessor: BullMQProcessor

  beforeEach(() => {
    // Shared EventBusService instance connecting TaskBus handlers and BullMQ processor
    eventBusService = new EventBusService()
    taskBusService = new TaskBusService(eventBusService)
    bullMQProcessor = new BullMQProcessor(eventBusService)
  })

  describe('Service has no route or secret guards attached (runs freely in process)', () => {
    it('has no __guards__ metadata on the TaskBusService class', () => {
      const classGuards = Reflect.getMetadata(GUARDS_METADATA, TaskBusService)
      expect(classGuards).toBeUndefined()
    })

    it('has no __guards__ metadata on registerTaskHandler or executeTask methods', () => {
      const registerGuards = Reflect.getMetadata(
        GUARDS_METADATA,
        TaskBusService.prototype.registerTaskHandler
      )
      const executeGuards = Reflect.getMetadata(
        GUARDS_METADATA,
        TaskBusService.prototype.executeTask
      )

      expect(registerGuards).toBeUndefined()
      expect(executeGuards).toBeUndefined()
    })
  })

  describe('In-process task handler execution (Clause 2)', () => {
    it('executes registered task handler when executeTask is called in process without any secret or header', async () => {
      const taskName: TaskName = 'offer-expiry'
      const receivedPayloads: Array<{ deliveryId: string }> = []

      // Register an in-process handler
      taskBusService.registerTaskHandler<{ deliveryId: string }>(taskName, (payload) => {
        receivedPayloads.push(payload)
      })

      // In-process execution via executeTask
      await taskBusService.executeTask(taskName, { deliveryId: 'del-local-1' })
      await taskBusService.executeTask(taskName, { deliveryId: 'del-local-2' })

      expect(receivedPayloads).toEqual([
        { deliveryId: 'del-local-1' },
        { deliveryId: 'del-local-2' },
      ])
    })

    it('supports async task handlers', async () => {
      const taskName: TaskName = 'no-courier-retry'
      let asyncHandled = false

      taskBusService.registerTaskHandler(taskName, async (payload: { count: number }) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        asyncHandled = payload.count === 42
      })

      await taskBusService.executeTask(taskName, { count: 42 })

      expect(asyncHandled).toBe(true)
    })
  })

  describe('BullMQ worker path execution (Clause 2: handlers run from the queue)', () => {
    it('runs registered task handler directly when BullMQProcessor processes a job', async () => {
      const taskName: TaskName = 'offer-expiry'
      const handledJobs: any[] = []

      // Handler registered via TaskBusService
      taskBusService.registerTaskHandler(taskName, (payload) => {
        handledJobs.push(payload)
      })

      // BullMQ worker processes a job coming from Redis queue
      const mockJob = {
        name: taskName,
        data: { deliveryId: 'del-bullmq-100', attempt: 1 },
      } as Job

      await bullMQProcessor.process(mockJob)

      expect(handledJobs).toHaveLength(1)
      expect(handledJobs[0]).toEqual({ deliveryId: 'del-bullmq-100', attempt: 1 })
    })

    it('queue execution does not go through HTTP or controller, so it never checks x-task-secret', async () => {
      // In production, BullMQ jobs run in-process through EventBusService without touching HTTP controllers
      const taskName: TaskName = 'no-courier-retry'
      let executedSuccessfully = false

      taskBusService.registerTaskHandler(taskName, (payload: { deliveryId: string }) => {
        if (payload.deliveryId === 'del-retry-555') {
          executedSuccessfully = true
        }
      })

      const queueJob = {
        name: taskName,
        data: { deliveryId: 'del-retry-555' },
      } as Job

      await bullMQProcessor.process(queueJob)

      expect(executedSuccessfully).toBe(true)
    })
  })
})
