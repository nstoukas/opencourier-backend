import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TaskBusModule } from './taskBus.module'
import { TASK_RUNNER_SECRET } from '../../constants'
import * as secretGuardModule from './task-runner-secret.guard'

describe('TaskBusModule.onModuleInit (Row 94, Decision 94.2, agy review)', () => {
  let mockConfigService: {
    get: jest.Mock
  }
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn(),
    }
    // Intercept Logger.prototype.warn to inspect log messages and keep test output clean
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    jest.restoreAllMocks()
  })

  it('calls warnIfTaskRunnerSecretTooShort with configured value and module logger on startup (PIN)', () => {
    const configuredSecret = 'fake-short-secret-under-32'
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === TASK_RUNNER_SECRET) return configuredSecret
      return undefined
    })

    const helperSpy = jest.spyOn(secretGuardModule, 'warnIfTaskRunnerSecretTooShort')

    const module = new TaskBusModule(mockConfigService as unknown as ConfigService)
    module.onModuleInit()

    expect(mockConfigService.get).toHaveBeenCalledWith(TASK_RUNNER_SECRET)
    expect(helperSpy).toHaveBeenCalledTimes(1)
    expect(helperSpy).toHaveBeenCalledWith(configuredSecret, (module as any).logger)
  })

  it('warns at startup naming TASK_RUNNER_SECRET and never the secret value when configured secret is too short (PIN)', () => {
    const shortSecret = 'fake-short-secret-123'
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === TASK_RUNNER_SECRET) return shortSecret
      return undefined
    })

    const module = new TaskBusModule(mockConfigService as unknown as ConfigService)
    module.onModuleInit()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const warningMessage = warnSpy.mock.calls[0][0]
    expect(typeof warningMessage).toBe('string')
    // Must name the setting TASK_RUNNER_SECRET
    expect(warningMessage).toContain(TASK_RUNNER_SECRET)
    // Must name minimum length 32
    expect(warningMessage).toContain('32')
    // Must never leak the configured secret
    expect(warningMessage).not.toContain(shortSecret)
  })

  it('says nothing at startup when TASK_RUNNER_SECRET is unset in config (PIN)', () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === TASK_RUNNER_SECRET) return undefined
      return undefined
    })

    const module = new TaskBusModule(mockConfigService as unknown as ConfigService)
    module.onModuleInit()

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('says nothing at startup when TASK_RUNNER_SECRET is empty string in config (PIN)', () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === TASK_RUNNER_SECRET) return ''
      return undefined
    })

    const module = new TaskBusModule(mockConfigService as unknown as ConfigService)
    module.onModuleInit()

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('says nothing at startup when TASK_RUNNER_SECRET is long enough (32+ characters) (PIN)', () => {
    const validSecret = 'fake-valid-task-runner-secret-key-32chars!'
    expect(validSecret.length).toBeGreaterThanOrEqual(32)

    mockConfigService.get.mockImplementation((key: string) => {
      if (key === TASK_RUNNER_SECRET) return validSecret
      return undefined
    })

    const module = new TaskBusModule(mockConfigService as unknown as ConfigService)
    module.onModuleInit()

    expect(warnSpy).not.toHaveBeenCalled()
  })
})
