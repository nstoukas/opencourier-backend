import { RequestMethod, INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import request from 'supertest'
import { TaskBusController } from './taskBus.controller'
import { TaskBusService } from './taskBus.service'
import {
  TaskRunnerSecretGuard,
  TASK_RUNNER_SECRET_HEADER,
  TASK_RUNNER_REFUSAL,
} from './task-runner-secret.guard'
import { TASK_RUNNER_SECRET } from '../../constants'
import { IS_PUBLIC_KEY } from '../../decorators/public.decorator'
import { TaskName } from './models/TaskBusScheduler'
import { EmptyResultDto } from '../../rest-api/common/dtos/empty.result.dto'

describe('TaskBusController (Row 94, Clause 3)', () => {
  let controller: TaskBusController
  let mockTaskBusService: {
    executeTask: jest.Mock
  }

  beforeEach(() => {
    mockTaskBusService = {
      executeTask: jest.fn().mockResolvedValue(undefined),
    }
    controller = new TaskBusController(mockTaskBusService as unknown as TaskBusService)
  })

  describe('Route and guard metadata wiring (Clause 3: test fails if route becomes public/unguarded)', () => {
    it('is registered under controller path api/tasks/v1', () => {
      const controllerPath = Reflect.getMetadata(PATH_METADATA, TaskBusController)
      expect(controllerPath).toBe('api/tasks/v1')
    })

    it('execute method is a POST handler with path execute', () => {
      const method = Reflect.getMetadata(METHOD_METADATA, controller.execute)
      const path = Reflect.getMetadata(PATH_METADATA, controller.execute)

      expect(method).toBe(RequestMethod.POST)
      expect(path).toBe('execute')
    })

    it('execute method carries @Public() decorator (no user login required)', () => {
      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controller.execute)
      expect(isPublic).toBe(true)
    })

    it('execute method carries TaskRunnerSecretGuard in its __guards__ metadata', () => {
      // NestJS @UseGuards stores guards under GUARDS_METADATA ('__guards__')
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller.execute)
      expect(guards).toBeDefined()
      expect(Array.isArray(guards)).toBe(true)
      expect(guards).toContain(TaskRunnerSecretGuard)
    })

    it('direct controller call executes task and returns EmptyResultDto', async () => {
      const input = {
        taskName: 'offer-expiry' as TaskName,
        payload: { deliveryId: 'del-direct-1' },
      }

      const result = await controller.execute(input)

      expect(mockTaskBusService.executeTask).toHaveBeenCalledWith(input.taskName, input.payload)
      expect(result).toBeInstanceOf(EmptyResultDto)
    })
  })

  describe('HTTP controller-level tests via Nest testing module and supertest', () => {
    let app: INestApplication
    let mockConfigService: {
      get: jest.Mock
    }
    const CONFIGURED_SECRET = 'fake-runner-secret-key-supertest-123'

    beforeEach(async () => {
      mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === TASK_RUNNER_SECRET) return CONFIGURED_SECRET
          return undefined
        }),
      }

      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [TaskBusController],
        providers: [
          {
            provide: TaskBusService,
            useValue: mockTaskBusService,
          },
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
          TaskRunnerSecretGuard,
        ],
      }).compile()

      app = moduleRef.createNestApplication()
      await app.init()
    })

    afterEach(async () => {
      if (app) {
        await app.close()
      }
    })

    it('refuses POST api/tasks/v1/execute without x-task-secret header: answers 401 and never calls executeTask', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/tasks/v1/execute')
        .send({
          taskName: 'no-courier-retry',
          payload: { deliveryId: 'del-test-unauthorized' },
        })

      expect(response.status).toBe(401)
      expect(response.body.message).toBe(TASK_RUNNER_REFUSAL)
      expect(mockTaskBusService.executeTask).not.toHaveBeenCalled()
    })

    it('refuses POST api/tasks/v1/execute with wrong x-task-secret header: answers 401 and never calls executeTask', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/tasks/v1/execute')
        .set(TASK_RUNNER_SECRET_HEADER, 'wrong-secret-token')
        .send({
          taskName: 'no-courier-retry',
          payload: { deliveryId: 'del-test-unauthorized' },
        })

      expect(response.status).toBe(401)
      expect(response.body.message).toBe(TASK_RUNNER_REFUSAL)
      expect(mockTaskBusService.executeTask).not.toHaveBeenCalled()
    })

    it('allows POST api/tasks/v1/execute with the exact x-task-secret header: answers 201 and calls executeTask with taskName and payload', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/tasks/v1/execute')
        .set(TASK_RUNNER_SECRET_HEADER, CONFIGURED_SECRET)
        .send({
          taskName: 'offer-expiry',
          payload: { deliveryId: 'del-allowed-123' },
        })

      expect(response.status).toBe(201)
      expect(mockTaskBusService.executeTask).toHaveBeenCalledTimes(1)
      expect(mockTaskBusService.executeTask).toHaveBeenCalledWith('offer-expiry', {
        deliveryId: 'del-allowed-123',
      })
    })

    it('refuses every caller when TASK_RUNNER_SECRET is unset in config', async () => {
      mockConfigService.get.mockReturnValue(undefined)

      const response = await request(app.getHttpServer())
        .post('/api/tasks/v1/execute')
        .set(TASK_RUNNER_SECRET_HEADER, CONFIGURED_SECRET)
        .send({
          taskName: 'offer-expiry',
          payload: { deliveryId: 'del-test-unset' },
        })

      expect(response.status).toBe(401)
      expect(response.body.message).toBe(TASK_RUNNER_REFUSAL)
      expect(mockTaskBusService.executeTask).not.toHaveBeenCalled()
    })
  })
})
