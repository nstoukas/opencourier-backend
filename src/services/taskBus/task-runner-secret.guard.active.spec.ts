import { ExecutionContext } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TASK_RUNNER_SECRET } from '../../constants'
import { UnauthorizedException } from '../../errors'
import {
  TaskRunnerSecretGuard,
  TASK_RUNNER_SECRET_HEADER,
  TASK_RUNNER_REFUSAL,
} from './task-runner-secret.guard'

describe('TaskRunnerSecretGuard (Row 94, Decision 94.1)', () => {
  let guard: TaskRunnerSecretGuard
  let mockConfigService: {
    get: jest.Mock
  }

  // Helper to build a minimal NestJS ExecutionContext with request headers
  const createMockExecutionContext = (headers?: Record<string, any>): ExecutionContext => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as unknown as ExecutionContext
  }

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn(),
    }
    guard = new TaskRunnerSecretGuard(mockConfigService as unknown as ConfigService)
  })

  describe('When TASK_RUNNER_SECRET is unset or empty (closed by default)', () => {
    it('refuses call with 401 UnauthorizedException when secret is undefined in config', () => {
      mockConfigService.get.mockReturnValue(undefined)
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: 'some-secret-token',
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err).toBeInstanceOf(UnauthorizedException)
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call with 401 when secret is empty string in config and no header sent', () => {
      mockConfigService.get.mockReturnValue('')
      const context = createMockExecutionContext({})

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err).toBeInstanceOf(UnauthorizedException)
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call with 401 when secret is empty string even if caller sends empty header', () => {
      // Both expected and sent are empty string, but unset/empty must never allow access
      mockConfigService.get.mockReturnValue('')
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: '',
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call when request has no headers object defined', () => {
      mockConfigService.get.mockReturnValue(undefined)
      const context = createMockExecutionContext(undefined)

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
    })
  })

  describe('When TASK_RUNNER_SECRET is configured', () => {
    const CONFIGURED_SECRET = 'fake-task-secret-key-for-test-xyz-987'

    beforeEach(() => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === TASK_RUNNER_SECRET) return CONFIGURED_SECRET
        return undefined
      })
    })

    it('refuses call when x-task-secret header is completely missing', () => {
      const context = createMockExecutionContext({})

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call when x-task-secret header is empty string', () => {
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: '',
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call when header value is of different length (shorter)', () => {
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: 'fake-task-secret',
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call when header value is of different length (longer)', () => {
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: `${CONFIGURED_SECRET}-extra-suffix`,
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call when header value has same length but differs by one character', () => {
      // Modify only the last character of the secret
      const lastChar = CONFIGURED_SECRET.slice(-1)
      const modifiedLastChar = lastChar === 'a' ? 'b' : 'a'
      const tamperedSecret = CONFIGURED_SECRET.slice(0, -1) + modifiedLastChar

      expect(tamperedSecret.length).toBe(CONFIGURED_SECRET.length)
      expect(tamperedSecret).not.toBe(CONFIGURED_SECRET)

      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: tamperedSecret,
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call when header value has same length but differs by the first character', () => {
      const firstChar = CONFIGURED_SECRET[0]
      const modifiedFirstChar = firstChar === 'x' ? 'y' : 'x'
      const tamperedSecret = modifiedFirstChar + CONFIGURED_SECRET.slice(1)

      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: tamperedSecret,
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
    })

    it('permits call and returns true when x-task-secret header matches exact value', () => {
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: CONFIGURED_SECRET,
      })

      const allowed = guard.canActivate(context)
      expect(allowed).toBe(true)
    })

    it('permits call when header is passed as string array or object with toString() matching exact secret', () => {
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: [CONFIGURED_SECRET],
      })

      const allowed = guard.canActivate(context)
      expect(allowed).toBe(true)
    })
  })
})
